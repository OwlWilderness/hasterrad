# Local parent tag verified as image ID sha256:0767b98847a286e5818b972a40650640def8d3e2e5ed14f38c94f89a6f1a64c8
FROM ghcr.io/owlwilderness/hasterrad-web@sha256:7ce196cf303f3044b9537697fcc0c2a5736bc3b0ebce1685d0a29a24c9b06bfc
COPY live.conf /etc/nginx/live.conf
COPY public/artifact.json /content/current/artifact.json
COPY public/asteroids.html public/index.html /content/current/
COPY public/assets/asteroids-core.js public/assets/asteroids.js public/assets/asteroids.css public/assets/hasterrad-scores.js /content/current/assets/
COPY public/assets/brands/remilia.png /content/current/assets/brands/remilia.png
COPY public/assets/wallet/index.js /content/current/assets/wallet/index.js
COPY public/assets/auth-session.mjs public/assets/account-shell.mjs /content/current/assets/
