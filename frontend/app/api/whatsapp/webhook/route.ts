import { NextResponse } from "next/server";

/**
 * STUB — Twilio WhatsApp webhook. Lowest priority per product brief, left for last.
 *
 * Target flow: Twilio POSTs here (form-encoded, per their webhook contract) when a
 * bodega's registered number sends/receives a message. On a confirmed PaymentRouter
 * `PaymentReceived` event (watched separately, e.g. via a viem event subscription or
 * indexer), send a WhatsApp confirmation message back via the Twilio REST API.
 *
 * TODO:
 *   - Validate the Twilio request signature (X-Twilio-Signature) before trusting the body.
 *   - Read TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM from env.
 *   - Wire this to the PaymentRouter event watcher once that exists.
 */
export async function POST() {
  return NextResponse.json(
    { status: "not_implemented", message: "WhatsApp webhook stub — see TODOs in route.ts" },
    { status: 501 },
  );
}
