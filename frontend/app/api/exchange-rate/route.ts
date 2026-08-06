import { NextResponse } from "next/server";
import { getEthPenRate } from "@/lib/exchangeRate";

export async function GET() {
  const rate = await getEthPenRate();
  return NextResponse.json(rate);
}
