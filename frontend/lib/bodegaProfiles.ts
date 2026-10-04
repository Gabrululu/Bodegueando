import { getValue, getValues, setValue, deleteKey } from "./kv";
import { cleanFields, type BodegaProfileFields } from "./bodega/profileMessage";

/**
 * Server-only store del perfil de cada bodega (nombre, rubro, referencia y logo). Una clave por
 * bodega en vez de un solo blob como bodegaLocations.ts: el logo pesa decenas de KB y leer el
 * mapa no debería traer todas las imágenes. Por eso el logo va en su propia clave y el perfil
 * solo guarda si existe y cuándo cambió (para invalidar caché del lado del navegador).
 */
export type StoredProfile = BodegaProfileFields & { logoVersion: number | null; updatedAt: number };

const profileKey = (address: string) => `bodega-profile:${address.toLowerCase()}`;
const logoKey = (address: string) => `bodega-logo:${address.toLowerCase()}`;

/** El cliente REST de Upstash devuelve el JSON ya parseado; el archivo local, el string. */
function parseProfile(raw: unknown): StoredProfile | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof value !== "object" || value === null) return null;
  const v = value as Partial<StoredProfile>;
  return {
    ...cleanFields(v),
    logoVersion: typeof v.logoVersion === "number" ? v.logoVersion : null,
    updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
  };
}

export async function getProfile(address: string): Promise<StoredProfile | null> {
  return parseProfile(await getValue(profileKey(address)));
}

export async function getProfiles(addresses: string[]): Promise<Record<string, StoredProfile>> {
  const raws = await getValues(addresses.map(profileKey));
  const result: Record<string, StoredProfile> = {};
  addresses.forEach((address, i) => {
    const profile = parseProfile(raws[i]);
    if (profile) result[address.toLowerCase()] = profile;
  });
  return result;
}

export async function saveProfile(
  address: string,
  fields: BodegaProfileFields,
  logo: { action: "keep" } | { action: "remove" } | { action: "set"; mime: string; base64: string },
): Promise<StoredProfile> {
  const previous = await getProfile(address);
  const now = Date.now();
  let logoVersion = previous?.logoVersion ?? null;

  if (logo.action === "set") {
    await setValue(logoKey(address), JSON.stringify({ mime: logo.mime, base64: logo.base64 }));
    logoVersion = now;
  } else if (logo.action === "remove") {
    await deleteKey(logoKey(address));
    logoVersion = null;
  }

  const profile: StoredProfile = { ...fields, logoVersion, updatedAt: now };
  await setValue(profileKey(address), JSON.stringify(profile));
  return profile;
}

export async function getLogo(address: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const raw = await getValue(logoKey(address));
  if (raw === null || raw === undefined) return null;
  const value = (typeof raw === "string" ? JSON.parse(raw) : raw) as { mime?: string; base64?: string };
  if (!value.mime || !value.base64) return null;
  return { mime: value.mime, bytes: Buffer.from(value.base64, "base64") };
}
