# Local parent tag verified as image ID sha256:3a41517817b414432ff1f87d6d677bde6db70296d6596c286996eed509359c28
FROM ghcr.io/owlwilderness/hasterrad-api@sha256:7a5ffd971017f476396eaa5ca530f037e3166557870e771cb41da03d1364a5a0
COPY server/oidc.mjs server/diagnostics.mjs server/app.mjs server/main.mjs server/scores.mjs server/ens.mjs server/wallet.mjs server/replay.mjs server/replay-worker.mjs /app/server/
COPY server/network.mjs server/eth-market.mjs server/store.mjs server/remilia-display.mjs /app/server/
COPY public/artifact.json /app/public/artifact.json
COPY public/asteroids.html public/index.html /app/public/
COPY public/assets/asteroids-core.js public/assets/asteroids.js public/assets/asteroids.css public/assets/hasterrad-scores.js public/assets/utc-clock.js /app/public/assets/
COPY public/assets/brands/remilia.png /app/public/assets/brands/remilia.png
COPY public/assets/wallet/index.js public/assets/wallet/index.css public/assets/wallet/LICENSES.txt /app/public/assets/wallet/
COPY public/assets/auth-session.mjs public/assets/account-shell.mjs public/assets/personal-history.mjs public/assets/eth-chart.mjs public/assets/remilia-display.mjs public/assets/playfield-host.mjs public/assets/playfield-modules.mjs public/assets/eth-trade-tape.mjs /app/public/assets/
