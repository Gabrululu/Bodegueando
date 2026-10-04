import { describe, expect, it } from "vitest";
import { paymasterAlertText, type PaymasterHealth } from "@/lib/paymasterHealth";

const healthy: PaymasterHealth = {
  paymaster: "0x493D8B20f12E94cf513b9F078E41FFDF1E685B86",
  depositEth: "0.02",
  depositThresholdEth: "0.01",
  depositLow: false,
  contractEthUsd: 2694,
  marketEthUsd: 2697,
  rateDriftPct: -0.1,
  rateStale: false,
};

describe("lib/paymasterHealth", () => {
  it("sin problemas no hay alerta", () => {
    expect(paymasterAlertText(healthy)).toBeNull();
  });

  it("avisa del depósito bajo", () => {
    expect(paymasterAlertText({ ...healthy, depositEth: "0.004", depositLow: true })).toContain("Depósito de gas bajo: 0.004 ETH");
  });

  it("avisa de la tasa desactualizada con el comando para corregirla", () => {
    const text = paymasterAlertText({ ...healthy, marketEthUsd: 3200, rateDriftPct: -15.8, rateStale: true });
    expect(text).toContain("puntosPerEth desactualizado");
    expect(text).toContain('"setPuntosPerEth(uint256)" 3200e18');
  });
});
