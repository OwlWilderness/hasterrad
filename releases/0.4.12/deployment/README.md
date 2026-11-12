# Candidate build and deployment boundaries

0.4.12 is a local security candidate, not an installed release. Original 0.4.11 recovery images and 0.4.2 parents remain pinned in ../images.lock.json; there are no 0.4.12 registry images in that file.

## Clean qualification

Prerequisites: authenticated access to the private OwlWilderness GHCR packages, Docker Engine/Buildx with linux/amd64 execution support, Node 22.17.0 / npm 11.5.2, Python 3.10+, OpenSSL, and Anvil (`ANVIL_BIN` or `$HOME/.foundry/bin/anvil`). Allow 10 GiB working headroom on both the host filesystem and Docker VM. Use a fresh checkout without wallet/dist.

```sh
cd releases/0.4.12
python3 qualification/scripts/rebuild.py
```

The command pulls and verifies preserved images, installs dependencies from locks, runs source tests, wallet typecheck/security tests/hash checks and a fresh audit, and builds both candidate images using an isolated empty-cache builder. It exercises static/server/proxy byte checks and isolated tmpfs HTTP/replay/tamper fixtures. No real owner data or credentials are used. Local images are `hasterrad-rebuild-web:0.4.12` and `hasterrad-rebuild-api:0.4.12`; they are not automatically published. Only one fixture run at a time is supported because loopback ports are fixed.

The audit gate requires zero findings in the full dependency tree, with no exceptions. If advisory data changes, fail and review rather than weaken the gate.

## Operator templates — not permission to install

The Compose and package descriptor are examples with placeholder origin and disabled optional providers. Image tags in those examples require explicit packaging/tagging of qualified images; the rebuild command does not prepare or install a DAppNode archive.

Never overwrite owner Config with example defaults. Preserve every saved Config key and the exact named `scores:/data` volume, `/data/topbar-auth/auth.sqlite` and `/data/scores.sqlite3`. The inherited API trust arrangement is operator-specific and needs review for any other operator. No private trust material is published in Git.

Staging, registry publication, installation, migration and Retry require separate authorization. A new real-wallet login after a separately approved installation remains owner acceptance, not a result of synthetic tests.
