import { defineConfig, loadEnv } from 'vite';
import { rpgjs, tiledMapFolderPlugin } from '@rpgjs/vite';
import startServer from './src/server';
import { handleAuth } from './auth.mjs';
import { createBoxStore, handleBoxRoutes } from './lootbox.mjs';
import { createProfileStore } from './profiles.mjs';
import { createTokenStore, handleTokenRoutes } from './token.mjs';
import { createMarketStore, handleMarketRoutes } from './market.mjs';

/*
 * `.env` INTO `process.env`, BEFORE ANY STORE IS BUILT.
 *
 * Production runs `node --env-file-if-exists=.env server.mjs`, so every store
 * there reads a configured world. `npm run dev` is bare `vite`, which loads
 * .env for `import.meta.env` in the CLIENT and leaves `process.env` untouched —
 * so the stores built below saw nothing at all.
 *
 * That did not fail loudly. It degraded, exactly as each store is designed to:
 * the token reported `configured: false`, the box store fell back to chain
 * 31337 and refused to sell (DEMO MODE), and /token/chain answered `chainId: 0`
 * — which the wallet guard correctly reads as "this server has no chain", so
 * connecting a wallet in dev stopped with "The server has no chain configured."
 * Every one of those is the right behaviour for an unconfigured server. The bug
 * was that the server was unconfigured for no reason.
 *
 * A real environment variable still wins over the file, matching how node's
 * own --env-file behaves, so `SM_TOKEN_ADDRESS= npm run dev` can still blank
 * one out deliberately.
 */
for (const [key, value] of Object.entries(loadEnv('development', process.cwd(), ''))) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// The API endpoints live in server.mjs (production). Without them the dev
// server answers /auth/nonce and /box/quote with index.html, the JSON parse
// throws, and the UI blames the player — "connection cancelled", "could not
// reach the depot". Mount the same handlers here so dev and production behave
// alike; anything added to server.mjs needs adding here too.
const apiDevServer = {
  name: 'stockmonsters-api',
  configureServer(server: any) {
    const boxes = createBoxStore();
    (globalThis as any).__smBoxes = boxes;
    const tokens = createTokenStore();
    // The dev server has no game process of its own, so nothing has injected
    // a profile store: make one here, or /rewards/mine has nowhere to read a
    // player's earnings from.
    const profiles = (globalThis as any).__smProfiles ?? createProfileStore();
    (globalThis as any).__smProfiles = profiles;
    (globalThis as any).__smTokens = tokens;
    // The order book. Its indexer runs here too: a fill that lands while the
    // dev server is the one being used still has to close the listing, or
    // developing against Sepolia means browsing a book full of dead orders.
    const marketplace = createMarketStore();
    (globalThis as any).__smMarket = marketplace;
    if (marketplace.enabled) marketplace.startIndexer();
    server.middlewares.use((req: any, res: any, next: any) => {
      const url: string = req.url ?? '';
      const done = (handled: boolean) => { if (!handled) next(); };
      if (url.startsWith('/auth/')) {
        handleAuth(req, res).then(done).catch(next);
        return;
      }
      if (url.startsWith('/box/')) {
        handleBoxRoutes(req, res, boxes).then(done).catch(next);
        return;
      }
      if (url.startsWith('/token') || url.startsWith('/rewards/')) {
        handleTokenRoutes(req, res, tokens, profiles).then(done).catch(next);
        return;
      }
      if (url === '/market' || url.startsWith('/market/') || url.startsWith('/market?')) {
        handleMarketRoutes(req, res, marketplace).then(done).catch(next);
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  optimizeDeps: {
    include: ['pixi.js > @xmldom/xmldom']
  },
  plugins: [
    apiDevServer,
    tiledMapFolderPlugin({
      sourceFolder: './src/tiled',      // Folder containing your TMX files
      publicPath: '/map',               // Public URL path for maps
      buildOutputPath: 'map'            // Match the runtime Tiled URL prefix
    }),
    ...rpgjs({
      server: startServer
    })
  ], 
});
