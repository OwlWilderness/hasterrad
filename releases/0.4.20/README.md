# Hasterrad 0.4.20 — directional ETH trade tape

Based on 0.4.19, including its light chart and playfield module standard. The light ETH key and labels sit behind the starfield and use the Remilia message typography. The five traces include the 14-period simple average of RSI alongside price, RSI, MACD and signal; the stationary RSI guides sit at 25 and 75. ETH and Remilia scenery use the built-in playfield host and share one UTC clock outside the field. The ETH startup chart is retained: a two-hour axis, actual completed-minute closes visible before the first tick, and observed second samples added without filling gaps. Completed-minute indicators retain their warm-up and use one replaceable provisional close. The Remilia display, score layout, authentication, and replay are carried forward. This is a versioned source snapshot, not a deployable package or proof of a fresh build.

## Source and image provenance

- This source line is based on 0.4.19. The versioned files here preserve the reviewed 0.4.20 source bytes, except this publication README and the omitted `wallet/dist/` build output. Both public trees retain the shipped wallet JS, CSS and license notices, checked against their static manifests. The wallet build instructions assume a fresh `wallet/dist/`.
- Both supplied Dockerfiles are overlays on the private, digest-pinned **0.4.2** OwlWilderness GHCR parent images for `linux/amd64`. The `web-parent` and `api-parent` entries in `images.lock.json` record the parent manifest references and Docker image IDs. Its `*-release` entries identify the preserved **0.4.11** images, not 0.4.20. The source line and the build parents are different things.
- The sealed 0.4.20 build used reviewed overlay contexts with regular files at `0644` and directories at `0755` so non-root services could read the copied files. If recreating the contexts, verify those permissions before building. The Dockerfiles assume access to the exact parents and inherit files and runtime configuration from them. This checkout does not build those parents from scratch or establish that rebuilding will recover the original 0.4.20 image IDs.
- This repository snapshot does not include the original image archive, native DAppNode descriptors, saved operator settings, trust material, deployment receipts, or qualification artifacts. No container rebuild, image publication, or deployment is performed by preserving these files. The root guest game and earlier versioned releases are unchanged.

The original-code license and exclusions are described in the repository’s [NOTICE](../../NOTICE.md). The provider graphics and their notices are carried forward byte-for-byte from 0.4.13 for the same sign-in use; no new third-party rights are asserted.

Run `node qualification/sync-public.mjs` to check the two static manifests and mirrors. With the root dependencies installed from the lock, set `ANVIL_BIN` to the absolute local Anvil executable and set `HASTERRAD_TEST_CHROMIUM` to a local Brave/Chromium executable and run `npm test`. Use a real-path scratch `TMPDIR`. Browser tests use isolated profiles, a deny proxy, and synthetic loopback sessions. The Docker build contexts are `hasterrad-game/source` (web) and `hasterrad-game/source/api` (API); their base digests remain inherited. `images.lock.json` documents historical parent and preservation images, not 0.4.20 image IDs.

See [Built-in playfield modules](PLAYFIELD-MODULES.md) for the ambient typography, slots, lifecycle, UTC clock, and a runnable module example.

## Independent QA contract

Run the real Hasterrad API with one of `hasterrad-game/source/public` or `hasterrad-game/source/api/public` as `staticDir`, disposable SQLite files, explicit loopback `origin`, and `oidc` pointing at your synthetic loopback realm. Repeat `/` and `/asteroids.html` at desktop and narrow widths. `qualification/tests/auth/remilia-display.test.mjs` contains an example signed synthetic provider. No production origin or credentials needed.

- Login keeps its existing authorization-code/S256 flow, `scope=openid`, nonce and ID-token/profile verification. Have the fixture return a delegated `access_token`, token response `scope: "openid remilia:beetle.read remilia:chat.read"`, and numeric `expires_in: 900` so both modules run. If retaining the baseline fixture's login client ID, use that ID as the token audience; the bundled fixture uses the supplied public `tpa-hasterrad`.
- Browser reads `GET /api/remilianet/display` (no query or request body), with the current same-origin session cookie and `X-CSRF-Token` from `/api/session`. All responses are `Cache-Control: no-store`; a live verified Remilia session and matching snapshot are required. Guest/stale session → 401; wrong provider or CSRF binding → 403; no usable feature lease → 204. When present, the JSON is:

```json
{"beetle":{"level":7,"xp":1234,"cheese":0},"chat":[{"id":"58575","text":"Synthetic transmission"}],"validForMs":890000}
```

| Field | Provenance |
|---|---|
| `beetle.level` | `GET /api/v1/me/beetle`, `data.level`, Beetle game level |
| `beetle.xp` | Same endpoint, `data.xp`, Beetle XP |
| `beetle.cheese` | Same endpoint, `data.inventory.cheese`, cheese inventory quantity, **not** cheese shields, cooldown, or a Cheeseworld metric |
| `chat` | `GET /api/v1/global-chat/messages?limit=20`, newest page in documented oldest-first order; up to 20 unique `{id,text}` rows, with canonical positive decimal string message IDs (at most 32 digits; safe legacy numbers map to the same keys) and bounded plain text. This is the documented default, below the documented maximum of 100; no pagination. |
| `validForMs` | Hasterrad-computed remaining in-memory lease; not a provider response field |

`beetle` can be null, or each individual nonnegative safe integer can be null. Zero is not missing. `chat` can be null or an empty array; no sender metadata, media, links, or other response fields are forwarded or rendered as interactive content. In the DOM, use `#beetle-status [data-beetle-field]` and `#remilia-chat`. The canvas, controls, and existing score paths are unchanged.

Official docs: [OIDC](https://docs.remilia.net/api/oidc), [portal-default grant model](https://docs.remilia.net/guide/permissions), [issued grants](https://docs.remilia.net/guide/handle-permissions), [Beetle](https://docs.remilia.net/api/endpoints#get-your-beetle-state), [chat](https://docs.remilia.net/api/endpoints#list-global-chat-messages), [scope reference](https://docs.remilia.net/api/scopes). The client does not request or use stats, directory, write, or refresh scopes; the portal may attach more scopes than the candidate uses. Actual registration/approval, exact live callback, user grant and live token response shape are not established by this candidate. Existing sessions without a fresh grant, or sessions after API restart/lease expiry, still sign in/play but have no modules until a new eligible login.

Each optional provider read is GET-only, pinned to the issuer origin, with a 2-second/32 KiB cap, no redirects, and coalescing per session and feature. Server caches are per session, with 30s chat and 60s Beetle request intervals. The bearer and minimized snapshots are process-memory only, at most 30 minutes and never beyond issued expiry. Logout and session replacement invalidate the lease, including pending reads. Backgrounding or navigating clears the page and stops its poll; an already-started server read can finish within its cap. No refresh grant is made.

Chat bursts descend the right column, wrap to the top of the middle column, then wrap to the left before retiring. Wraps retain the same rows; overlapping polls do not replay retired IDs. Reduced motion uses static text.

Run `node qualification/sync-public.mjs` and `npm test` on Node 22 with locked dependencies. Native Config, volume topology, the existing Ethereum chart and tick contracts, wallet, replay and scores are unchanged. Local qualification does not establish live provider acceptance.

## ETH trade tape

`GET /api/eth-market/trades` uses the tick route’s session and CSRF binding. The server samples only anonymous Coinbase Exchange ETH-USD fills from the configured market origin. It coalesces concurrent reads, samples at most once per 1.5 seconds, and backs off on failure. Each read requests a single page of at most 50 trades, capped at 32 KiB and 4 seconds; the shared rolling view holds at most 100 unique fills younger than 15 seconds. The response is `{trades:[{id,time,price,size,side}]}` oldest first, with opaque decimal string IDs, exchange ISO timestamps, original decimal strings, and aggressor side (opposite Coinbase’s maker side). No catch-up pagination or gap filling is attempted.

The client primes silently from the initial page and compares each new chronological fill with its previous observed unique fill before applying the display cap. Prices are compared as exact decimals; green and red follow price direction, neutral uses the ambient text color, and `(B)` / `(S)` independently identify the buy/sell aggressor. A move requires consecutive Coinbase fill IDs and a fresh baseline in the current session. A missing baseline or equal price gets a brief stationary fade. Higher fills rise vertically from the bottom of the left column and wrap to the bottom of each column to their right. Lower fills fall vertically from the top of the right column and wrap left. Each fill retains its ID and node for the complete cascade, travels at 76 CSS pixels per second, and is clipped to each track’s control-clear span of the bottom third. Column count is bounded by the usable arena and measured natural row width. Opposing directions use exclusive outer entries and share inner columns when geometry allows. Admission reserves the continuous route before entry so wraps do not wait mid-route. Reduced motion uses stationary fills without fading.
