# Preserved wallet build inputs

This directory preserves the actual source, pinned npm lockfile, build configuration, vendored AsyncStorage browser implementation, and supplemental notices used to build the wallet bundle shipped in 0.4.11.

From a fresh checkout with Node 22.17.0 / npm 11.5.2:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

`build.mjs` refuses an existing `dist/`, validates pinned package versions and vendor/supplement hashes, bundles without external runtime imports, and emits dependency notices. `npm test` compares the new JS, CSS, and notices against the accepted release's manifest; it does not connect a wallet, sign, deploy, or touch a database.

All three rebuilt outputs matched the deployed bytes after a fresh dependency install. The only package-script adaptation is replacing the old missing external test path with `verify-build.mjs`; build inputs otherwise retain their source bytes. `src/session.mjs` is historical unused workspace material, not imported by `src/index.jsx`: the deployed session adapter is `hasterrad-game/source/public/assets/auth-session.mjs`, tested by the release qualification suite. Do not substitute that older unused adapter for the shipped one.

## Known limits

- Preservation is not dependency remediation: the pinned graph currently produces 31 npm audit findings (2 low, 13 moderate, 16 high, 0 critical). These counts include transitive/development paths and do not prove exploitability in the emitted browser bundle. Triage actual bundle reachability and upgrade in a separate qualified release; do not run an unattended `npm audit fix` against this frozen snapshot.
- The build emits an existing MetaMask empty dynamic-import glob warning. The build still succeeds and matches the deployed bytes; no claim of every wallet/provider path working follows from a hash match.
- Third-party notices, vendor provenance, and supplements are retained unchanged. Some supplements explicitly flag non-version-specific upstream notices; licensing/attribution remains issue #1, not a new permission grant.
- The preserved frontend includes historical explanatory text. Preservation does not edit gameplay, UI copy, or the live installation.
