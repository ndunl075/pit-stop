import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PitStopEvent, Source } from "./contracts/events";
import {
  defaults,
  normalizeSettings,
  type Settings,
} from "./state/settingsStore";
export const native = isTauri();
export interface IntegrationPreview {
  source: Source;
  path: string;
  before: string | null;
  after: string;
  changed: boolean;
  warning: string | null;
}
export async function settingsLoad(): Promise<Settings> {
  if (native) return normalizeSettings(await invoke("get_settings"));
  try {
    return normalizeSettings(
      JSON.parse(localStorage.getItem("pit-stop-settings") ?? "null"),
    );
  } catch {
    return defaults;
  }
}
export async function settingsSave(settings: Settings) {
  if (native) await invoke("save_settings", { settings });
  else localStorage.setItem("pit-stop-settings", JSON.stringify(settings));
}
export async function subscribeEvents(fn: (event: PitStopEvent) => void) {
  if (!native) return () => {};
  return listen<PitStopEvent>("pit-stop:event", (e) => fn(e.payload));
}
export async function command<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    throw new Error(
      "Open the desktop app to use local integrations. This browser preview runs the offline demo.",
    );
  return invoke<T>(name, args);
}
