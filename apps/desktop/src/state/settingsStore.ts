export interface Settings {
  infer_commands: boolean;
  theme: "midnight" | "paper" | "ember";
  motion: "system" | "full" | "reduced";
  sound: boolean;
  volume: number;
  preset: "compact" | "expanded" | "capture";
  always_on_top: boolean;
  fps: 30 | 60;
}
export const defaults: Settings = {
  infer_commands: true,
  theme: "midnight",
  motion: "system",
  sound: false,
  volume: 0.2,
  preset: "expanded",
  always_on_top: false,
  fps: 60,
};
export function normalizeSettings(input: unknown): Settings {
  const s = (
    input && typeof input === "object" ? input : {}
  ) as Partial<Settings>;
  return {
    infer_commands: s.infer_commands !== false,
    theme: ["midnight", "paper", "ember"].includes(s.theme!)
      ? s.theme!
      : defaults.theme,
    motion: ["system", "full", "reduced"].includes(s.motion!)
      ? s.motion!
      : defaults.motion,
    sound: s.sound === true,
    volume:
      typeof s.volume === "number" && Number.isFinite(s.volume)
        ? Math.max(0, Math.min(1, s.volume))
        : defaults.volume,
    preset: ["compact", "expanded", "capture"].includes(s.preset!)
      ? s.preset!
      : defaults.preset,
    always_on_top: s.always_on_top === true,
    fps: s.fps === 30 ? 30 : 60,
  };
}
