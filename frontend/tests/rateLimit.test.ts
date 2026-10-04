import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { clientIp, hitRateLimit } from "@/lib/rateLimit";
import { useTempKv } from "./setup-kv";

describe("lib/rateLimit", () => {
  useTempKv();

  it("deja pasar hasta el límite y bloquea después", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await hitRateLimit("test", 3, 3600));
    expect(results).toEqual([false, false, false, true, true]);
  });

  it("cada nombre tiene su propio contador", async () => {
    await hitRateLimit("a", 1, 3600);
    expect(await hitRateLimit("a", 1, 3600)).toBe(true);
    expect(await hitRateLimit("b", 1, 3600)).toBe(false);
  });

  it("clientIp toma el primer valor de x-forwarded-for", () => {
    const request = new NextRequest("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(clientIp(request)).toBe("1.2.3.4");
    expect(clientIp(new NextRequest("http://localhost/"))).toBe("unknown");
  });
});
