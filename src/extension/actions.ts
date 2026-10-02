import * as vscode from "vscode";
import type { AgentBackend, AgentContext, AgentTarget } from "../agent/AgentBackend.js";
import { extractCodeBlock, parseFileEdits, safeRelativePath } from "../agent/prompt.js";
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

/** One file in a proposal: created, or rewritten as a whole. */
export interface ProposedChange {
  uri: vscode.Uri;
  /** A new file (it did not exist when the proposal was made). */
  create: boolean;
  /** The file's text when the proposal was made; applying is refused if it changed since. */
  originalText: string;
  /** The whole file as it would be after applying. */
  newText: string;
  /** Left side of the diff: the file itself, or an empty document for a new file. */
  originalUri: vscode.Uri;
  /** Right side of the diff. */
  proposalUri: vscode.Uri;
}

/** Changes waiting for approval (debug / refactor / create). Nothing is written until applied. */
export interface Proposal {
  id: number;
  title: string;
  changes: ProposedChange[];
}

type NewChange = Omit<ProposedChange, "originalUri" | "proposalUri">;

/** Open files beyond this size are not sent to the agent as context. */
const MAX_CONTEXT_FILE_CHARS = 60_000;
const MAX_CONTEXT_FILES = 10;
const MAX_WORKSPACE_FILES = 300;

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
  /** Right-hand diff documents by URI. */
  private readonly proposedTexts = new Map<string, string>();
  private pending: Proposal | undefined;
  private nextProposalId = 1;
  private readonly provider: vscode.Disposable;

  constructor(
    private readonly agent: () => AgentBackend,
    private readonly output: vscode.OutputChannel,
    private readonly onStatus: (state: "running" | "done" | "error", label: string) => void,
  ) {
    this.provider = vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, {
      provideTextDocumentContent: (uri) => this.proposedTexts.get(uri.toString()) ?? "",
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
      const multiFile = dispatch.intent.kind === "refactor" || dispatch.intent.kind === "create";
      run.done = (async () => {
        if (multiFile) {
          context.files = openFiles(editor.document);
          context.workspaceFiles = await workspaceFiles();
          if (dispatch.signal.aborted) return;
        }
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
      case "refactor":
      case "create":
        await this.proposeFileEdits(run, name);
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
    const replacement = extractCodeBlock(run.output);
    if (replacement === document.getText(range)) {
      this.finish(run, false, `${name}: 修正案はありません`);
      return;
    }
    const full = document.getText();
    const newText = full.slice(0, document.offsetAt(range.start)) + replacement + full.slice(document.offsetAt(range.end));
    await this.propose(run, name, `修正案（未適用）: ${name}`, [{ uri: document.uri, create: false, originalText: full, newText }]);
  }

  /** refactor / create: the agent's `=== path ===` files, as one proposal over all of them. */
  private async proposeFileEdits(run: Run, name: string): Promise<void> {
    const edits = parseFileEdits(run.output);
    if (edits.length === 0) {
      this.finish(run, false, `${name}: 変更案がありませんでした`);
      return;
    }
    const root = vscode.workspace.getWorkspaceFolder(run.document!.uri)?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      this.finish(run, false, `${name}: ファイルを作るにはフォルダー（ワークスペース）を開いてください`);
      return;
    }
    const changes: NewChange[] = [];
    for (const edit of edits) {
      const path = safeRelativePath(edit.path);
      // The agent's reply decides file names: never let one point outside the workspace
      if (!path) {
        this.finish(run, false, `${name}: ワークスペースの外を指すパスがあったので中止しました（${edit.path}）`);
        return;
      }
      const uri = vscode.Uri.joinPath(root, path);
      const existing = await readText(uri);
      if (existing === edit.content) continue;
      changes.push({ uri, create: existing === undefined, originalText: existing ?? "", newText: edit.content });
    }
    if (changes.length === 0) {
      this.finish(run, false, `${name}: 変更はありませんでした`);
      return;
    }
    await this.propose(run, name, `変更案（未適用）: ${name}`, changes);
  }

  /** Show the changes as diffs and keep them pending until approved. */
  private async propose(run: Run, name: string, title: string, changes: NewChange[]): Promise<void> {
    const id = this.nextProposalId++;
    const proposal: Proposal = {
      id,
      title,
      changes: changes.map((change, i) => {
        const path = change.uri.path || "/untitled";
        const proposalUri = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path, query: `id=${id}&file=${i}` });
        const originalUri = change.create ? vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path, query: `id=${id}&file=${i}&empty` }) : change.uri;
        this.proposedTexts.set(proposalUri.toString(), change.newText);
        return { ...change, originalUri, proposalUri };
      }),
    };
    this.pending = proposal;

    const [first] = proposal.changes;
    if (proposal.changes.length === 1 && !first.create) {
      await vscode.commands.executeCommand("vscode.diff", first.uri, first.proposalUri, `Voice Coder ${title}`, { preview: true, preserveFocus: true });
    } else {
      // Every file in one multi-file diff editor
      await vscode.commands.executeCommand(
        "vscode.changes",
        `Voice Coder ${title}`,
        proposal.changes.map((c) => [c.uri, c.originalUri, c.proposalUri]),
      );
    }
    const summary = proposal.changes.map((c) => `${c.create ? "新規" : "変更"} ${vscode.workspace.asRelativePath(c.uri)}`).join("、");
    this.finish(run, true, `${name}: ${proposal.changes.length} ファイルの変更案を表示しました（未適用）`);
    void vscode.window.showInformationMessage(`Voice Coder: 適用しますか？ ${summary}`, "適用", "破棄").then((choice) => {
      if (this.pending?.id !== id) return;
      if (choice === "適用") void this.applyProposal();
      else if (choice === "破棄") this.discardProposal();
    });
  }

  /**
   * Write the pending changes in one WorkspaceEdit, unless a file changed
   * (or a new file appeared) since the proposal was made.
   */
  async applyProposal(): Promise<boolean> {
    const proposal = this.pending;
    if (!proposal) {
      void vscode.window.showWarningMessage("Voice Coder: 適用待ちの変更案はありません");
      return false;
    }
    this.pending = undefined;
    const edit = new vscode.WorkspaceEdit();
    for (const change of proposal.changes) {
      const current = await readText(change.uri);
      if (change.create ? current !== undefined : current !== change.originalText) {
        void vscode.window.showWarningMessage(`Voice Coder: 変更案の作成後に ${vscode.workspace.asRelativePath(change.uri)} が変わったので適用しません`);
        return false;
      }
      if (change.create) {
        edit.createFile(change.uri, { contents: new TextEncoder().encode(change.newText) });
      } else {
        const document = await vscode.workspace.openTextDocument(change.uri);
        edit.replace(change.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), change.newText);
      }
    }
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
    fileName: document.uri.scheme === "file" ? vscode.workspace.asRelativePath(document.uri, false) : document.fileName,
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

/** A file's text: the open document's (unsaved edits included), else from disk; undefined if it does not exist. */
async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** The editor's other open files, as context for a change that may span files. */
function openFiles(active: vscode.TextDocument): Array<{ path: string; text: string }> {
  return vscode.workspace.textDocuments
    .filter((d) => d !== active && d.uri.scheme === "file" && d.getText().length <= MAX_CONTEXT_FILE_CHARS)
    .slice(0, MAX_CONTEXT_FILES)
    .map((d) => ({ path: vscode.workspace.asRelativePath(d.uri, false), text: d.getText() }));
}

async function workspaceFiles(): Promise<string[]> {
  if (!vscode.workspace.workspaceFolders?.length) return [];
  const uris = await vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}", MAX_WORKSPACE_FILES);
  return uris.map((uri) => vscode.workspace.asRelativePath(uri, false)).sort();
}
