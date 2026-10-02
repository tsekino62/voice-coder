"""voice-coder microphone sidecar: streams 16 kHz mono 16-bit PCM to stdout as JSON Lines.

The VS Code extension starts this when listening begins and sends {"cmd": "stop"} on stdin
when the user releases push-to-talk. Capture is the same as stt_probe/record_takes.py
(PyAudio, 512 frames per read).

Usage:
    python mic_sidecar.py                  # default input device
    python mic_sidecar.py --device 1       # PyAudio input device index
    python mic_sidecar.py --list-devices
    python mic_sidecar.py --wav take.wav   # replay a WAV at real-time pace instead of the mic (no PyAudio needed)

stdout, one JSON object per line:
    {"type": "ready", "sample_rate": 16000, "source": "mic" | "wav"}
    {"type": "audio", "pcm": "<base64 of 16-bit little-endian PCM>"}
    {"type": "end"}
    {"type": "error", "message": "..."}
stdin, one JSON object per line (EOF also stops):
    {"cmd": "stop"}
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import threading
import time
import wave
from typing import Callable, Optional

SAMPLE_RATE = 16000
FRAMES_PER_READ = 512  # 32 ms

_out_lock = threading.Lock()


def emit(message: dict) -> None:
    with _out_lock:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()


def watch_stdin(stop: threading.Event) -> None:
    """Set `stop` on {"cmd": "stop"} or when the extension closes our stdin."""
    for line in sys.stdin:
        try:
            if json.loads(line).get("cmd") == "stop":
                break
        except (ValueError, AttributeError):
            continue
    stop.set()


def stream_wav(path: str, stop: threading.Event) -> None:
    with wave.open(path, "rb") as wav:
        if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (SAMPLE_RATE, 1, 2):
            raise ValueError(f"{path}: WAV must be {SAMPLE_RATE} Hz, mono, 16-bit PCM")
        started = time.perf_counter()
        sent = 0
        while not stop.is_set():
            pcm = wav.readframes(FRAMES_PER_READ)
            if not pcm:
                break
            sent += len(pcm) // 2
            # Hand a chunk over once the audio in it would have been spoken
            time.sleep(max(0.0, started + sent / SAMPLE_RATE - time.perf_counter()))
            emit({"type": "audio", "pcm": base64.b64encode(pcm).decode("ascii")})


def stream_mic(device: Optional[int], stop: threading.Event) -> None:
    import pyaudio  # only the mic needs it

    audio = pyaudio.PyAudio()
    try:
        stream = audio.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=SAMPLE_RATE,
            input=True,
            frames_per_buffer=FRAMES_PER_READ,
            input_device_index=device,
        )
        try:
            while not stop.is_set():
                pcm = stream.read(FRAMES_PER_READ, exception_on_overflow=False)
                emit({"type": "audio", "pcm": base64.b64encode(pcm).decode("ascii")})
        finally:
            stream.stop_stream()
            stream.close()
    finally:
        audio.terminate()


def list_devices() -> None:
    import pyaudio

    audio = pyaudio.PyAudio()
    try:
        for i in range(audio.get_device_count()):
            info = audio.get_device_info_by_index(i)
            if info.get("maxInputChannels", 0) > 0:
                print(f"{i}: {info['name']}")
    finally:
        audio.terminate()


def main() -> int:
    parser = argparse.ArgumentParser(description="Stream microphone PCM as JSON Lines")
    parser.add_argument("--device", type=int, default=None, help="PyAudio input device index")
    parser.add_argument("--wav", default=None, help="replay this WAV instead of the microphone")
    parser.add_argument("--list-devices", action="store_true")
    args = parser.parse_args()
    if args.list_devices:
        list_devices()
        return 0

    stop = threading.Event()
    threading.Thread(target=watch_stdin, args=(stop,), daemon=True).start()
    source: Callable[[], None]
    if args.wav:
        source = lambda: stream_wav(args.wav, stop)  # noqa: E731
    else:
        source = lambda: stream_mic(args.device, stop)  # noqa: E731
    emit({"type": "ready", "sample_rate": SAMPLE_RATE, "source": "wav" if args.wav else "mic"})
    try:
        source()
    except Exception as e:  # noqa: BLE001 - report every failure to the extension
        emit({"type": "error", "message": f"{type(e).__name__}: {e}"})
        return 1
    emit({"type": "end"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
