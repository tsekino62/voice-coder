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

  constructor() {
    this.item.command = "voiceCoder.toggleListening";
    this.idle();
    this.item.show();
  }

  idle(): void {
    this.set("$(mic) Voice", "Voice Coder: クリックかキーで音声入力を開始");
  }

  listening(): void {
    this.set("$(record) 聞いています…", "Voice Coder: もう一度押すと停止");
  }

  partial(text: string): void {
    this.set(`$(record) ${clip(text)}`, text);
  }

  finishing(text: string): void {
    this.set(`$(loading~spin) ${clip(text)}`, "Voice Coder: 確定待ち");
  }

  running(label: string): void {
    this.set(`$(sync~spin) ${label}`, "Voice Coder: 実行中");
  }

  done(label: string): void {
    this.set(`$(check) ${label}`, "Voice Coder");
  }

  error(message: string): void {
    // The start of an error says what failed; the tooltip has the rest
    this.set(`$(error) ${message.length > MAX_TEXT ? message.slice(0, MAX_TEXT) + "…" : message}`, message);
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
