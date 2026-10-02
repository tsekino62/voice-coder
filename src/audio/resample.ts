/**
 * 16-bit mono PCM from one sample rate to another by linear interpolation
 * (OpenAI's realtime API takes 24 kHz; our audio is 16 kHz). Good enough
 * for speech recognition, not for listening.
 */
export function resamplePcm16(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return pcm;
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const length = Math.round((input.length * toRate) / fromRate);
  const output = Buffer.alloc(length * 2);
  for (let i = 0; i < length; i++) {
    const pos = (i * fromRate) / toRate;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    const value = input[lo] + (input[hi] - input[lo]) * (pos - lo);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), i * 2);
  }
  return output;
}
