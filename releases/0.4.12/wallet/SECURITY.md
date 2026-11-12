# Wallet dependency remediation — issue #6

## Acceptance: zero full npm audit findings

The candidate requires a fresh full npm audit with zero findings, including development dependencies. There are no package, severity, production-only or emitted-code exclusions. The previous Zod/deepmerge exceptions have been removed. Network failures, malformed audit reports, nonzero counts and nonempty findings fail qualification.

## Reviewed dependency updates

- UUID **11.1.1**: fixes GHSA-w5hq-g745-h8pq; regression verifies undersized v5 output buffers throw without mutation and normal v4/v5 behavior remains available.
- ws **8.22.2**: fixes GHSA-58qx-3vcg-4xpx and GHSA-96hv-2xvq-fx4p; all copies are pinned, including development paths.
- decode-uri-component **0.5.1**: fixes GHSA-vcc3-ghjq-m6fr and GHSA-qr28-fpjm-wq7f.
- Zod **4.6.7**: above the GHSA-mrhx-c7xc-m3w5 fixed version. Zod is a wallet dependency, not the Urbit ~zod ship. No v3 compatibility alias or vulnerable older copy is retained in the lockfile.
- @vanilla-extract/css **1.21.3**: upstream replaces deepmerge with deepmerge-ts. The vulnerable deepmerge package (GHSA-gcqx-w48m-w2h4) is absent from the candidate lockfile; no local fork, version disguise or advisory suppression is used.

Overrides intentionally cross some transitive consumer ranges. Tests exercise every installed ABI schema version with valid/invalid ABI, representative Reown RPC/theme/account schemas, Coinbase schema initialization, actual wallet-connector factories and the existing auth/game integration suite. These are bounded compatibility checks, not proof of every external wallet flow. Direct wallet choices remain unchanged.

The rebuilt browser JS/CSS match the preceding candidate; the updated dependency notices are regenerated and included in BOTH container overlays. Emitted-input provenance remains useful build evidence but does not suppress audit findings.

## Boundaries

The frozen 0.4.11 snapshot and original registry images are unchanged. The candidate is not deployed. No owner Config, auth database or scores are modified. Browser-tool loopback smoke was previously blocked and is not claimed; new real-provider/mobile login acceptance remains distinct from synthetic tests. The existing MetaMask empty-glob build warning remains visible. A clean npm audit is time-bound advisory evidence, not a comprehensive security guarantee.
