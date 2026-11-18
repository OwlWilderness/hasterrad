# Hasterrad 0.4.13 rebuild and qualification

## Clean rebuild

Prerequisites: authorized read access to private OwlWilderness GHCR images, Docker Engine/Compose/Buildx with linux/amd64 execution, Node 22.17.0 or compatible, npm, Python 3.10+, OpenSSL, Anvil (`ANVIL_BIN` or `$HOME/.foundry/bin/anvil`), and a Chromium/Brave executable. Allow 10 GiB of host and Docker VM headroom. Use a fresh checkout without `wallet/dist`; run only one fixture suite at a time because some loopback ports are fixed.

```sh
cd releases/0.4.13
export HASTERRAD_TEST_CHROMIUM=/absolute/path/to/chromium-or-brave
python3 qualification/scripts/rebuild.py
```

The script pulls and verifies pinned parents/recovery images, checks both static trees, installs from locks, runs source and disposable-browser tests, and rebuilds and verifies wallet assets and the full zero-findings npm audit. It uses an isolated builder to produce `hasterrad-rebuild-web:0.4.13` and `hasterrad-rebuild-api:0.4.13`. It then checks image assets, API modules, proxy configuration, loopback HTTP and API replay/tamper behavior. It does not stage, install, publish, or export. Image IDs can differ across clean rebuilds even when the application bytes match.

## Package descriptors and contract

`dappnode_package.example.json` and `docker-compose.example.yml` are nonsecret templates; they retain placeholder HTTPS origin and disabled optional providers. The Compose image tags for a separately qualified package are `web.hasterrad-game.public.dappnode.eth:0.4.13` and `api.hasterrad-game.public.dappnode.eth:0.4.13`. Validate the exact manifest and Compose with the native validator before building a package variant; run `docker compose -f deployment/docker-compose.example.yml config --quiet` as a separate check.

Do not overwrite saved Config with example defaults. Preserve all Config keys and the named `scores:/data` volume, with separate `/data/topbar-auth/auth.sqlite` and `/data/scores.sqlite3` files. The fixture runs without owner configuration or data, uses API `/data` tmpfs, and publishes only web port 8088 on loopback. It does not establish live installer behavior or provider login.

Keep any `docker save` archive outside Git. Staging, publication and installation are separate authorization gates.
