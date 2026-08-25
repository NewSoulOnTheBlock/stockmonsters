import { createServer,  provideServerModules, LocalStorageSaveStorageStrategy } from "@rpgjs/server";
import { provideMain } from "./modules/main";
import { provideSaveStorage } from "@rpgjs/server";
import { provideTiledMap } from "@rpgjs/tiledmap/server";

export default createServer({
    providers: [
      provideMain(),
      provideSaveStorage(new LocalStorageSaveStorageStrategy({ key: "save" })),
      provideServerModules([]),
      provideTiledMap({
        basePath: "map",
        // Progressive chunk streaming breaks on map transitions in beta.33
        // ("f.tilesets is not iterable" client-side); our maps are 64x64 so
        // whole-map direct loading costs nothing.
        streaming: false
      })
    ]
  });
