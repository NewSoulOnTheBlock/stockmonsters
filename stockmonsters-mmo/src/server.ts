import { createServer,  provideServerModules, LocalStorageSaveStorageStrategy } from "@rpgjs/server";
import { provideMain } from "./modules/main";
import mainServerModule from "./modules/main/server";
import { provideSaveStorage } from "@rpgjs/server";
import { provideTiledMap } from "@rpgjs/tiledmap/server";

export default createServer({
    providers: [
      provideMain(),
      provideSaveStorage(new LocalStorageSaveStorageStrategy({ key: "save" })),
      provideServerModules([mainServerModule]),
      provideTiledMap()
    ]
  });