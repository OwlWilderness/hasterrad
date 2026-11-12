# Wallet dependency remediation — issue #6

## Fixed inputs

- `uuid` → **11.1.1**: GHSA-w5hq-g745-h8pq. An undersized v5 output buffer reproduced a silent partial write on the old dependency; the regression now requires RangeError without buffer mutation. Normal v4 and deterministic v5 behavior are checked.
- `ws` → **8.22.2**: above the patched ranges for GHSA-58qx-3vcg-4xpx and GHSA-96hv-2xvq-fx4p. Browser use is a native-WebSocket shim, not the Node WebSocket server implementation. All installed copies are pinned to avoid retaining vulnerable Node paths in the workspace.
- `decode-uri-component` → **0.5.1**: patched for GHSA-vcc3-ghjq-m6fr and GHSA-qr28-fpjm-wq7f. Updated even though the browser build did not emit the old module.

Overrides retain the existing direct wallet versions and choices. They do not silently remove WalletConnect or replace wallet signing. Upstream majors/ranges are crossed in some transitive consumers, so typecheck, build and actual runtime qualification are required; raw audit alone is not compatibility evidence.

## Remaining findings — explicitly not fixed in node_modules

The refreshed candidate audit reports **22 affected-package entries: 19 high, 3 low**, originating in two direct advisories. The increase in propagated high entries versus the original report reflects npm's recalculated dependency graph, not 19 distinct new vulnerabilities.

| Direct advisory | Disposition |
| --- | --- |
| Zod GHSA-mrhx-c7xc-m3w5 | No Zod input contributes emitted bytes. The root and nested @reown/appkit-wallet Zod instances are excluded by tree shaking. Upgrading v3 consumers blindly to v4.6.6+ would cross a major API boundary. |
| deepmerge GHSA-gcqx-w48m-w2h4 | No deepmerge input contributes emitted bytes. It is inherited via @vanilla-extract/css; this build uses the browser serializer and esbuild rather than executing the Node CSS compiler over untrusted objects. Upstream reports no patched version. |

`check-audit.mjs` checks every direct advisory against this exact allowlist and the current bundle input paths. It fails if either excluded package contributes code, if any unknown direct advisory appears, or if npm audit/provenance cannot be read. Propagated package entries remain in the raw counts; they are not incorrectly treated as additional independent vulnerabilities. No node_modules tree is deployed with the browser bundle.

These are artifact-specific non-exposure conclusions, not a claim that Zod/deepmerge are generally safe or that npm audit is clean. Reassess if bundling, connectors, SSR or build tooling changes. Prebundled upstream internals outside npm's advisory graph are not exhaustively audited by this gate.

## Boundaries

The 0.4.11 snapshot and original registry images remain unchanged. No production login, signature, installation, Config write or database migration is part of this work. Local synthetic auth/runtime checks do not replace later owner real-wallet acceptance.
