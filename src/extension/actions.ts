import * as vscode from "vscode";
import type { AgentBackend, AgentContext, AgentTarget } from "../agent/AgentBackend.js";
import { extractCodeBlock, extractCodeBlockLanguage, parseFileEdits, safeRelativePath } from "../agent/prompt.js";
import type { Dispatch, Resolution } from "../intent/speculator.js";
import type { Intent, IntentKind } from "../intent/types.js";
import { languageOf } from "../intent/language.js";
import { CodeEditorTracker } from "./editors.js";
import { noteSpokenLanguage, t } from "./messages.js";
import { runInTerminal } from "./run.js";

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
  private pendingProposalValue: Proposal | undefined;
  /** The proposal awaiting approval; also drives the 適用 / 破棄 buttons and Ctrl+Alt+Enter (voiceCoder.hasProposal). */
  private get pending(): Proposal | undefined {
    return this.pendingProposalValue;
  }
  private set pending(proposal: Proposal | undefined) {
    this.pendingProposalValue = proposal;
    void vscode.commands.executeCommand("setContext", "voiceCoder.hasProposal", proposal !== undefined);
  }
  private nextProposalId = 1;
  private readonly provider: vscode.Disposable;
  private readonly editors = new CodeEditorTracker();

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
    // Not activeTextEditor: with the Output panel focused that is the panel itself
    const editor = this.editors.current;
    const run: Run = { dispatch, document: editor?.document, target: undefined, insertAt: undefined, output: "", live: undefined, done: Promise.resolve() };
    const kind = dispatch.intent.kind;
    let target: AgentTarget | undefined;
    let context: AgentContext | undefined;
    if (editor) {
      const resolved = resolveTarget(editor, dispatch.intent);
      target = resolved.target;
      run.insertAt = resolved.insertAt;
      context = { utterance: dispatch.text, documentText: editor.document.getText(), diagnostics: errorsIn(editor.document, target), signal: dispatch.signal };
    } else if (kind === "generate" || kind === "create") {
      // Nothing open (an empty folder, a fresh window): new code starts from nothing.
      // The language comes from the request or the workspace; generate opens a new file for it.
      target = { fileName: "", languageId: "", startLine: 0, endLine: 0, code: "" };
      context = { utterance: dispatch.text, documentText: "", diagnostics: [], signal: dispatch.signal };
    }
    if (kind === "run") {
      // Nothing for an agent to do; the command is built and run once the final confirms it
      run.target = target;
      this.runs.set(dispatch, run);
      return;
    }
    if (target && context) {
      run.target = target;
      const agentTarget = target;
      const agentContext = context;
      const withWorkspace = kind === "refactor" || kind === "create" || !editor;
      run.done = (async () => {
        if (withWorkspace) {
          agentContext.files = openFiles(editor?.document);
          agentContext.workspaceFiles = await workspaceFiles();
          if (dispatch.signal.aborted) return;
        }
        for await (const text of this.agent().run(dispatch.intent, agentTarget, agentContext)) {
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
  /** No command is being carried out (agent runs and their results all settled). */
  get idle(): boolean {
    return this.resolving === 0 && this.runs.size === 0;
  }
  private resolving = 0;

  async resolve(resolution: Resolution): Promise<void> {
    this.resolving++;
    try {
      await this.resolveOne(resolution);
    } finally {
      this.resolving--;
    }
  }

  private async resolveOne(resolution: Resolution): Promise<void> {
    // Messages follow the language the command was spoken in
    if (/[\p{L}]/u.test(resolution.text)) noteSpokenLanguage(languageOf(resolution.text));
    for (const aborted of resolution.aborted) this.runs.delete(aborted);
    const dispatch = resolution.dispatch;
    if (!dispatch) {
      // Soniox sometimes closes an utterance with a lone 。 as its own final: nothing was said
      if (!/[\p{L}\p{N}]/u.test(resolution.text)) return;
      const message = t("noCommand", resolution.text);
      this.onStatus("done", message);
      this.report({ kind: null, applied: false, speculative: false, message });
      return;
    }
    const run = this.runs.get(dispatch);
    this.runs.delete(dispatch);
    const name = label(dispatch.intent);
    if (dispatch.intent.kind === "run" && run) {
      this.onStatus("running", name);
      const result = await runInTerminal(run.document, dispatch.text);
      if (result.error) {
        this.onStatus("error", `${name}: ${result.error}`);
        void vscode.window.showWarningMessage(`Voice Coder: ${result.error}`);
      }
      this.finish(run, !result.error, result.error ?? `run: ${result.command}`);
      return;
    }
    if (!run?.target) {
      // explain / debug / refactor need code to work on
      const message = t("openFileFirst");
      this.onStatus("error", `${name}: ${message}`);
      void vscode.window.showWarningMessage(`Voice Coder: ${name} — ${message}`);
      this.report({ kind: dispatch.intent.kind, applied: false, speculative: dispatch.speculative, message });
      return;
    }

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
      void vscode.window.showErrorMessage(`Voice Coder: ${t("agentFailed", name, message)}`);
      this.report({ kind: dispatch.intent.kind, applied: false, speculative: dispatch.speculative, message: t("agentFailedShort"), error: message });
      return;
    }
    if (dispatch.signal.aborted) return;

    switch (dispatch.intent.kind) {
      case "explain":
        this.output.appendLine("");
        this.finish(run, true, t("shownInOutput", name));
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
    if (!run.document) {
      await this.generateIntoNewDocument(run, name);
      return;
    }
    const document = run.document;
    const position = document.validatePosition(run.insertAt!);
    let code = extractCodeBlock(run.output);
    if (!code.endsWith("\n")) code += "\n";
    if (position.character > 0) code = "\n" + code;
    // One WorkspaceEdit, so a single undo takes it all back
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, position, code);
    const applied = await vscode.workspace.applyEdit(edit);
    this.finish(run, applied, applied ? t("inserted", name) : t("insertFailed", name));
  }

  private async proposeFix(run: Run, name: string): Promise<void> {
    const document = run.document!;
    const target = run.target!;
    const range = new vscode.Range(target.startLine, 0, target.endLine, document.lineAt(target.endLine).text.length);
    const replacement = extractCodeBlock(run.output);
    if (replacement === document.getText(range)) {
      this.finish(run, false, t("noFix", name));
      return;
    }
    const full = document.getText();
    const newText = full.slice(0, document.offsetAt(range.start)) + replacement + full.slice(document.offsetAt(range.end));
    await this.propose(run, name, t("fixTitle", name), [{ uri: document.uri, create: false, originalText: full, newText }]);
  }

  /** generate with no file open: the code goes into a new, unsaved file in the language the agent chose. */
  private async generateIntoNewDocument(run: Run, name: string): Promise<void> {
    let code = extractCodeBlock(run.output);
    if (!code.endsWith("\n")) code += "\n";
    const known = await vscode.languages.getLanguages();
    const language = languageIdFor(extractCodeBlockLanguage(run.output), known);
    const document = await vscode.workspace.openTextDocument({ content: code, language });
    await vscode.window.showTextDocument(document);
    this.finish(run, true, t("newFileWritten", name, language));
  }

  /** refactor / create: the agent's `=== path ===` files, as one proposal over all of them. */
  private async proposeFileEdits(run: Run, name: string): Promise<void> {
    const edits = parseFileEdits(run.output);
    if (edits.length === 0) {
      this.finish(run, false, t("noProposal", name));
      return;
    }
    const root = (run.document && vscode.workspace.getWorkspaceFolder(run.document.uri)?.uri) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      this.finish(run, false, t("needFolder", name));
      return;
    }
    const changes: NewChange[] = [];
    for (const edit of edits) {
      const path = safeRelativePath(edit.path);
      // The agent's reply decides file names: never let one point outside the workspace
      if (!path) {
        this.finish(run, false, t("outsideWorkspace", name, edit.path));
        return;
      }
      const uri = vscode.Uri.joinPath(root, path);
      const existing = await readText(uri);
      if (existing === edit.content) continue;
      changes.push({ uri, create: existing === undefined, originalText: existing ?? "", newText: edit.content });
    }
    if (changes.length === 0) {
      this.finish(run, false, t("noChanges", name));
      return;
    }
    await this.propose(run, name, t("changesTitle", name), changes);
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
    const summary = proposal.changes.map((c) => t(c.create ? "newEntry" : "changedEntry", vscode.workspace.asRelativePath(c.uri))).join(t("listSeparator"));
    this.finish(run, true, t("proposalShown", name, proposal.changes.length));
    const [apply, discard] = [t("apply"), t("discard")];
    void vscode.window.showInformationMessage(t("applyQuestion", summary), apply, discard).then((choice) => {
      if (this.pending?.id !== id) return;
      if (choice === apply) void this.applyProposal();
      else if (choice === discard) this.discardProposal();
    });
  }

  /**
   * Write the pending changes in one WorkspaceEdit, unless a file changed
   * (or a new file appeared) since the proposal was made.
   */
  async applyProposal(): Promise<boolean> {
    const proposal = this.pending;
    if (!proposal) {
      void vscode.window.showWarningMessage(t("nothingPending"));
      return false;
    }
    this.pending = undefined;
    const edit = new vscode.WorkspaceEdit();
    for (const change of proposal.changes) {
      const current = await readText(change.uri);
      if (change.create ? current !== undefined : current !== change.originalText) {
        void vscode.window.showWarningMessage(t("changedSince", vscode.workspace.asRelativePath(change.uri)));
        return false;
      }
      if (change.create) {
        edit.createFile(change.uri, { contents: new TextEncoder().encode(change.newText) });
      } else {
        const document = await vscode.workspace.openTextDocument(change.uri);
        edit.replace(change.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), change.newText);
      }
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) await closeProposalTabs();
    return applied;
  }

  discardProposal(): void {
    this.pending = undefined;
    void closeProposalTabs();
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
    this.editors.dispose();
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

/** The "Voice Coder 変更案（未適用）" diff tabs: once a proposal is applied or dropped they only mislead. */
async function closeProposalTabs(): Promise<void> {
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.label.startsWith("Voice Coder "));
  if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
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

const FENCE_LANGUAGES: Record<string, string> = {
  ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact", py: "python", rb: "ruby",
  rs: "rust", cs: "csharp", "c#": "csharp", "c++": "cpp", sh: "shellscript", bash: "shellscript", kt: "kotlin", golang: "go",
};

/** A VS Code language id for a code fence tag (```ts, ```python ...), plaintext when unknown. */
export function languageIdFor(fence: string, known: string[]): string {
  const tag = fence.trim().toLowerCase();
  const id = FENCE_LANGUAGES[tag] ?? tag;
  return known.includes(id) ? id : "plaintext";
}

/** The editor's other open files, as context for a change that may span files. */
function openFiles(active: vscode.TextDocument | undefined): Array<{ path: string; text: string }> {
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
