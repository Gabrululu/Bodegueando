"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import type { BodegaProfileFields } from "./profileMessage";

export type BodegaProfile = BodegaProfileFields & { logoVersion: number | null; updatedAt: number };

export const bodegaProfileKey = (address: string | null | undefined) => ["bodega-profile", address?.toLowerCase()];

/** Perfil público de una bodega (nombre, rubro, referencia, si tiene logo). `null` si no armó uno. */
export function useBodegaProfile(address: Address | string | null | undefined) {
  return useQuery({
    queryKey: bodegaProfileKey(address),
    enabled: Boolean(address),
    staleTime: 60_000,
    queryFn: async (): Promise<BodegaProfile | null> => {
      const res = await fetch(`/api/bodega/profile?address=${address}`);
      if (!res.ok) throw new Error(`profile ${res.status}`);
      return ((await res.json()) as { profile: BodegaProfile | null }).profile;
    },
  });
}

/** Perfiles de varias bodegas a la vez (para el mapa). */
export function useBodegaProfiles(addresses: string[]) {
  const key = [...addresses].map((a) => a.toLowerCase()).sort().join(",");
  return useQuery({
    queryKey: ["bodega-profiles", key],
    enabled: addresses.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, BodegaProfile>> => {
      const result: Record<string, BodegaProfile> = {};
      const list = key.split(",");
      for (let i = 0; i < list.length; i += 50) {
        const res = await fetch(`/api/bodega/profile?addresses=${list.slice(i, i + 50).join(",")}`);
        if (res.ok) Object.assign(result, ((await res.json()) as { profiles: Record<string, BodegaProfile> }).profiles);
      }
      return result;
    },
  });
}

export function useRefreshBodegaProfile() {
  const queryClient = useQueryClient();
  return (address: string) => queryClient.invalidateQueries({ queryKey: bodegaProfileKey(address) });
}

/** URL del logo, versionada para que el navegador no muestre uno viejo después de cambiarlo. */
export function logoUrl(address: string, profile: BodegaProfile | null | undefined): string | null {
  if (!profile?.logoVersion) return null;
  return `/api/bodega/logo?address=${address.toLowerCase()}&v=${profile.logoVersion}`;
}

/** Iniciales para cuando no hay logo: "Bodega Don Pepe" → "DP". */
export function initials(name: string): string {
  const words = name
    .replace(/^bodega\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return (words.length === 0 ? "B" : words.slice(0, 2).map((w) => w[0]).join("")).toUpperCase();
}

const LOGO_SIZE = 256;
const TARGET_BYTES = 90_000;

/**
 * Prepara el logo en el navegador: lo recorta al centro en cuadrado, lo baja a 256×256 y lo
 * convierte a WebP (o JPEG si el navegador no sabe codificar WebP), bajando la calidad hasta que
 * pese menos de ~90 KB. Así el servidor nunca recibe una foto de 5 MB tomada con el celular.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Elige una imagen.");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_SIZE;
  canvas.height = LOGO_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no pudo procesar la imagen.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LOGO_SIZE, LOGO_SIZE);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, LOGO_SIZE, LOGO_SIZE);
  bitmap.close();

  const webpSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  const type = webpSupported ? "image/webp" : "image/jpeg";
  for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
    const dataUrl = canvas.toDataURL(type, quality);
    if ((dataUrl.length * 3) / 4 <= TARGET_BYTES) return dataUrl;
  }
  throw new Error("No pudimos achicar la imagen lo suficiente. Prueba con otra.");
}
