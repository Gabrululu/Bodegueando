import { readJsonStore, writeJsonStore } from "./kv";

/**
 * Server-only Telegram Bot API helpers. Never import this from a client component —
 * it reads TELEGRAM_BOT_TOKEN (a secret).
 *
 * Linking a bodega to a chat uses long-polling (`getUpdates`) instead of a webhook, on
 * purpose: webhooks need a public HTTPS URL, which a local/hackathon dev server doesn't
 * have without a tunnel. `getUpdates` works from anywhere, including localhost. The
 * bodega→chat_id mapping goes through lib/kv.ts (Redis in production, a JSON file locally).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;

const STORE_NAME = "telegram-links";

type Links = Record<string, number>;

export async function getChatIdForBodega(bodegaAddress: string): Promise<number | undefined> {
  const links = await readJsonStore<Links>(STORE_NAME, {});
  return links[bodegaAddress.toLowerCase()];
}

export async function linkChatToAddress(address: string, chatId: number): Promise<void> {
  const links = await readJsonStore<Links>(STORE_NAME, {});
  links[address.toLowerCase()] = chatId;
  await writeJsonStore(STORE_NAME, links);
}

export async function getAddressForChat(chatId: number): Promise<string | undefined> {
  const links = await readJsonStore<Links>(STORE_NAME, {});
  for (const [address, linkedChatId] of Object.entries(links)) {
    if (linkedChatId === chatId) return address;
  }
  return undefined;
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  if (!API_BASE) return false;
  const res = await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.ok;
}
