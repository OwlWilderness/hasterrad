# Local parent tag verified as image ID sha256:3a41517817b414432ff1f87d6d677bde6db70296d6596c286996eed509359c28
FROM ghcr.io/owlwilderness/hasterrad-api@sha256:7a5ffd971017f476396eaa5ca530f037e3166557870e771cb41da03d1364a5a0
COPY server/oidc.mjs server/diagnostics.mjs server/app.mjs server/main.mjs server/scores.mjs server/ens.mjs server/wallet.mjs server/replay.mjs server/replay-worker.mjs /app/server/
COPY server/network.mjs /app/server/network.mjs
COPY public/artifact.json /app/public/artifact.json
COPY public/asteroids.html public/index.html /app/public/
COPY public/assets/asteroids-core.js public/assets/asteroids.js public/assets/asteroids.css public/assets/hasterrad-scores.js /app/public/assets/
COPY public/assets/brands/remilia.png /app/public/assets/brands/remilia.png
COPY public/assets/wallet/index.js /app/public/assets/wallet/index.js
COPY public/assets/auth-session.mjs public/assets/account-shell.mjs /app/public/assets/
