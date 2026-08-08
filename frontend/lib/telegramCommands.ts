import { consumeCode } from "./linkCodes";
import { linkChatToAddress, sendTelegramMessage } from "./telegram";
import { getProfileText } from "./telegramProfile";

/**
 * Despacho de comandos del bot, compartido entre el webhook de producción
 * (app/api/telegram/webhook/route.ts) y el daemon de desarrollo
 * (scripts/telegram-bot.mjs, que en vez de llamar esto directo reenvía HTTP a las rutas
 * de siempre — es un proceso Node aparte, no puede importar módulos de la app Next.js).
 * Vive acá para no duplicar esta lógica entre ambos consumidores.
 */

async function handleVincular(chatId: number, code: string | undefined) {
  if (!code) {
    await sendTelegramMessage(chatId, "Mándame el código así: /vincular 123456");
    return;
  }
  const address = await consumeCode(code);
  if (!address) {
    await sendTelegramMessage(chatId, "Ese código no es válido o ya venció. Genera uno nuevo en la web.");
    return;
  }
  await linkChatToAddress(address, chatId);
  await sendTelegramMessage(chatId, "✅ Listo, tu cuenta quedó vinculada. Mándame /perfil cuando quieras.");
}

async function handlePerfil(chatId: number) {
  const text = await getProfileText(chatId);
  await sendTelegramMessage(chatId, text);
}

async function handleStart(chatId: number, payload: string | undefined) {
  if (payload) {
    await handleVincular(chatId, payload);
    return;
  }
  await sendTelegramMessage(
    chatId,
    "👋 Bienvenido a Bodegueando.\n\n" +
      "1. Entra a la web y genera tu código de 6 dígitos.\n" +
      "2. Mándame /vincular <código> acá.\n" +
      "3. Después escribe /perfil cuando quieras ver tus pagos, puntos o fiado.",
  );
}

export async function dispatchTelegramCommand(chatId: number, text: string): Promise<void> {
  const trimmed = text.trim();

  if (trimmed.startsWith("/start")) {
    await handleStart(chatId, trimmed.split(/\s+/)[1]);
  } else if (trimmed.startsWith("/vincular")) {
    await handleVincular(chatId, trimmed.split(/\s+/)[1]);
  } else if (trimmed === "/perfil") {
    await handlePerfil(chatId);
  }
}
