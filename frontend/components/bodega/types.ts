import type { Address } from "viem";
import type { SmartAccountClient } from "permissionless";

export type BodegaTab = "inicio" | "cobrar" | "fiado" | "credito" | "red";

/** Lo que el panel le pasa a cada pestaña: la cuenta y cómo moverse a otra pestaña. */
export type TabProps = {
  address: Address;
  client: SmartAccountClient | null;
  navigate: (tab: BodegaTab, anchor?: string) => void;
};
