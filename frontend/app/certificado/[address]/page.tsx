import { createPublicClient, http, isAddress } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { creditCertificateAbi, creditCertificateAddress } from "@/lib/contracts";

/**
 * Página pública de solo lectura para que un banco/proveedor valide el certificado de
 * crédito ZK de una bodega — sin wallet, sin entender contratos, solo abrir el link y ver
 * si el certificado sigue vigente. Mismo patrón que app/pagar/[code]/page.tsx (server
 * component que resuelve todo antes de renderizar), pero leyendo directo del contrato en
 * vez de un código.
 */
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ?? arbitrumSepolia.rpcUrls.default.http[0];

export default async function CertificadoPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;

  if (!isAddress(address) || !creditCertificateAddress) {
    return (
      <div className="flex flex-col flex-1 items-center bg-[#fafaf7] [font-family:var(--font-geist-sans)]">
        <main className="flex w-full max-w-xl flex-col items-center gap-4 px-6 py-16 text-center">
          <h1 className="text-2xl font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">Certificado no disponible</h1>
          <p className="text-[#55564f]">Este link no es válido.</p>
        </main>
      </div>
    );
  }

  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
  const threshold = (await publicClient.readContract({
    address: creditCertificateAddress,
    abi: creditCertificateAbi,
    functionName: "getCertifiedThreshold",
    args: [address],
  })) as bigint;

  const isValid = threshold > BigInt(0);
  let expiresAt: number | null = null;
  if (isValid) {
    const cert = (await publicClient.readContract({
      address: creditCertificateAddress,
      abi: creditCertificateAbi,
      functionName: "certificates",
      args: [address],
    })) as [bigint, bigint];
    expiresAt = Number(cert[1]);
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-[#fafaf7] [font-family:var(--font-geist-sans)]">
      <main className="flex w-full max-w-xl flex-col items-center gap-6 px-6 py-16 text-center">
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2.5">
            <img src="/logo-mark.svg" alt="" className="h-9 w-9 shrink-0" />
            <h1 className="text-3xl font-semibold tracking-tight text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Bodegueando
            </h1>
          </div>
          <p className="text-[#55564f]">Certificado de crédito con Zero-Knowledge</p>
        </div>

        <div className="w-full rounded-[20px] border border-black/10 bg-[#fffffc] p-6 shadow-sm">
          {isValid ? (
            <>
              <p className="text-2xl font-semibold text-green-600">✅ Certificado válido</p>
              <p className="mt-2 text-[#0a0a0b]">
                Esta bodega probó, sin revelar la cifra exacta, que su score de crédito on-chain
                es <span className="font-semibold">≥ {threshold.toString()}</span> (de 1000).
              </p>
              {expiresAt && (
                <p className="mt-2 text-xs text-[#6b6d64]">
                  Vigente hasta {new Date(expiresAt * 1000).toLocaleString("es-PE")}.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-2xl font-semibold text-[#8f9189]">Sin certificado vigente</p>
              <p className="mt-2 text-[#0a0a0b]">Esta dirección no tiene un certificado de crédito ZK vigente ahora mismo.</p>
            </>
          )}
          <p className="mt-4 break-all text-xs text-[#8f9189]">{address}</p>
        </div>

        <p className="text-xs text-[#6b6d64]">
          Verificado leyendo directo del contrato en Arbitrum Sepolia — la prueba se generó con
          un circuito Circom/Groth16 que verifica una firma del oráculo sin exponer el score
          real. No hace falta wallet para ver esta página.
        </p>
      </main>
    </div>
  );
}
