// Server-only, en memoria: códigos cortos de un solo uso para vincular una wallet
// con un chat de Telegram sin que el chat muestre nunca una dirección 0x...
// No necesitan sobrevivir un reinicio del servidor, así que no hace falta
// persistirlos a disco como el mapeo de chat_id (ver lib/telegram.ts).
const CODE_TTL_MS = 10 * 60 * 1000;

interface PendingCode {
  address: string;
  expiresAt: number;
}

const codes = new Map<string, PendingCode>();

function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createCode(address: string): string {
  let code = generateSixDigitCode();
  while (codes.has(code)) {
    code = generateSixDigitCode();
  }
  codes.set(code, { address: address.toLowerCase(), expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

export function consumeCode(code: string): string | undefined {
  const pending = codes.get(code);
  codes.delete(code);
  if (!pending || pending.expiresAt < Date.now()) return undefined;
  return pending.address;
}
