import { keccak256, toBytes } from "viem";

/**
 * Perfil público de una bodega: cómo la ven sus clientes (en el QR, al escribir su código, en
 * el mapa) y cómo se ve su propio panel. Es metadata de presentación — vive en Redis, no en un
 * contrato —, pero cambiarlo exige la firma de la dueña de la cuenta (ver lib/ownerAuth.ts):
 * si no, cualquiera podría renombrar una bodega ajena o ponerle un logo engañoso.
 *
 * Este archivo lo usan el navegador y el servidor, así los dos arman exactamente el mismo
 * mensaje a firmar.
 */
export type BodegaProfileFields = {
  name: string;
  description: string;
  reference: string;
};

export const PROFILE_LIMITS = { name: 40, description: 60, reference: 80 } as const;
export const MAX_LOGO_BYTES = 150_000;
export const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Qué hacer con el logo al guardar: dejarlo como está, quitarlo, o reemplazarlo por un data URL. */
export type LogoChange = { action: "keep" } | { action: "remove" } | { action: "set"; dataUrl: string };

/** Quita espacios de más y caracteres de control; recorta al largo permitido. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function cleanFields(fields: Partial<BodegaProfileFields>): BodegaProfileFields {
  return {
    name: cleanText(fields.name, PROFILE_LIMITS.name),
    description: cleanText(fields.description, PROFILE_LIMITS.description),
    reference: cleanText(fields.reference, PROFILE_LIMITS.reference),
  };
}

/** Hash de lo que se guarda — el mensaje firmado lo incluye, así la firma no sirve para otros datos. */
export function profilePayloadHash(bodega: string, fields: BodegaProfileFields, logo: LogoChange): `0x${string}` {
  const canonical = JSON.stringify({
    bodega: bodega.toLowerCase(),
    name: fields.name,
    description: fields.description,
    reference: fields.reference,
    logo: logo.action === "set" ? keccak256(toBytes(logo.dataUrl)) : logo.action,
  });
  return keccak256(toBytes(canonical));
}

export function profileMessage(bodega: string, payloadHash: string, issuedAt: number): string {
  return [
    "Bodegueando: actualizar el perfil de mi bodega",
    `Bodega: ${bodega.toLowerCase()}`,
    `Datos: ${payloadHash}`,
    `Fecha: ${new Date(issuedAt).toISOString()}`,
  ].join("\n");
}
