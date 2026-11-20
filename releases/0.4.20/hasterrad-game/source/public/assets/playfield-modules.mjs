import {createPlayfieldHost} from './playfield-host.mjs';
import {mountRemiliaDisplay} from './remilia-display.mjs';

import {mountEthTradeTape} from './eth-trade-tape.mjs';

const verifiedEth = session => session.ethMarket === true && session.user?.provider === 'ethereum' && /^ethereum:1:0x[0-9a-fA-F]{40}$/.test(session.user.id);

// Built-in allowlist. Keep provider checks here; the host knows no providers.
export const playfieldModules = [
  {
    id:'remilia', slots:{backdrop:'#remilia-chat'},
    eligible:session => session.user?.provider === 'remilianet',
    mount({document,window,roots,session}) {
      const display = mountRemiliaDisplay(document,window,roots.backdrop);
      display.show({session});
      return () => display.dispose();
    },
  },
  {
    id:'eth-market', slots:{backdrop:'#eth-chart',strip:'#eth-market-box'},
    eligible:verifiedEth,
    mount({document,window,roots,session,signal}) {
      let stop;
      void import('./eth-chart.mjs').then(({mountEthMarket}) => {
        if (!signal.aborted) stop = mountEthMarket(document,window,session,roots);
      }).catch(() => {});
      return () => stop?.();
    },
  },
  {id:'eth-trade-tape', slots:{backdrop:true}, eligible:verifiedEth, mount:mountEthTradeTape},
];

export function mountPlayfield(document,window) {
  const host = createPlayfieldHost(document,window);
  for (const spec of playfieldModules) host.register(spec);
  return host;
}
