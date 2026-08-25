import { defineConfig } from 'vite';
import { rpgjs, tiledMapFolderPlugin } from '@rpgjs/vite';
import startServer from './src/server';
import { handleAuth } from './auth.mjs';
import { createBoxStore, handleBoxRoutes } from './lootbox.mjs';

// The API endpoints live in server.mjs (production). Without them the dev
// server answers /auth/nonce and /box/quote with index.html, the JSON parse
// throws, and the UI blames the player — "connection cancelled", "could not
// reach the depot". Mount the same handlers here so dev and production behave
// alike; anything added to server.mjs needs adding here too.
const apiDevServer = {
  name: 'stockmonsters-api',
  configureServer(server: any) {
    const boxes = createBoxStore();
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
