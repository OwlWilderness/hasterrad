# Built-in playfield modules

Playfield modules are optional, repo-local scenery. `hasterrad-game/source/public/assets/playfield-modules.mjs` is the explicit registry; `playfield-host.mjs` owns the slots and lifecycle. There is no remote loading, user-supplied code, `eval`, new auth flow, or game-core integration.

| Slot | Contract |
| --- | --- |
| `backdrop` | Full playfield, behind the canvas and HUD. Multiple modules can use it; roots are inert and accessibility-hidden. Use for decoration, not essential information. |
| `strip` | One readable, noninteractive slot below the HUD and above the menu. The shell reserves its space even when the module is absent. ETH currently owns it. |

Declare a unique lowercase `id`, a `slots` map (`true` creates a root; a local selector claims existing markup inside the corresponding slot), and `mount({document, window, roots, session, signal})`. For private scenery only, declare `eligible(session)`. The shell supplies its existing verified session; modules without `eligible` receive `null`, including when a user is signed in. No module can sign in or add a provider through this contract.

`mount` runs synchronously and can return a synchronous disposer. It can start asynchronous work, but must observe `signal` after each await and pass it to cancellable requests. On removal, the host aborts first, detaches generated roots or hides authored roots, then runs the disposer. Clear **text and attributes** in all authored roots and any related shell UI, cancel timers/animation, and detach listeners in the disposer. An unchanged eligible session does not remount; session replacement, expiration, revocation, failed session checks, focus rechecks, backgrounding, and page exit clear private displays. Existing market and Remilia data still have their own freshness bounds.

Use `class="playfield-copy"` for ambient text. It uses the Remilia message face, size and line height, normal weight/tracking, and the message’s steady-state ink alpha (not its entry/exit fade). Color alpha on text does not dim swatches or chart strokes. Keep atmospheric text read-only, bounded, silent, and out of live regions. No links, focus targets, pointer handlers, new audio, gameplay timers or mutations. New motion must respect reduced motion. Use the shell’s single footer UTC clock; modules never render their own current-time display or fetch time.

## Runnable third-module example

The browser qualification runs this same pattern against a real game document. To try it without editing either HTML route or the game core, open the copied loopback preview, then run this in that page’s DevTools console:

```js
const {mountPlayfield} = await import('/assets/playfield-modules.mjs');
const exampleHost = mountPlayfield(document, window);
const removeBeacon = exampleHost.register({
  id: 'example-beacon',
  slots: {backdrop: true},
  mount({roots, signal}) {
    const root = roots.backdrop;
    root.classList.add('playfield-copy');
    const text = document.createElement('span');
    text.textContent = 'TRAINING BEACON';
    text.style.cssText = 'position:absolute;left:12%;bottom:24%';
    root.append(text);
    return () => console.assert(signal.aborted);
  },
});
exampleHost.update({session: null}); // Example host only; does not change the real session.
// While in flight, look near the lower left. Then run: removeBeacon();
```

To make this a built-in instead, add the same descriptor to `playfieldModules`; the real shell supplies updates and clears automatically. If adding a new source asset, include it in both Dockerfile overlay lists, run `node qualification/sync-public.mjs --write`, and reseal the copied preview’s static manifest pin after review. Run:

```sh
node --test qualification/tests/playfield-modules.test.mjs
node qualification/sync-public.mjs
npm test
```

For browser coverage, set `HASTERRAD_TEST_CHROMIUM` to a local Brave/Chromium executable and use a real-path scratch `TMPDIR` as described in [README.md](README.md).
