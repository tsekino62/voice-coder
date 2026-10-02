import * as vscode from "vscode";
import { IntentSpeculator } from "../intent/speculator.js";
import type { SttBackend } from "../stt/SttBackend.js";
import type { ActionRunner } from "./actions.js";
import type { StatusView } from "./status.js";

/**
 * Push-to-talk: the first toggle starts the STT backend, the second stops it
 * and waits for the last final. Partials go to the status bar; intents go to
 * the action runner through the speculator.
 */
export class VoiceController implements vscode.Disposable {
  private stt: SttBackend | undefined;
  private lastText = "";
  private starting: Promise<void> | undefined;

  constructor(
    private readonly createStt: () => SttBackend,
    private readonly actions: ActionRunner,
    private readonly status: StatusView,
  ) {}

  get listening(): boolean {
    return this.stt !== undefined;
  }

  async toggle(): Promise<void> {
    if (this.stt) await this.stop();
    else await this.start();
  }

  async start(): Promise<void> {
    if (this.stt) return;
    let stt: SttBackend;
    try {
      stt = this.createStt();
    } catch (error) {
      this.fail(error);
      return;
    }
    this.stt = stt;
    this.lastText = "";
    new IntentSpeculator(stt, {
      onIntent: (dispatch) => this.actions.begin(dispatch),
      onResolved: (resolution) => void this.actions.resolve(resolution),
    });
    stt.onPartial(({ text }) => {
      this.lastText = text;
      this.status.partial(text);
    });
    stt.onFinal(({ text }) => (this.lastText = text));
    this.status.listening();
    this.starting = stt.start();
    try {
      await this.starting;
    } catch (error) {
      this.stt = undefined;
      this.fail(error);
    } finally {
      this.starting = undefined;
    }
  }

  async stop(): Promise<void> {
    const stt = this.stt;
    if (!stt) return;
    this.status.finishing(this.lastText || "…");
    await this.starting?.catch(() => {});
    try {
      await stt.stop();
    } catch (error) {
      this.fail(error);
    } finally {
      if (this.stt === stt) this.stt = undefined;
    }
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.status.error(message);
    void vscode.window.showErrorMessage(`Voice Coder: ${message}`);
  }

  dispose(): void {
    void this.stt?.stop();
  }
}
