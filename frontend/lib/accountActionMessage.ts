import type { Hex } from "viem";

/**
 * Mensajes que la dueña de una cuenta firma para autorizar una acción en una ruta de la API
 * (verificados con lib/ownerAuth.ts). Este archivo lo usan el navegador y el servidor, así los
 * dos arman exactamente el mismo texto.
 *
 * `details` ata la firma a los datos concretos de la acción (p. ej. las coordenadas), para que
 * no sirva para otra cosa. El perfil de la bodega usa su propio mensaje
 * (lib/bodega/profileMessage.ts) porque firma un hash de todo lo que guarda.
 */
const TITLES = {
  "bodega-location": "guardar la ubicación de mi bodega",
  "fiado-score": "recalcular el fiado de mi bodega",
  "fiado-remind": "recordarle a un cliente su deuda de fiado",
  "telegram-link": "vincular mi cuenta con Telegram",
} as const;

export type AccountAction = keyof typeof TITLES;
export type ActionDetails = Record<string, string | number>;

export function accountActionMessage(
  action: AccountAction,
  account: string,
  issuedAt: number,
  details: ActionDetails = {},
): string {
  return [
    `Bodegueando: ${TITLES[action]}`,
    `Cuenta: ${account.toLowerCase()}`,
    ...Object.entries(details).map(([key, value]) => `${key}: ${value}`),
    `Fecha: ${new Date(issuedAt).toISOString()}`,
  ].join("\n");
}

/** Navegador: firma la acción con la wallet dueña y devuelve lo que la ruta espera en el body. */
export async function signAccountAction(
  sign: (message: string) => Promise<Hex>,
  action: AccountAction,
  account: string,
  details: ActionDetails = {},
): Promise<{ issuedAt: number; signature: Hex }> {
  const issuedAt = Date.now();
  const signature = await sign(accountActionMessage(action, account, issuedAt, details));
  return { issuedAt, signature };
}
