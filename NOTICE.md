# License scope and attribution

## Original code

The repository owner selected the MIT License for original Hasterrad code and documentation, to the extent they hold rights to license it. See [LICENSE](LICENSE). The holder is identified by the owner's chosen public identifier, `quantumtekh.eth`. No legal name or literal Ethereum address is asserted here; the owner described the holder as the address behind that ENS name. ENS resolution can change and this document does not transfer rights with a name or wallet transfer.

The MIT notice is not a claim of copyright registration, exclusive rights in third-party material, or that every generated element is independently copyrightable. The license grants only rights the licensor actually holds.

## Scope exclusions

The root MIT grant covers original implementation code, not third-party dependencies, vendored code, bundled third-party code, provider artwork, trademarks, or SAN-inspired visual designs. Those remain subject to their respective terms and rights. This separation also applies when drawing instructions for artwork are embedded in a JavaScript source file. No trademark or endorsement permission is granted by MIT.

| Material | Location / provenance | Treatment |
| --- | --- | --- |
| Original game, UI, server, tests and tooling | Root legacy source and original code under `releases/0.4.11/` | MIT to the extent of the licensor's rights; exclusions below still apply. |
| SAN-inspired product vectors | Drawing code in `public/assets/asteroids.js` and the versioned web/API public copies; vector expectations in `tests/quantumtekh_san_vector_art.cjs` | Inspired by SAN art. The owner reports speaking with Sansound and receiving no objection to this use. This is owner-reported permission context, not an independently verified written license or a blanket downstream/commercial artwork grant. |
| Urbit login icon | Versioned `assets/brands/urbit.svg` and adjacent `NOTICES.txt` | Used to identify the optional login provider; excluded from MIT. Existing provenance reports no LICENSE/COPYING at the retained upstream pin. No new redistribution permission is asserted. |
| Remilia login icon | Versioned `assets/brands/` and adjacent `NOTICES.txt` | Used to identify the optional login provider; excluded from MIT. Retained provenance notes the classic smiley's relationship to TMN Classix artwork, not exclusive Remilia ownership. No new redistribution permission is asserted. |
| Ethereum login icon | Versioned `assets/brands/ethereum.svg` and adjacent `NOTICES.txt` | Provider-identification artwork, excluded from MIT; retain official-source attribution and applicable terms. |
| Wallet dependencies and generated bundle | `releases/0.4.11/wallet/package-lock.json`, `wallet/licenses/`, `wallet/vendor/`, and shipped `assets/wallet/LICENSES.txt` | Third-party terms apply. Keep notices intact; root MIT does not relicense the bundle's dependencies. |
| Server dependencies and container base components | Versioned server lockfiles and digest-pinned parent images | Respective upstream terms apply; image preservation is not relicensing their contents. |

The provider icons identify sign-in options. Their presence does not imply endorsement by Urbit, Remilia, Ethereum, or their respective rights holders.

## Remaining restrictions and verification boundaries

- Sansound's no-objection is recorded as the owner's report. Its scope, downstream redistribution and commercial permissions have not been independently established.
- Urbit and Remilia artwork remain separately attributed; descriptive login use is not proof of a redistribution license.
- Wallet notice supplements explicitly identify some non-version-specific references. MetaMask and Reown notices contain terms that require their own review; an MIT project license does not remove those restrictions.
- Existing release notices and manifests remain byte-for-byte preserved. This root documentation does not change the license metadata inside the frozen 0.4.11 package or qualify a new deployment.

Issue #1 records completion of the owner-approved project licensing and attribution scope: MIT for original code, the owner-selected holder identifier, SAN inspiration and owner-reported no-objection, separately attributed provider icons, and retained third-party notices with explicit exclusions. Completion does not turn the restrictions above into blanket third-party permission. Any future use outside this documented scope requires its own rights review. Wallet vulnerability remediation was completed separately in #6.
