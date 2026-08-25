import { defineConfig } from 'vite';
import { rpgjs, tiledMapFolderPlugin } from '@rpgjs/vite';
import startServer from './src/server';
import { handleAuth } from './auth.mjs';

// The wallet login endpoints live in server.mjs (production). Without them the
// dev server returns index.html for /auth/nonce, the JSON parse throws, and the
// title screen reports a cancelled connection for what is really a missing
// route. Mount the same handler here so dev and production behave alike.
const authDevServer = {
  name: 'stockmonsters-auth',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (!req.url?.startsWith('/auth/')) return next();
      handleAuth(req, res).then((handled: boolean) => { if (!handled) next(); }).catch(next);
    });
  },
};

export default defineConfig({
  optimizeDeps: {
    include: ['pixi.js > @xmldom/xmldom']
  },
  plugins: [
    authDevServer,
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
