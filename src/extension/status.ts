import * as vscode from "vscode";

const MAX_TEXT = 60;

function clip(text: string): string {
  return text.length > MAX_TEXT ? "…" + text.slice(-MAX_TEXT) : text;
}

/** The status bar item: idle → listening → partial transcripts → result. */
export class StatusView implements vscode.Disposable {
  readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly changed = new vscode.EventEmitter<string>();
  /** Fires with the item's new text on every change. */
  readonly onDidChange = this.changed.event;
  /** The latest command's state (running / done / error) since listening started. */
  private outcome: { text: string; tooltip: string } | undefined;

  constructor() {
    this.item.command = "voiceCoder.toggleListening";
    this.idle();
    this.item.show();
  }

  idle(): void {
    this.set("$(mic) Voice", "Voice Coder: クリックかキーで音声入力を開始");
  }

  listening(): void {
    this.outcome = undefined;
    this.set("$(record) 聞いています…", "Voice Coder: もう一度押すと停止");
  }

  partial(text: string): void {
    this.set(`$(record) ${clip(text)}`, text);
  }

  finishing(text: string): void {
    this.set(`$(loading~spin) ${clip(text)}`, "Voice Coder: 確定待ち");
  }

  running(label: string): void {
    this.setOutcome(`$(sync~spin) ${label}`, "Voice Coder: 実行中");
  }

  done(label: string): void {
    this.setOutcome(`$(check) ${label}`, "Voice Coder");
  }

  error(message: string): void {
    // The start of an error says what failed; the tooltip has the rest
    this.setOutcome(`$(error) ${message.length > MAX_TEXT ? message.slice(0, MAX_TEXT) + "…" : message}`, message);
  }

  /**
   * Listening has ended: show how the command went, or idle if there was none.
   * (The final often arrives, and the command finishes, before the key is pressed
   * again; the stop must not leave the "waiting" spinner over that result.)
   */
  settled(): void {
    if (this.outcome) this.set(this.outcome.text, this.outcome.tooltip);
    else this.idle();
  }

  private setOutcome(text: string, tooltip: string): void {
    this.outcome = { text, tooltip };
    this.set(text, tooltip);
  }

  private set(text: string, tooltip: string): void {
    this.item.text = text;
    this.item.tooltip = tooltip;
    this.changed.fire(text);
  }

  dispose(): void {
    this.item.dispose();
    this.changed.dispose();
  }
}
