import * as vscode from "vscode";
import type { AgentBackend, AgentContext, AgentTarget } from "../agent/AgentBackend.js";
import { extractCodeBlock } from "../agent/prompt.js";
import type { Dispatch, Resolution } from "../intent/speculator.js";
import type { Intent, IntentKind } from "../intent/types.js";

export const PROPOSAL_SCHEME = "voicecoder-proposal";

/** What happened to one confirmed command. */
export interface ActionReport {
  kind: IntentKind | null;
  /** The editor was changed (generate) or a proposal was opened (debug). */
  applied: boolean;
  speculative: boolean;
  message: string;
  output?: string;
  error?: string;
}

/** A debug fix waiting for approval. Nothing is written until it is applied. */
export interface Proposal {
  id: number;
  documentUri: vscode.Uri;
  proposalUri: vscode.Uri;
  /** Document version the fix was computed against. */
  version: number;
  range: vscode.Range;
  newText: string;
  /** The whole document as it would be after applying. */
  proposedDocument: string;
}

interface Run {
  dispatch: Dispatch;
  document: vscode.TextDocument | undefined;
  target: AgentTarget | undefined;
  insertAt: vscode.Position | undefined;
  output: string;
  /** Text streamed after this is shown live (explain, once confirmed). */
  live: ((text: string) => void) | undefined;
  done: Promise<void>;
}

function label(intent: Intent): string {
  return intent.range ? `${intent.kind} ${intent.range.from}-${intent.range.to}` : intent.kind;
}

/**
 * Turns dispatches into agent runs and applies a run's result only once the
 * final transcript has confirmed that dispatch. A run started from a partial
 * and then aborted ends without leaving anything in the editor.
 */
export class ActionRunner implements vscode.Disposable {
  private readonly runs = new Map<Dispatch, Run>();
  private readonly reported = new vscode.EventEmitter<ActionReport>();
  readonly onDidReport = this.reported.event;
  private readonly proposals = new Map<string, Proposal>();
  private pending: Proposal | undefined;
  private nextProposalId = 1;
  private readonly provider: vscode.Disposable;

  constructor(
    private readonly agent: () => AgentBackend,
    private readonly output: vscode.OutputChannel,
    private readonly onStatus: (state: "running" | "done" | "error", label: string) => void,
  ) {
    this.provider = vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, {
      provideTextDocumentContent: (uri) => this.proposals.get(uri.toString())?.proposedDocument ?? "",
    });
  }

  get pendingProposal(): Proposal | undefined {
    return this.pending;
  }

  /** Start the agent for a dispatch (possibly speculative). Touches nothing in the editor. */
  begin(dispatch: Dispatch): void {
    const editor = vscode.window.activeTextEditor;
    const run: Run = { dispatch, document: editor?.document, target: undefined, insertAt: undefined, output: "", live: undefined, done: Promise.resolve() };
    if (editor) {
      const { target, insertAt } = resolveTarget(editor, dispatch.intent);
      run.target = target;
      run.insertAt = insertAt;
      const context: AgentContext = {
        utterance: dispatch.text,
        documentText: editor.document.getText(),
        diagnostics: errorsIn(editor.document, target),
        signal: dispatch.signal,
      };
      run.done = (async () => {
        for await (const text of this.agent().run(dispatch.intent, target, context)) {
          if (dispatch.signal.aborted) return;
          run.output += text;
          run.live?.(text);
        }
      })();
      // An aborted run's failure is nobody's concern; a confirmed one is awaited in resolve()
      run.done.catch(() => {});
    }
    this.runs.set(dispatch, run);
  }

  /** The final transcript is in: apply the dispatch that stands, drop the rest. */
  async resolve(resolution: Resolution): Promise<void> {
    for (const aborted of resolution.aborted) this.runs.delete(aborted);
    const dispatch = resolution.dispatch;
    if (!dispatch) {
      this.report({ kind: null, applied: false, speculative: false, message: `コマンドが聞き取れませんでした: ${resolution.text}` });
      return;
    }
    const run = this.runs.get(dispatch);
    this.runs.delete(dispatch);
    if (!run?.document || !run.target) {
      this.report({ kind: dispatch.intent.kind, applied: false, speculative: dispatch.speculative, message: "対象のエディタがありません" });
      return;
    }

    const name = label(dispatch.intent);
    this.onStatus("running", name);
    if (dispatch.intent.kind === "explain") {
      // Explanations stream into the output channel from here on
      this.output.appendLine(`\n## ${name}: ${resolution.text}`);
      this.output.append(run.output);
      run.live = (text) => this.output.append(text);
      this.output.show(true);
    }
    try {
      await run.done;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onStatus("error", `${name}: ${message}`);
      this.report({ kind: dispatch.intent.kind, applied: false, speculative: dispatch.speculative, message: "エージェントが失敗しました", error: message });
      return;
    }
    if (dispatch.signal.aborted) return;

    switch (dispatch.intent.kind) {
      case "explain":
        this.output.appendLine("");
        this.finish(run, true, `${name}: 出力に表示しました`);
        return;
      case "generate":
        await this.applyGenerate(run, name);
        return;
      case "debug":
        await this.proposeFix(run, name);
        return;
    }
  }

  private async applyGenerate(run: Run, name: string): Promise<void> {
    const document = run.document!;
    const position = document.validatePosition(run.insertAt!);
    let code = extractCodeBlock(run.output);
    if (!code.endsWith("\n")) code += "\n";
    if (position.character > 0) code = "\n" + code;
    // One WorkspaceEdit, so a single undo takes it all back
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, position, code);
    const applied = await vscode.workspace.applyEdit(edit);
    this.finish(run, applied, applied ? `${name}: 挿入しました` : `${name}: 挿入できませんでした`);
  }

  private async proposeFix(run: Run, name: string): Promise<void> {
    const document = run.document!;
    const target = run.target!;
    const range = new vscode.Range(target.startLine, 0, target.endLine, document.lineAt(target.endLine).text.length);
    const newText = extractCodeBlock(run.output);
    if (newText === document.getText(range)) {
      this.finish(run, false, `${name}: 修正案はありません`);
      return;
    }
    const id = this.nextProposalId++;
    const proposalUri = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: document.uri.path || "/untitled", query: `id=${id}` });
    const full = document.getText();
    const proposedDocument = full.slice(0, document.offsetAt(range.start)) + newText + full.slice(document.offsetAt(range.end));
    const proposal: Proposal = { id, documentUri: document.uri, proposalUri, version: document.version, range, newText, proposedDocument };
    this.proposals.set(proposalUri.toString(), proposal);
    this.pending = proposal;

    await vscode.commands.executeCommand("vscode.diff", document.uri, proposalUri, `Voice Coder 修正案（未適用）: ${name}`, { preview: true, preserveFocus: true });
    this.finish(run, true, `${name}: 修正案を表示しました（未適用）`);
    void vscode.window.showInformationMessage("Voice Coder: 修正案を適用しますか？", "適用", "破棄").then((choice) => {
      if (this.pending?.id !== id) return;
      if (choice === "適用") void this.applyProposal();
      else if (choice === "破棄") this.discardProposal();
    });
  }

  /** Write the pending fix into the document, unless the document changed since. */
  async applyProposal(): Promise<boolean> {
    const proposal = this.pending;
    if (!proposal) {
      void vscode.window.showWarningMessage("Voice Coder: 適用待ちの修正案はありません");
      return false;
    }
    this.pending = undefined;
    const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === proposal.documentUri.toString());
    if (!document || document.version !== proposal.version) {
      void vscode.window.showWarningMessage("Voice Coder: 修正案の作成後にファイルが変わったので適用しません");
      return false;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, proposal.range, proposal.newText);
    return vscode.workspace.applyEdit(edit);
  }

  discardProposal(): void {
    this.pending = undefined;
  }

  private finish(run: Run, applied: boolean, message: string): void {
    this.onStatus("done", message);
    this.report({ kind: run.dispatch.intent.kind, applied, speculative: run.dispatch.speculative, message, output: run.output });
  }

  private report(report: ActionReport): void {
    this.reported.fire(report);
  }

  dispose(): void {
    this.provider.dispose();
    this.reported.dispose();
  }
}

/**
 * The code a command is about: the spoken line range, else the selection,
 * else the whole file (explain/debug); the cursor for generate.
 */
export function resolveTarget(editor: vscode.TextEditor, intent: Intent): { target: AgentTarget; insertAt: vscode.Position } {
  const document = editor.document;
  const last = document.lineCount - 1;
  let startLine: number;
  let endLine: number;
  if (intent.kind === "generate") {
    startLine = endLine = editor.selection.active.line;
  } else if (intent.range) {
    startLine = Math.min(Math.max(intent.range.from - 1, 0), last);
    endLine = Math.min(Math.max(intent.range.to - 1, startLine), last);
  } else if (!editor.selection.isEmpty) {
    startLine = editor.selection.start.line;
    endLine = editor.selection.end.line;
  } else {
    startLine = 0;
    endLine = last;
  }
  const code =
    intent.kind === "generate"
      ? ""
      : document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));
  const target: AgentTarget = {
    fileName: document.fileName,
    languageId: document.languageId,
    startLine,
    endLine,
    code,
  };
  return { target, insertAt: editor.selection.active };
}

function errorsIn(document: vscode.TextDocument, target: AgentTarget) {
  return vscode.languages
    .getDiagnostics(document.uri)
    .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
    .filter((d) => d.range.end.line >= target.startLine && d.range.start.line <= target.endLine)
    .map((d) => ({ line: d.range.start.line, message: d.message }));
}
