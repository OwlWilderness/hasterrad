# HASTERRAD

Dodge. Blast. Survive. Climb the leaderboard.

A browser arcade game with keyboard and touch controls.

## Release source

[Release 0.4.12](releases/0.4.12/README.md) contains the game, account sign-in and leaderboard code. See its [build and deployment guide](releases/0.4.12/deployment/README.md) for prerequisites and rebuild instructions. Versioned source snapshots are kept in [`releases/`](releases/).

## Run locally (guest-only)

The root `public/` directory is the standalone guest-only version, without account sign-in or online leaderboards. It needs Python 3.9+; no package installation is required.

```sh
git clone https://github.com/OwlWilderness/hasterrad.git
cd hasterrad
python3 -B scripts/build.py
python3 -B scripts/serve.py --port 8765
```

Open <http://127.0.0.1:8765/>. Press Ctrl-C to stop the local preview server.

The build writes to `dist/` and refuses to overwrite an existing directory. For another export, use `python3 -B scripts/build.py --output /path/to/new-directory` and preview it with `python3 -B scripts/serve.py --directory /path/to/new-directory --port 8765`.

### Tests

With Node.js installed, run the guest-game source, export and local HTTP tests:

```sh
python3 -B scripts/test.py
```

## License

Original Hasterrad code is licensed under [MIT](LICENSE). Third-party code, SAN-inspired artwork, provider icons and trademarks are excluded from that grant; see [license scope and attribution](NOTICE.md).
