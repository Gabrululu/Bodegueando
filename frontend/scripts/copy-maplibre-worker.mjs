// maplibre-gl calcula la URL de su Web Worker a partir de `import.meta.url` del propio
// paquete, y solo la acepta si empieza con "http(s):" (ver dist/maplibre-gl.mjs, función que
// arma esa URL). Bajo el bundling de Next.js/Turbopack esa condición nunca se cumple —
// import.meta.url deja de ser una URL http(s) real una vez empaquetado — así que la librería
// vuelve silenciosamente a un string vacío, y `new Worker("")` termina resolviendo contra la
// URL de la propia página. El worker "existe" pero nunca procesa nada: sourcedata se queda
// pegado en isSourceLoaded=false para siempre y el mapa no carga ni un tile, sin ningún error
// en consola (ver ARCHITECTURE.md, sección del mapa, para el diagnóstico completo).
//
// El fix documentado por MapLibre para este caso (bundlers que no preservan import.meta.url)
// es apuntar `maplibregl.setWorkerUrl(...)` a una copia servida como archivo estático. Este
// script copia esa copia a public/ en cada `pnpm install` (postinstall) para que nunca quede
// desincronizada de la versión de maplibre-gl instalada — no se commitea, es un artefacto de
// build igual que node_modules (ver .gitignore).

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const srcDir = join(__dirname, "..", "node_modules", "maplibre-gl", "dist");
const destDir = join(__dirname, "..", "public");
mkdirSync(destDir, { recursive: true });

// maplibre-gl-worker.mjs hace `import ... from "./maplibre-gl-shared.mjs"` — un import
// relativo real, no inline. Como módulo, el navegador resuelve ese specifier contra la propia
// URL del worker, así que el hermano tiene que vivir al lado en public/ o el worker falla en
// silencio (import 404 dentro del worker, sin ningún error visible en la página principal).
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(srcDir, file), join(destDir, file));
  console.log(`Copiado ${file} a public/`);
}
