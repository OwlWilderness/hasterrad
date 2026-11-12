# HASTERRAD (web)

## Deployed release source

[Dodge. Blast. Survive. Climb the leaderboard. — 0.4.12](releases/0.4.12/README.md) is the installed wallet-security release with a zero-findings full npm audit, verified public assets and retained Config/storage. The [0.4.11 snapshot](releases/0.4.11/README.md) remains preserved for recovery. See the current release for verification and acceptance limits.

The guest-only export below is retained unchanged as a legacy baseline. Its deferred-auth and deployment statements describe that baseline, not the 0.4.11 release.

## Legacy guest-only export

Standalone guest-only Canvas/vector arcade source. Requires Python 3.9+ to export/preview and Node.js to run the focused source tests. No package install, container build, account backend or network dependency is needed for guest play.

```sh
python3 -B scripts/build.py
python3 -B scripts/serve.py --port 8765
# In a second terminal:
python3 -B scripts/test.py
```

Open `http://127.0.0.1:8765/`; Ctrl-C stops only this disposable loopback server. Build output is ignored `dist/`; build refuses an existing output directory. Use `--output /path/to/new-directory` to keep separate exports. Test scratch uses Python's `TMPDIR`; set it to your private scratch directory if desired. Tests start and stop their own ephemeral loopback listener, not any installed publisher.

## Source and embedding contract

- `public/asteroids.html` and its four `assets/asteroids*` files are the sole maintained guest-game source. The build's `index.html` is a generated standalone entry, with the original exporter's backlink to `https://quantumtekh.com/`.
- `source-files.json` is the explicit export allowlist. The build produces deterministic bytes and `artifact.json` SHA-256 membership, not a deployable image.
- `quantumtekh-com` imports the five game files from this artifact with an explicit hash lock; it does not maintain a second game implementation. Serve the imported `/asteroids.html?embedded=1` on the website's origin. Embedding opts into compact chrome only; standalone chrome and game controls remain unchanged.
- Parent/child focus and Escape messages require the exact current origin **and** exact parent/current frame source. Escape capture, stale-load protection and frame destruction remain intact. This source split intentionally retains same-origin serving; it does **not** switch the homepage to an externally deployed canonical subdomain. A cross-origin deployment requires a separate reviewed origin/CSP decision.
- `scripts/serve.py` is a local static smoke/preview helper, not a production server. It preserves the original generic publisher's security-policy values, explicitly limits frames to self, allows only the game document to be framed by self, and serves no account routes. Existing production publisher/configuration is untouched.

## Deferred authentication

`deferred/hasterrad-scores.js` is the byte-preserved former optional account adapter, **not** a public asset or loaded script. The game HTML deliberately omits it. Guest start, device-local best score, counter/reset semantics and controls continue through the controller's existing optional-adapter path. No sessions, login popups, cookies or account calls are activated by this export. The preserved account panel remains guest-only.

Account auth has an unresolved callback/cookie-binding defect and a prior provider-policy refusal. Do not infer that retained source is qualified, retry that workload, or enable the adapter/backend as part of this split. Account leaderboard/save/provider work requires a separately authorized correction and verification. The focused controller tests include simulated optional-adapter seams only; they are not auth/provider acceptance.

## Provenance and rights

Extracted from `dappnode-web-publisher` frontend baseline `c58819e77c33fb583cbe19399d5a5a9fb4eab4f1`, using the accepted game worker `a2f4182c632dd34dceb295a3ae074eb6957bcee2` for the latest core/controller/art/embed tests. This retains the enemy-rock collision fix and product-reference-informed vectors, not the older parent's game snapshot. Intentional adaptations are source-root test paths, same-origin message targeting and disabled optional account loading; no gameplay redesign.

Original Hasterrad code is now offered under the [MIT License](LICENSE), with the owner identified as `quantumtekh.eth`. See [license scope and attribution](NOTICE.md): third-party code, SAN-inspired artwork, provider icons and trademarks are not relicensed by this grant. The owner reports Sansound has no objection to the SAN-inspired art; this is not a blanket third-party redistribution license. Urbit, Remilia and Ethereum login icons remain separately attributed. No downloaded product reference images or private evidence are included.

## Verification and remaining work

`python3 -B scripts/test.py` runs only the eight enumerated existing game source tests plus deterministic-export and real static HTTP checks. These cover core gameplay, controls/storage fallback, saucers/enemy-rock impacts, vector paths, counters and authenticated embed messaging. No real browser/phone visual or provider-login acceptance is claimed.

Recorded source closeout (2026-11-08): independent review approved the exact private-source allowlist, and initial source commit `a0a29f120a6cde34747b6cd1089dd0efe8351540` is complete locally. Remote publication is not established by this README update; it remains a separate serialized delivery step. This is not public art-rights or deployment acceptance.

Historical baseline follow-ups were human visual/focus/touch acceptance, rights/attribution, account work and deployment decisions. These are not the current release status: the owner-approved licensing/attribution scope is documented in LICENSE and NOTICE.md, and the installed release is linked above. Third-party exclusions remain applicable; completing the documentation does not grant additional artwork or trademark rights.
