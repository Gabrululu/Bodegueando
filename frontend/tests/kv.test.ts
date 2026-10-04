import { describe, expect, it } from "vitest";
import { getValue, incrementCounter, setIfNotExists, takeValue } from "@/lib/kv";
import { useTempKv } from "./setup-kv";

describe("lib/kv (fallback de archivo)", () => {
  useTempKv();

  it("setIfNotExists solo reserva la primera vez", async () => {
    expect(await setIfNotExists("k", "a")).toBe(true);
    expect(await setIfNotExists("k", "b")).toBe(false);
    expect(await getValue("k")).toBe("a");
  });

  it("takeValue devuelve el valor una sola vez", async () => {
    await setIfNotExists("once", "v");
    expect(await takeValue("once")).toBe("v");
    expect(await takeValue("once")).toBeNull();
  });

  it("dos reservas concurrentes de la misma clave: gana una sola", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => setIfNotExists("race", String(i))));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("incrementCounter cuenta desde 1", async () => {
    expect(await incrementCounter("c", 60)).toBe(1);
    expect(await incrementCounter("c", 60)).toBe(2);
  });
});
