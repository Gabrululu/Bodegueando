import { describe, expect, it, vi } from "vitest";
import { consumeCode, createCode } from "@/lib/linkCodes";
import { useTempKv } from "./setup-kv";

const ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

describe("lib/linkCodes", () => {
  useTempKv();

  it("un código de 6 dígitos que se consume una sola vez", async () => {
    const code = await createCode(ADDRESS);
    expect(code).toMatch(/^\d{6}$/);
    expect(await consumeCode(code)).toBe(ADDRESS.toLowerCase());
    expect(await consumeCode(code)).toBeUndefined();
  });

  it("un código vencido no vale aunque el backend ignore el TTL", async () => {
    const code = await createCode(ADDRESS);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
    expect(await consumeCode(code)).toBeUndefined();
  });

  it("rechaza lo que no es un código", async () => {
    expect(await consumeCode("12345")).toBeUndefined();
    expect(await consumeCode("abcdef")).toBeUndefined();
  });
});
