// MapLibre resolves its module worker relative to its own bundle URL, which
// bundlers rewrite. Serve the worker (and the shared chunk it imports) from
// /public so the map can point at a stable URL.
import { copyFileSync, mkdirSync } from "node:fs";

const from = "node_modules/maplibre-gl/dist";
const to = "public/maplibre";
mkdirSync(to, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(`${from}/${file}`, `${to}/${file}`);
