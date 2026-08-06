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

export async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  if (!API_BASE) return false;
  const res = await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.ok;
}

interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

/**
 * Scans recent messages sent to the bot for an exact `/vincular <bodegaAddress>` and,
 * if found, saves the chat_id → bodega mapping. Doesn't advance the update offset, so
 * the message stays discoverable across repeated calls until Telegram's own backlog
 * rolls it off — fine for a "click to link" UI flow.
 */
export async function linkBodegaFromRecentMessages(bodegaAddress: string): Promise<boolean> {
  if (!API_BASE) return false;
  const res = await fetch(`${API_BASE}/getUpdates?limit=100`);
  if (!res.ok) return false;
  const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
  if (!data.ok) return false;

  const target = `/vincular ${bodegaAddress.toLowerCase()}`;
  for (const update of data.result) {
    const text = update.message?.text?.trim().toLowerCase();
    if (text === target && update.message) {
      const links = readLinks();
      links[bodegaAddress.toLowerCase()] = update.message.chat.id;
      writeLinks(links);
      return true;
    }
  }
  return false;
}
