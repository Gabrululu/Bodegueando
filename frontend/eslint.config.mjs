import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored shadcn/mapcn component code (components/ui) — copied in by their CLIs, not
    // hand-written to this project's lint rules. Same reasoning as ignoring node_modules.
    "components/ui/**",
    // Copias del worker de MapLibre que scripts/copy-maplibre-worker.mjs deja en public/ al
    // instalar — artefactos de build de un paquete de terceros, no código del proyecto.
    "public/maplibre-gl-*.mjs",
  ]),
]);

export default eslintConfig;
