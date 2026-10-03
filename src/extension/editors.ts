import * as vscode from "vscode";

/** Documents a command may read and write: files on disk and untitled buffers. */
const CODE_SCHEMES = new Set(["file", "untitled", "vscode-remote", "vscode-userdata"]);

export function isCodeEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
  return !!editor && CODE_SCHEMES.has(editor.document.uri.scheme) && !editor.document.isClosed;
}

/**
 * The editor a spoken command is about. The Output panel, a diff's proposal
 * side or a settings view can hold the focus (and count as the "active" text
 * editor); commands go to the code the user was last working in instead.
 */
export class CodeEditorTracker implements vscode.Disposable {
  private last: vscode.TextEditor | undefined;
  private readonly subscription: vscode.Disposable;

  constructor() {
    if (isCodeEditor(vscode.window.activeTextEditor)) this.last = vscode.window.activeTextEditor;
    this.subscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (isCodeEditor(editor)) this.last = editor;
    });
  }

  /** The active editor if it holds code, else the last one that did (if still shown), else any visible one. */
  get current(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (isCodeEditor(active)) return active;
    const visible = vscode.window.visibleTextEditors.filter(isCodeEditor);
    if (this.last && visible.some((e) => e.document === this.last!.document)) {
      return visible.find((e) => e.document === this.last!.document);
    }
    return visible[0];
  }

  dispose(): void {
    this.subscription.dispose();
  }
}
