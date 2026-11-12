# HASTERRAD 0.4.11

**Dodge. Blast. Survive. Climb the leaderboard.**

This is the runtime source snapshot of the installed 0.4.11 web/API release, not a replacement for the repository's legacy guest-only export. The release includes optional Urbit, RemiliaNET and Ethereum login, a top-five account leaderboard, server-side deterministic replay verification, mobile controls, and the larger finish-request proxy limit. The 0.4.11 increment changes the page description and visible release label; it retains the preceding gameplay/auth implementation.

## Contents and boundaries

- `hasterrad-game/source/public` and `api/public`: exact deployed static bytes, with matching `artifact.json` SHA-256 manifests.
- `hasterrad-game/source/api/server`: exact runtime server modules.
- `qualification/tests`: the 112-test qualification suite. `qualification/server` retains the inherited authentication fixture modules; it is not the deployment entrypoint.
- Pinned `viem` and `jose` dependencies with their lockfile. The [wallet build workspace](wallet/README.md), exact dependency lockfile, vendor provenance and notices are preserved; a fresh install/build reproduces all three deployed wallet outputs byte-for-byte.
- Dockerfiles preserve the release overlay recipe using digest-pinned **0.4.2 parents in private OwlWilderness GHCR packages**. Original 0.4.11 release images are preserved there too. [Build/recovery instructions](deployment/README.md) and `images.lock.json` provide identity checks and clean-builder qualification. This rebuild relies on preserved parents, not rebuilding their operating-system layers from source.
- Owner-specific Compose/manifest settings, private trust configuration, image archives, upload handles, sessions, databases, and operational receipts are deliberately excluded. No deployment happens when running the source tests.

## Run the source qualification

Requires Node 22.17.0 or compatible newer Node with `node:sqlite`, npm, Python 3.10+, OpenSSL, and Anvil for the smart-wallet EVM fixtures. The Anvil path is configurable with `ANVIL_BIN` (otherwise the fixture uses `$HOME/.foundry/bin/anvil`).

From this directory:

```sh
npm ci --ignore-scripts
npm test
python3 qualification/scripts/check-copy.py
```

The tests create disposable loopback servers and databases; they do not use a production account or database. Serial execution avoids collisions between inherited fixtures. Set `TMPDIR` to a private scratch directory if desired. Never use a live wallet key for the deterministic test vectors.

## Rebuild and recovery

See [deployment/README.md](deployment/README.md) for the single-command fresh-checkout rebuild, private-registry access, and operator templates. This preservation work does not redeploy the game. Licensing remains #1; the frozen wallet dependency graph has audit findings documented in [wallet/README.md](wallet/README.md).

## Optional isolated built-image checks

These commands require the locally built **0.4.11** images; they do not download or install the DAppNode package:

```sh
python3 qualification/scripts/verify-images.py
python3 qualification/scripts/runtime-check.py
```

The runtime check creates and removes a dedicated Docker network and two disposable containers, publishes loopback port 18789 to web port 8088, and mounts a temporary `/data` owned by UID/GID 10001. It never mounts the owner's scores volume. Do not run another copy concurrently.

## Runtime configuration and persistence

Use the API's `server/main.mjs` entrypoint and configure the actual HTTPS origin through `HASTERRAD_PUBLIC_ORIGIN`. Serve the `api/public` tree through `HASTERRAD_STATIC_DIR`; its manifest is checked at startup. Preserve the exact incoming public Host and omit untrusted forwarded-host/proto headers. The supplied Nginx config proxies to `api:8090` and listens on 8088. Optional providers require operator registration, RPC, and—in Urbit's case—same-ship callback routing/trust configuration; none is provisioned by this source snapshot.

Keep the existing named volume mounted as `scores:/data`. Auth uses `/data/topbar-auth/auth.sqlite`; scores use `/data/scores.sqlite3`. These are separate databases on the retained volume. Preserve owner Config during upgrades; descriptor defaults are not a substitute for saved settings. Do not delete/recreate the volume or replace the auth database when deploying a copy change.

Only finished, account-linked runs accepted by the server replay verifier enter the leaderboard. Legacy unverified rows remain stored but unranked. Valid-input bots are still possible; replay verification is not a promise of human-only or cheat-proof competition.

## Verified release evidence

- 112 source tests passed before packaging.
- Both linux/amd64 images matched all 17 static asset hashes, all 13 API module hashes, and the reviewed proxy configuration.
- Built API replay accepted the known fixture and rejected a tampered claim.
- Isolated web→API checks passed; replay-sized unauthenticated finish requests reached the API (401), while unrelated oversized requests remained capped (413).
- Native DAppNode manifest/Compose validation passed. One staging submission and one install call completed for 0.4.11.
- Both installed services were read back running 0.4.11. Owner Config was unchanged, and the existing scores volume and auth DB path were retained.
- All 17 public assets matched the release manifest after install. The previously saved 5,480-point, level-2 run remained rank 1; this upgrade did not submit a new score or initiate a login.

Two-image archive SHA-256: `54f17301fc30e96b7becff7720ae5ec7e56dd6f1b041d0390aa6e91b6f9f2f4a` (321,494,528 bytes). The archive is intentionally not committed.

Real-phone acceptance and a new end-to-end login were not verified in this release task. Historical database contents were not inspected. No independent reviewer was used for this publication because the owner excluded subagents. Existing rights/attribution limitations remain; no new project license or third-party art permission is asserted.
