import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA: permite instalar Bodegueando en la pantalla de inicio del celular y abrirla
 * como una app (sin barra del navegador). Abre directo en /app — quien la instala ya la usa, no
 * necesita volver a ver la página de presentación.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Bodegueando",
    short_name: "Bodegueando",
    description: "Cobros con QR, puntos y fiado para tu bodega de barrio.",
    lang: "es-PE",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fafaf7",
    theme_color: "#fafaf7",
    categories: ["finance", "business", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
