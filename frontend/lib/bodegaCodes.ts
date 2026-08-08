import fs from "fs";
import path from "path";

/**
 * Server-only, permanent code store for bodegas — deliberately separate from
 * lib/linkCodes.ts (which is short-lived/single-use for Telegram linking). A bodega's code
 * goes on a physical sign/QR in the store and gets scanned for months, so it must never
 * expire and must always resolve to the same address once created.
 */
const STORE_PATH = path.join(process.cwd(), ".data", "bodega-codes.json");

interface Store {
  codeToAddress: Record<string, string>;
  addressToCode: Record<string, string>;
}

function readStore(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return { codeToAddress: {}, addressToCode: {} };
  }
}

function writeStore(store: Store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function getOrCreateCode(address: string): string {
  const store = readStore();
  const key = address.toLowerCase();

  const existing = store.addressToCode[key];
  if (existing) return existing;

  let code = generateSixDigitCode();
  while (store.codeToAddress[code]) {
    code = generateSixDigitCode();
  }

  store.codeToAddress[code] = key;
  store.addressToCode[key] = code;
  writeStore(store);
  return code;
}

export function resolveCode(code: string): string | undefined {
  return readStore().codeToAddress[code];
}
