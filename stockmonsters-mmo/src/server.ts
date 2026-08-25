import { createServer,  provideServerModules, LocalStorageSaveStorageStrategy } from "@rpgjs/server";
import { provideMain } from "./modules/main";
import { provideSaveStorage } from "@rpgjs/server";
import { provideTiledMap } from "@rpgjs/tiledmap/server";

export default createServer({
    providers: [
      provideMain(),
      provideSaveStorage(new LocalStorageSaveStorageStrategy({ key: "save" })),
      provideServerModules([]),
      // Chunk streaming is the ONLY map delivery in real MMO mode (the
      // server never exposes raw TMX there), so it stays on. The transfer
      // breakage once blamed on it was actually the onConnected/warp
      // ping-pong loops, fixed since.
      provideTiledMap({ basePath: "map" })
    ]
  });
