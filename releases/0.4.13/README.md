# Hasterrad 0.4.13

Local release candidate for #9 and #10. Not staged, installed, or published.

- Wallet account headers can display a verified ENS name. Reverse and forward resolution must agree; lookup failure leaves the shortened address and does not block account controls.
- Signed-in players can see their recent replay-verified runs privately, newest first. Session transitions clear the private panel, and a late response cannot repaint another account’s history. The public leaderboard is unchanged.
- Both game routes display `v0.4.13`.

The wallet source, dependency locks, bundled wallet code/styles/notices, and score and auth storage paths are carried forward from 0.4.12. See the [rebuild and qualification guide](deployment/README.md). The browser and runtime fixtures are synthetic; real provider login and phone acceptance are separate checks.

[`images.lock.json`](images.lock.json) preserves the private 0.4.2 overlay parents and 0.4.11 recovery references. It does not name 0.4.13 registry images. This is a source snapshot with reproducible application bytes given access to the pinned parents, not a standalone rebuild of the parent images or a guarantee of identical image IDs.

Original source license and third-party artwork exclusions are described in the repository’s LICENSE and NOTICE.md. This snapshot grants no additional rights.
