import { readJsonStore, writeJsonStore } from "./kv";

/**
 * Server-only, permanent code store for bodegas — deliberately separate from
 * lib/linkCodes.ts (which is short-lived/single-use for Telegram linking). A bodega's code
 * goes on a physical sign/QR in the store and gets scanned for months, so it must never
 * expire and must always resolve to the same address once created.
 */
const STORE_NAME = "bodega-codes";

interface Store {
  codeToAddress: Record<string, string>;
  addressToCode: Record<string, string>;
}

const EMPTY_STORE: Store = { codeToAddress: {}, addressToCode: {} };

function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function getOrCreateCode(address: string): Promise<string> {
  const store = await readJsonStore(STORE_NAME, EMPTY_STORE);
  const key = address.toLowerCase();

  const existing = store.addressToCode[key];
  if (existing) return existing;

  let code = generateSixDigitCode();
  while (store.codeToAddress[code]) {
    code = generateSixDigitCode();
  }

  store.codeToAddress[code] = key;
  store.addressToCode[key] = code;
  await writeJsonStore(STORE_NAME, store);
  return code;
}

export async function resolveCode(code: string): Promise<string | undefined> {
  const store = await readJsonStore(STORE_NAME, EMPTY_STORE);
  return store.codeToAddress[code];
}
