import { readJsonStore, writeJsonStore } from "./kv";

/**
 * Server-only store for where a bodega shows up on the map — separate from
 * lib/bodegaCodes.ts (permanent code) and lib/linkCodes.ts (short-lived Telegram codes),
 * same reasoning: different lifecycle, different shape. This is UX metadata, not something
 * that needs on-chain trustlessness (nobody's money depends on a pin being accurate), so it
 * lives here instead of in a contract — same call already made for bodega codes.
 */
const STORE_NAME = "bodega-locations";

interface Location {
  lat: number;
  lng: number;
  updatedAt: number;
}

type Store = Record<string, Location>;

const EMPTY_STORE: Store = {};

export async function setLocation(address: string, lat: number, lng: number): Promise<void> {
  const store = await readJsonStore(STORE_NAME, EMPTY_STORE);
  store[address.toLowerCase()] = { lat, lng, updatedAt: Date.now() };
  await writeJsonStore(STORE_NAME, store);
}

export async function getLocation(address: string): Promise<Location | undefined> {
  const store = await readJsonStore(STORE_NAME, EMPTY_STORE);
  return store[address.toLowerCase()];
}

export async function getAllLocations(): Promise<Array<{ address: string } & Location>> {
  const store = await readJsonStore(STORE_NAME, EMPTY_STORE);
  return Object.entries(store).map(([address, location]) => ({ address, ...location }));
}
