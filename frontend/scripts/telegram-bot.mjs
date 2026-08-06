// Daemon de polling para el bot de Telegram. Corre aparte del servidor de Next.js
// (`pnpm run bot`, en una terminal propia) porque las API routes solo responden a
// pedidos entrantes — para reaccionar a comandos escritos en cualquier momento
// (/perfil) hace falta un proceso que esté siempre escuchando.
//
// Es un adaptador delgado: toda la lógica de negocio (lecturas on-chain, formateo en
// soles) vive en las API routes de Next.js (app/api/telegram/*); este script solo
// reenvía mensajes de Telegram hacia esas rutas y las respuestas de vuelta al chat.
//
// Long-polling (getUpdates), no webhook: un webhook necesita una URL HTTPS pública,
// que un servidor de desarrollo local no tiene sin un túnel.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

if (!BOT_TOKEN) {
  console.error("Falta TELEGRAM_BOT_TOKEN en frontend/.env.local");
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function getUpdates(offset) {
  const url = new URL(`${API_BASE}/getUpdates`);
  url.searchParams.set("timeout", "25");
  if (offset !== undefined) url.searchParams.set("offset", String(offset));
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  return data.ok ? data.result : [];
}

async function sendMessage(chatId, text) {
  await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

async function handleVincular(chatId, code) {
  if (!code) {
    await sendMessage(chatId, "Mándame el código así: /vincular 123456");
    return;
  }
  try {
    const res = await fetch(`${APP_BASE_URL}/api/telegram/consume-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, chatId }),
    });
    const data = await res.json();
    if (data.linked) {
      await sendMessage(chatId, "✅ Listo, tu cuenta quedó vinculada. Mándame /perfil cuando quieras.");
    } else {
      await sendMessage(chatId, "Ese código no es válido o ya venció. Genera uno nuevo en la web.");
    }
  } catch {
    await sendMessage(chatId, "No pude vincular tu cuenta ahora mismo, intenta de nuevo en un rato.");
  }
}

async function handlePerfil(chatId) {
  try {
    const res = await fetch(`${APP_BASE_URL}/api/telegram/profile?chatId=${chatId}`);
    const data = await res.json();
    await sendMessage(chatId, data.text || "No pude leer tu perfil ahora mismo, intenta de nuevo.");
  } catch {
    await sendMessage(chatId, "No pude leer tu perfil ahora mismo, intenta de nuevo.");
  }
}

async function handleStart(chatId) {
  await sendMessage(
    chatId,
    "👋 Bienvenido a Bodegueando.\n\n" +
      "1. Entra a la web y genera tu código de 6 dígitos.\n" +
      "2. Mándame /vincular <código> acá.\n" +
      "3. Después escribe /perfil cuando quieras ver tus pagos, puntos o fiado.",
  );
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text === "/start") {
    await handleStart(chatId);
  } else if (text.startsWith("/vincular")) {
    const code = text.split(/\s+/)[1];
    await handleVincular(chatId, code);
  } else if (text === "/perfil") {
    await handlePerfil(chatId);
  }
}

async function main() {
  console.log(`Bot de Bodegueando escuchando (app en ${APP_BASE_URL})...`);
  let offset;
  for (;;) {
    const updates = await getUpdates(offset);
    for (const update of updates) {
      offset = update.update_id + 1;
      await handleUpdate(update);
    }
  }
}

main();
