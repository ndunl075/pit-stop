let context: AudioContext | undefined;
export async function unlockSound() {
  context ??= new AudioContext();
  await context.resume();
}
export function playCue(failure: boolean, volume: number) {
  if (!context || context.state !== "running") return;
  const osc = context.createOscillator(),
    gain = context.createGain(),
    now = context.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(failure ? 240 : 660, now);
  osc.frequency.exponentialRampToValueAtTime(failure ? 170 : 880, now + 0.1);
  gain.gain.setValueAtTime(Math.min(0.12, volume * 0.12), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start();
  osc.stop(now + 0.15);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}
