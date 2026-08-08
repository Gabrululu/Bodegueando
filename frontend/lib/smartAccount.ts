"use client";

import { useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { createPublicClient, http, type Abi, type Address } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { puntosTokenAbi, puntosTokenAddress } from "@/lib/contracts";

const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const paymasterAddress = process.env.NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS as Address | undefined;
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;

// Any allowance above this is "effectively unlimited" for our purposes — used to decide
// whether an approve() needs to be batched in before charging gas in PUNTOS.
const APPROVAL_THRESHOLD = BigInt(2) ** BigInt(128);

function pimlicoBundlerUrl(): string {
  return `https://api.pimlico.io/v2/arbitrum-sepolia/rpc?apikey=${pimlicoApiKey}`;
}

/**
 * PuntosPaymaster.sol decides everything on-chain (free first tx, then charges PUNTOS via
 * allowance) — there's no off-chain signature or policy to fetch, so getPaymasterData and
 * getPaymasterStubData just point the UserOperation at our contract. See
 * contracts/solidity/src/PuntosPaymaster.sol.
 */
function puntosPaymaster(address: Address) {
  return {
    async getPaymasterStubData() {
      return {
        paymaster: address,
        paymasterData: "0x" as const,
        paymasterVerificationGasLimit: BigInt(100_000),
        paymasterPostOpGasLimit: BigInt(100_000),
      };
    },
    async getPaymasterData() {
      return {
        paymaster: address,
        paymasterData: "0x" as const,
      };
    },
  };
}

export function usePublicClient() {
  return createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });
}

/**
 * Every write in the app (registerSelf, receivePayment, setFiadoEnabled) goes through this
 * smart account instead of a plain wagmi writeContract — the account's owner/signer is the
 * user's Privy embedded wallet, but the account itself pays gas via PuntosPaymaster (free the
 * first time, then billed in PUNTOS). Returns null while the account is still being set up.
 */
export function useSmartAccountClient(): {
  client: SmartAccountClient | null;
  address: Address | null;
  isLoading: boolean;
} {
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");

  const [client, setClient] = useState<SmartAccountClient | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      if (!embeddedWallet || !paymasterAddress || !pimlicoApiKey) {
        setClient(null);
        setAddress(null);
        return;
      }

      setIsLoading(true);
      try {
        const provider = await embeddedWallet.getEthereumProvider();
        const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });

        // permissionless.js's `owner` type is a strict union — pass just `{ request }`
        // (all it actually needs to sign) instead of the full EIP1193Provider, whose extra
        // `on`/`removeListener` methods don't match any union member cleanly.
        const account = await toSimpleSmartAccount({
          client: publicClient,
          owner: { request: provider.request.bind(provider) },
          entryPoint: { address: entryPoint07Address, version: "0.7" },
        });

        const pimlicoClient = createPimlicoClient({
          transport: http(pimlicoBundlerUrl()),
          entryPoint: { address: entryPoint07Address, version: "0.7" },
        });

        const smartAccountClient = createSmartAccountClient({
          account,
          chain: arbitrumSepolia,
          bundlerTransport: http(pimlicoBundlerUrl()),
          paymaster: puntosPaymaster(paymasterAddress),
          userOperation: {
            estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
          },
        });

        if (!cancelled) {
          setClient(smartAccountClient);
          setAddress(account.address);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    setup();
    return () => {
      cancelled = true;
    };
  }, [embeddedWallet]);

  return { client, address, isLoading };
}

export interface ContractCall {
  address: Address;
  // Loosely typed on purpose: lib/contracts.ts's ABIs come from plain (non-`as const`) JSON
  // imports, so their element `type` fields widen to `string` instead of the literal union
  // `Abi` requires — same looseness wagmi's own hooks already tolerate elsewhere in the app.
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

/** Sends one or more contract calls as a single (optionally batched) UserOperation. */
export async function sendSmartAccountTx(client: SmartAccountClient, calls: ContractCall[]) {
  return client.sendUserOperation({
    calls: calls.map((call) => ({
      to: call.address,
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
      value: call.value,
    })),
  } as Parameters<SmartAccountClient["sendUserOperation"]>[0]);
}

/**
 * Sends `calls` as a UserOperation and waits for it to land, transparently prepending a
 * PUNTOS approve() for PuntosPaymaster the first time an account needs it (its first-ever
 * UserOperation is sponsored free by the paymaster regardless of allowance — see
 * PuntosPaymaster.sol — so this only matters from the second transaction onward). This is
 * the one function BuyerPanel/BodegaOwnerPanel should call for every write.
 */
export async function sendAndWait(client: SmartAccountClient, accountAddress: Address, calls: ContractCall[]) {
  const finalCalls = [...calls];

  if (paymasterAddress) {
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
    const allowance = (await publicClient.readContract({
      address: puntosTokenAddress as Address,
      abi: puntosTokenAbi,
      functionName: "allowance",
      args: [accountAddress, paymasterAddress],
    })) as bigint;

    if (allowance < APPROVAL_THRESHOLD) {
      finalCalls.unshift({
        address: puntosTokenAddress as Address,
        abi: puntosTokenAbi as Abi,
        functionName: "approve",
        args: [paymasterAddress, BigInt(2) ** BigInt(256) - BigInt(1)],
      });
    }
  }

  const hash = await sendSmartAccountTx(client, finalCalls);
  return client.waitForUserOperationReceipt({ hash });
}
