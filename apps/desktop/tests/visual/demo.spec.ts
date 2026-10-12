import { expect, test, type Page } from "@playwright/test";

test.use({
  video: process.env.PIT_STOP_RECORD_DEMO
    ? { mode: "on", size: { width: 800, height: 450 } }
    : "off",
});

const epoch = new Date("2026-10-12T12:00:00.000Z");
type Preset = "compact" | "expanded" | "capture";
const sizes = {
  compact: { width: 420, height: 240 },
  expanded: { width: 720, height: 405 },
  capture: { width: 1280, height: 720 },
};

async function prepare(
  page: Page,
  preset: Preset = "expanded",
  reduced = false,
  snapshots = true,
) {
  const remoteRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      remoteRequests.push(url.origin);
      await route.abort();
    } else await route.continue();
  });
  await page.setViewportSize(sizes[preset]);
  await page.emulateMedia({
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await page.addInitScript(
    ({ preset }) => {
      localStorage.setItem(
        "pit-stop-settings",
        JSON.stringify({
          preset,
          theme: "midnight",
          motion: "system",
          sound: false,
          volume: 0.2,
          fps: 60,
          always_on_top: false,
          infer_commands: true,
        }),
      );
    },
    { preset },
  );
  // Install before app code runs and stop all timers, including Pixi's RAF.
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(epoch);
  await page.goto(snapshots ? "/?snapshot" : "/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText("Preparing the crew…")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator(".app")).toHaveClass(
    new RegExp(`preset-${preset} native`),
  );
  if (snapshots)
    await expect(page.locator(".pixi-host")).toHaveAttribute(
      "data-visual-ready",
      "true",
    );
  return { remoteRequests, errors };
}
async function seek(page: Page, at: number, previous = 0) {
  await page.clock.runFor(at - previous);
  await page.evaluate(
    (at) =>
      window.dispatchEvent(
        new CustomEvent("pit-stop:visual-seek", { detail: at }),
      ),
    at,
  );
}

const stages = [
  { name: "arrival", at: 700, label: "Rolling into the pit" },
  { name: "inspect", at: 1500, label: "Inspecting" },
  { name: "edit", at: 3150, label: "Editing" },
  { name: "test", at: 4900, label: "Running tests" },
  { name: "build", at: 6900, label: "Building" },
  { name: "shell", at: 8500, label: "Running a command" },
  { name: "radio", at: 9900, label: "Receiving a tool signal" },
  { name: "delegate", at: 11500, label: "Extra hands on deck" },
  { name: "failure", at: 13350, label: "Tool failed" },
  { name: "release", at: 15300, label: "Turn finished" },
  { name: "departed", at: 16900, label: "Turn finished" },
];

test("expanded: every major demo operation at a deterministic timestamp", async ({
  page,
}) => {
  const audit = await prepare(page);
  let now = 0;
  for (const stage of stages) {
    await seek(page, stage.at, now);
    now = stage.at;
    await expect(page.locator(".activity-title")).toHaveText(stage.label);
    await expect(page).toHaveScreenshot(`expanded-${stage.name}.png`);
  }
  expect(audit.remoteRequests).toEqual([]);
  expect(audit.errors).toEqual([]);
});

for (const preset of ["compact", "capture"] as const) {
  test(`${preset}: readable crew and complete overlay framing`, async ({
    page,
  }) => {
    const audit = await prepare(page, preset);
    await seek(page, 3150);
    await expect(page.locator(".activity-title")).toHaveText("Editing");
    await expect(page).toHaveScreenshot(`${preset}-edit.png`);
    expect(
      await page.locator("body").evaluate((body) => body.scrollWidth),
    ).toBe(sizes[preset].width);
    expect(
      await page.locator("body").evaluate((body) => body.scrollHeight),
    ).toBe(sizes[preset].height);
    if (preset === "capture") {
      await expect(page.locator(".topbar")).toBeHidden();
      await expect(page.locator(".controlbar")).toHaveCSS("opacity", "0");
    }
    expect(audit.remoteRequests).toEqual([]);
    expect(audit.errors).toEqual([]);
  });
}

test("system reduced motion: static working pose with honest failure and departure", async ({
  page,
}) => {
  const audit = await prepare(page, "expanded", true);
  await seek(page, 3150);
  await expect(page.locator(".scene-fps")).toHaveText("REDUCED MOTION");
  await expect(page).toHaveScreenshot("reduced-edit.png");
  const pose = await page.locator("canvas").screenshot();
  await seek(page, 3450, 3150);
  expect(await page.locator("canvas").screenshot()).toEqual(pose);
  await seek(page, 13350, 3450);
  await expect(page.locator(".activity-title")).toHaveText("Tool failed");
  await expect(page).toHaveScreenshot("reduced-failure.png");
  await seek(page, 16900, 13350);
  await expect(page).toHaveScreenshot("reduced-departed.png");
  expect(audit.remoteRequests).toEqual([]);
  expect(audit.errors).toEqual([]);
});

test("pause freezes the active crew and resuming advances the demo", async ({
  page,
}) => {
  const audit = await prepare(page, "expanded", false, false);
  await page.clock.runFor(3150);
  await page
    .getByRole("button", { name: "Pause animation", exact: true })
    .click();
  const paused = await page.locator("canvas").screenshot();
  await page.clock.runFor(5000);
  expect(await page.locator("canvas").screenshot()).toEqual(paused);
  await expect(page.locator(".activity-title")).toHaveText("Taking a breather");
  await page
    .getByRole("button", { name: "Resume animation", exact: true })
    .click();
  await page.clock.runFor(1750);
  await expect(page.locator(".activity-title")).toHaveText("Running tests");
  expect(audit.remoteRequests).toEqual([]);
  expect(audit.errors).toEqual([]);
});

// Opt in locally to export a real-time preview of the complete motion story.
// Ordinary visual checks retain their fast, deterministic screenshot clock.
test.describe("demo recording", () => {
  test.skip(!process.env.PIT_STOP_RECORD_DEMO, "Set PIT_STOP_RECORD_DEMO=1 to record");
  test("capture the full demo with its normal animation clock", async ({ page }) => {
    const audit = await prepare(page, "capture", false, false);
    await page.setViewportSize({ width: 800, height: 450 });
    await page.clock.resume();
    await expect(page.locator(".activity-title")).toHaveText("Session ended", {
      timeout: 35_000,
    });
    expect(audit.remoteRequests).toEqual([]);
    expect(audit.errors).toEqual([]);
  });
});
