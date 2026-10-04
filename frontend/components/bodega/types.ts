import type { Address, Hex } from "viem";
import type { SmartAccountClient } from "permissionless";

/** "perfil" no está en la barra de pestañas: se entra tocando el encabezado de la bodega. */
export type BodegaTab = "inicio" | "cobrar" | "fiado" | "credito" | "red" | "perfil";

/** Lo que el panel le pasa a cada pestaña: la cuenta y cómo moverse a otra pestaña. */
export type TabProps = {
  address: Address;
  client: SmartAccountClient | null;
  navigate: (tab: BodegaTab, anchor?: string) => void;
  /** Firma con la wallet dueña de la cuenta (para cambios off-chain como el perfil). */
  signAsOwner: ((message: string) => Promise<Hex>) | null;
};
