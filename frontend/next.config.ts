import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El service worker (public/sw.js) no se cachea en el navegador ni en la CDN: así una versión
  // nueva llega en la próxima visita. Y solo puede cargar scripts del propio sitio.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
