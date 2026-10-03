import * as vscode from "vscode";
import { t } from "./messages.js";

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
  /** The microphone is open: every text carries the record mark, results included. */
  private open = false;

  constructor() {
    this.item.command = "voiceCoder.toggleListening";
    this.idle();
    this.item.show();
  }

  idle(): void {
    this.set("$(mic) Voice", t("idleTooltip"));
  }

  listening(): void {
    this.outcome = undefined;
    this.open = true;
    this.set(`$(record) ${t("listening")}`, t("listeningTooltip"));
  }

  partial(text: string): void {
    this.set(`$(record) ${clip(text)}`, text);
  }

  finishing(text: string): void {
    this.set(`$(loading~spin) ${clip(text)}`, t("finishingTooltip"));
  }

  running(label: string): void {
    this.setOutcome(`$(sync~spin) ${label}`, t("runningTooltip"));
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
    this.open = false;
    if (this.outcome) this.set(this.outcome.text, this.outcome.tooltip);
    else this.idle();
  }

  private setOutcome(text: string, tooltip: string): void {
    this.outcome = { text, tooltip };
    // Still listening (a result came in before the microphone closed): say so
    if (this.open) this.set(`$(record) ${text}`, `${tooltip} — ${t("listeningTooltip")}`);
    else this.set(text, tooltip);
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
