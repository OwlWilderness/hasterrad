# Wallet security candidate

This is the 0.4.12 successor workspace, not a rewrite of the preserved 0.4.11 build.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

Use a fresh directory with no dist/. Build inputs remain pinned; the build refuses an overlay, validates vendored notice integrity, and includes emitted input paths in dist/bundle.json. Tests compare JS/CSS/notices to this candidate's checked-in runtime manifests, run regression tests and fetch a fresh npm audit. Network/audit errors fail the check.

See SECURITY.md for the reviewed overrides and zero-findings full-audit requirement; there are no advisory exclusions. Existing MetaMask empty dynamic-import glob warnings remain visible; a passing build does not establish every external wallet/mobile path. Historical src/session.mjs remains unused; the runtime adapter is source/public/assets/auth-session.mjs.
