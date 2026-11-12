# Hasterrad 0.4.12 — wallet security release

**Installed and publicly verified.** Both DAppNode services run 0.4.12; both game routes show v0.4.12 and all 17 served assets match this release. Saved owner Config, the named scores volume and auth database path are unchanged. The existing 5,480-point score remains rank 1. No new provider login was exercised. The 0.4.11 recovery artifacts remain preserved.

## Changes

Pin UUID 11.1.1, ws 8.22.2, decode-uri-component 0.5.1, Zod 4.6.7 and Vanilla Extract CSS 1.21.3 through reviewed npm overrides. Preserve existing wallet choices and direct dependency versions. Add UUID regression tests and a fail-closed zero-findings full-audit gate and dependency compatibility tests.

See [wallet/SECURITY.md](wallet/SECURITY.md) for all dependency changes and compatibility limits. A fresh full npm audit must report **zero vulnerabilities**, without exclusions.

## Qualification

From a fresh checkout, with the prerequisites in [deployment/README.md](deployment/README.md):

```sh
python3 qualification/scripts/rebuild.py
```

The command runs the inherited auth/game tests, wallet security tests/typecheck/build/hash/audit checks, then builds isolated linux/amd64 images and exercises asset/module/proxy hashes, HTTP and replay/tamper behavior. It never stages or installs. Real-provider login with this new bundle remains owner acceptance after separately authorized deployment.

The included images.lock.json intentionally preserves the **0.4.2 parents and 0.4.11 recovery images**, not nonexistent 0.4.12 registry releases. New local qualification images use hasterrad-rebuild-{web,api}:0.4.12. 0.4.12 was installed once from a separately validated two-image archive. Its original archive is retained locally; 0.4.12 registry publication has not been performed.

Original source license and artwork exclusions are described in the root LICENSE and NOTICE.md. Existing third-party notices remain attached to their respective code.
