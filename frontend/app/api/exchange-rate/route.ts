import { NextResponse } from "next/server";
import { getExchangeRates } from "@/lib/exchangeRate";

export async function GET() {
  const rate = await getExchangeRates();
  return NextResponse.json(rate);
}
