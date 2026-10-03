/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: "live" | "fixture";
  readonly VITE_SPACETIMEDB_URI?: string;
  readonly VITE_SPACETIMEDB_DATABASE?: string;
}
