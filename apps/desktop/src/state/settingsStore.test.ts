import { it, expect } from "vitest";
import { defaults, normalizeSettings } from "./settingsStore";
it("loads safe defaults and validates local preferences", () => {
  expect(normalizeSettings(null)).toEqual(defaults);
  expect(
    normalizeSettings({ sound: "yes", volume: 50, fps: 144, theme: "remote" }),
  ).toEqual({ ...defaults, volume: 1 });
  expect(normalizeSettings({ motion: "reduced", fps: 30 }).motion).toBe(
    "reduced",
  );
});
