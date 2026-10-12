# Deterministic visual regression tests

From the repository root on Windows:

```powershell
pnpm install --frozen-lockfile
pnpm test:visual:install
pnpm test:visual
```

The pinned Playwright 1.56.1 runner installs its matching Chromium once. Downloads are development prerequisites only; the app and tests use local assets at runtime. The runner starts and stops its own Vite server on **127.0.0.1:1427**, refuses to reuse an existing server, and uses one browser worker. Normal development on port 1420 remains separate. No coding-agent hooks, accounts, subscriptions, or native settings are required or changed.

Committed baselines in `baselines/win32` target Windows, the pinned headless Chromium, software ANGLE/SwiftShader rendering, 100% browser scaling, device scale factor 1, locale en-US, and UTC. This checks browser scene rendering, not native window-manager behavior or hardware GPU performance. Platform-specific font rendering makes these Windows baselines unsuitable for claiming macOS/Linux visual verification. Other platforms generate their own platform directory and require deliberate review before baselines are accepted.

The tests install and stop Playwright's clock **before app code loads**, wait for local SVGs and the Pixi canvas, and seek to exact demo timestamps. The development-only seek replays the production event reducer, scheduler, and scene renderer against fixture timestamps, eliminating asynchronous React/RAF startup jitter rather than accepting it with a broad image tolerance. They cover arrival, inspect, edit, test, build, shell, radio, delegation, failure, release, and departure at 720×405; compact 420×240 and clean capture 1280×720 layouts; system reduced-motion poses; and pause/resume. Reduced-motion canvas pixels must remain exactly unchanged across two different working timestamps. A separate pause/resume test runs the ordinary demo timer, without the seek seam, and requires paused pixels to remain unchanged for five simulated seconds. Outbound requests are blocked and fail the test, as do browser runtime errors. Screenshots permit at most 50 differing pixels at a 0.15 per-pixel threshold, rather than accepting broad image changes.

`--mode visual-test` enables development-only visual seams: the browser uses the native overlay CSS; adding `?snapshot` also installs a `pit-stop:visual-seek` DOM event handler and suspends automatic presentation updates. These controls do not emulate Tauri APIs or native integration success. Ordinary development and production builds keep their existing layout and animation behavior. The native shell itself still requires desktop testing.

## Reviewing an intentional change

```powershell
pnpm test:visual:update
pnpm test:visual
```

Inspect every changed image before committing it. Baselines are not regenerated during normal tests. Missing baselines fail normal runs. Failure screenshots, image diffs, and traces are written under `apps/desktop/test-results/visual`; the local HTML report is `apps/desktop/playwright-report/index.html`. These generated reports are ignored by Git. To view the report: `pnpm --filter desktop exec playwright show-report`.
