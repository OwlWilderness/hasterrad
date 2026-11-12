# Build preservation and recovery

## Durable artifacts

Both `ghcr.io/owlwilderness/hasterrad-web` and `ghcr.io/owlwilderness/hasterrad-api` are private, owned by OwlWilderness, with explicit Write access for bro-rad. Each retains the **0.4.2 parent** and **0.4.11 original release**. `../images.lock.json` pins registry manifest digests and original Docker configuration/image IDs for all four images. A registry digest is not the same as a Docker image ID.

Authenticate Docker to GHCR as an account with package access using a supported credential helper or token via stdin; never put credentials in Git, commands, Docker build arguments, or URLs. The private packages are not anonymously downloadable even though this source repository is public.

From `releases/0.4.11`:

```sh
python3 qualification/scripts/verify-registry.py
```

This pulls all four images by exact digest and checks image IDs/platform. It does not deploy. The original archive and installed image tags were retained; no preserved tag is overwritten by the rebuild.

## Clean rebuild and qualification

Prerequisites: Docker Engine and Buildx, Node 22.17.0 / npm 11.5.2, Python 3.10+, OpenSSL, and Anvil (set `ANVIL_BIN` if not at `$HOME/.foundry/bin/anvil`). Docker must support running linux/amd64 containers; the qualified Mac setup supplies emulation. Allow at least **10 GiB additional free space in both the host filesystem and Docker VM** for npm, registry layers and a disposable builder; this is a conservative working allowance, not a measured minimum. No owner database is needed.

Use a fresh checkout with no `wallet/dist` directory, then run:

```sh
cd releases/0.4.11
python3 qualification/scripts/rebuild.py
```

The script verifies registry recovery, performs fresh lockfile installs, runs the 112-test source suite, typechecks/builds the wallet and verifies all three output hashes, validates the example Compose, creates a new isolated BuildKit builder with an empty cache, pulls pinned parents from GHCR, and builds web/API with `--no-cache`. It then verifies static/server/proxy bytes, starts disposable loopback containers with tmpfs data, checks HTTP/body limits, and executes the replay/tamper fixture inside the rebuilt API image. The builder and fixture containers/network are removed; the qualified local `hasterrad-rebuild-{web,api}:0.4.11` images remain. Run one instance at a time (fixed loopback fixture ports).

The Dockerfiles now use the same preserved 0.4.2 parent images by registry digest rather than local-only tags. Rebuilding with BuildKit produces different image IDs/history/timestamps than the original legacy build. Qualification establishes **exact shipped application bytes and runtime behavior**, not a bit-identical image/archive. For exact recovery, pull the original 0.4.11 digests instead. Do not overwrite preserved recovery tags with rebuilt images.

## Operator templates

`docker-compose.example.yml` and `dappnode_package.example.json` intentionally use a non-routable placeholder origin and disabled optional providers. Copy them into a separate private deployment workspace, configure the real origin/provider registrations, and validate before use. The template is not a snapshot of owner Config and must not overwrite it.

For an existing install, preserve every saved Config key and the exact named `scores:/data` volume, including `/data/topbar-auth/auth.sqlite` and `/data/scores.sqlite3`. Review the running manager's merge semantics and read back preserved state. The preserved API parent includes its historical trust file; a different operator must supply a correctly qualified trust arrangement for their own ship rather than assume it applies to them. No private trust file is published in Git.

**No stage, reinstall, migration, or score Retry is part of this preservation workflow.** Licensing/attribution remains separate (#1). Pinned-wallet audit findings need a separate remediation review, not silent modifications to this accepted release.
