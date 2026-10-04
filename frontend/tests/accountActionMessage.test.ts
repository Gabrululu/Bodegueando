import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { describe, expect, it } from "vitest";
import { accountActionMessage, signAccountAction } from "@/lib/accountActionMessage";

describe("lib/accountActionMessage", () => {
  it("arma el mismo texto en navegador y servidor, con los detalles atados", () => {
    const message = accountActionMessage("bodega-location", "0xABC", Date.UTC(2026, 9, 4), { lat: -12.05, lng: -77.04 });
    expect(message).toBe(
      [
        "Bodegueando: guardar la ubicación de mi bodega",
        "Cuenta: 0xabc",
        "lat: -12.05",
        "lng: -77.04",
        "Fecha: 2026-10-04T00:00:00.000Z",
      ].join("\n"),
    );
  });

  it("signAccountAction firma exactamente ese mensaje", async () => {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const { issuedAt, signature } = await signAccountAction((m) => wallet.signMessage({ message: m }), "fiado-score", "0xabc");
    const signer = await recoverMessageAddress({ message: accountActionMessage("fiado-score", "0xabc", issuedAt), signature });
    expect(signer).toBe(wallet.address);
  });
});
