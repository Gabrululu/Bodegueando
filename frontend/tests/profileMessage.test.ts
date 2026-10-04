import { describe, expect, it } from "vitest";
import { cleanFields, cleanText, profilePayloadHash } from "@/lib/bodega/profileMessage";

describe("lib/bodega/profileMessage", () => {
  it("cleanText quita caracteres de control, colapsa espacios y recorta", () => {
    expect(cleanText("  Bodega\n\tDoña   Rosa  ", 40)).toBe("Bodega Doña Rosa");
    expect(cleanText("x".repeat(100), 10)).toHaveLength(10);
    expect(cleanText(42, 10)).toBe("");
  });

  it("el hash cambia si cambia cualquier dato firmado", () => {
    const fields = cleanFields({ name: "Doña Rosa", description: "", reference: "" });
    const base = profilePayloadHash("0xabc", fields, { action: "keep" });
    expect(profilePayloadHash("0xABC", fields, { action: "keep" })).toBe(base);
    expect(profilePayloadHash("0xabc", { ...fields, name: "Otra" }, { action: "keep" })).not.toBe(base);
    expect(profilePayloadHash("0xabc", fields, { action: "remove" })).not.toBe(base);
  });
});
