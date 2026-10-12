# Contributing

Read ARCHITECTURE.md first. Keep runtime operation local, free, observational
and privacy-preserving. New integrations need a documented public hook API;
do not ingest transcripts, monkeypatch agents or infer suite results from a
successful shell invocation.

Install Node.js LTS, pnpm, Rust stable and Tauri v2 platform prerequisites.
On Windows, install the free Visual Studio C++ build tools and WebView2.

```
pnpm install --frozen-lockfile
node scripts/package-helper.mjs
cargo test --workspace --locked
pnpm test
pnpm build
pnpm --filter desktop tauri dev
```

Use fixture-based tests for adapters and temporary directories for config
edits. Never test an installer against your real agent configuration unless
you explicitly intend to connect it. Include before/after preservation tests
for any configuration merge change.

Scene changes should include deterministic demo screenshots at compact,
expanded and capture sizes, plus reduced-motion verification. Artwork must
be original or freely redistributable with attribution in assets/LICENSES.md.
No racing-team branding, remote fonts, paid asset dependencies or telemetry.

Before distribution, run node scripts/check-licenses.mjs and review the
generated reports. Cross-platform support must be described according to
actual testing, rather than inferred from successful compilation alone.
