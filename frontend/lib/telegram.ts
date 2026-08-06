import fs from "fs";
import path from "path";

/**
 * Server-only Telegram Bot API helpers. Never import this from a client component —
 * it reads TELEGRAM_BOT_TOKEN (a secret) and touches the filesystem.
 *
 * Linking a bodega to a chat uses long-polling (`getUpdates`) instead of a webhook, on
 * purpose: webhooks need a public HTTPS URL, which a local/hackathon dev server doesn't
 * have without a tunnel. `getUpdates` works from anywhere, including localhost. The
 * bodega→chat_id mapping is a small JSON file, not a database — deliberately minimal for
 * the demo; see README for the shortcut note.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;

const STORE_PATH = path.join(process.cwd(), ".data", "telegram-links.json");

function readLinks(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeLinks(links: Record<string, number>) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(links, null, 2));
}

export function getChatIdForBodega(bodegaAddress: string): number | undefined {
  return readLinks()[bodegaAddress.toLowerCase()];
}

export function linkChatToAddress(address: string, chatId: number): void {
  const links = readLinks();
  links[address.toLowerCase()] = chatId;
  writeLinks(links);
}

export function getAddressForChat(chatId: number): string | undefined {
  const links = readLinks();
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

