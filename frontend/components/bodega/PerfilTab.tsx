"use client";

import { useEffect, useRef, useState } from "react";
import { useBodegaCode } from "@/lib/bodega/hooks";
import { logoUrl, prepareLogo, useBodegaProfile, useRefreshBodegaProfile } from "@/lib/bodega/profile";
import {
  cleanFields,
  PROFILE_LIMITS,
  profileMessage,
  profilePayloadHash,
  type LogoChange,
} from "@/lib/bodega/profileMessage";
import {
  cardClass,
  mutedTextClass,
  outlineButtonClass,
  primaryButtonClass,
  primaryButtonStyle,
  sectionTitleClass,
  textInputClass,
} from "@/lib/bodega/ui";
import { BodegaAvatar } from "./BodegaAvatar";
import type { TabProps } from "./types";

/**
 * Perfil público de la bodega: lo que ven sus clientes al escanear el QR o escribir su código,
 * en el mapa, y en el encabezado de este panel. Guardar pide la firma de la dueña de la cuenta.
 */
export function PerfilTab({ address, signAsOwner, navigate }: TabProps) {
  const profileQuery = useBodegaProfile(address);
  const refreshProfile = useRefreshBodegaProfile();
  const bodegaCode = useBodegaCode(address);
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [logo, setLogo] = useState<LogoChange>({ action: "keep" });
  const [logoError, setLogoError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Precargar el formulario con lo guardado, una sola vez por versión del perfil.
  const stored = profileQuery.data;
  if (profileQuery.isSuccess && loadedFor !== (stored?.updatedAt ?? 0)) {
    setLoadedFor(stored?.updatedAt ?? 0);
    setName(stored?.name ?? "");
    setDescription(stored?.description ?? "");
    setReference(stored?.reference ?? "");
    setLogo({ action: "keep" });
  }

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    try {
      setLogo({ action: "set", dataUrl: await prepareLogo(file) });
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "No pudimos usar esa imagen.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleSave() {
    if (!signAsOwner) {
      setSaveError("Tu sesión no está lista todavía. Espera un momento e intenta de nuevo.");
      return;
    }
    const fields = cleanFields({ name, description, reference });
    if (fields.name.length < 2) {
      setSaveError("Escribe el nombre de tu bodega.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const issuedAt = Date.now();
      const signature = await signAsOwner(profileMessage(address, profilePayloadHash(address, fields, logo), issuedAt));
      const res = await fetch("/api/bodega/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodega: address, fields, logo, issuedAt, signature }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar el perfil.");
      setSaved(true);
      await refreshProfile(address);
    } catch (err) {
      console.error("[perfil de bodega] no se pudo guardar", err);
      setSaveError(err instanceof Error ? err.message : "No se pudo guardar el perfil. Intenta de nuevo.");
    } finally {
      setIsSaving(false);
    }
  }

  const previewLogo =
    logo.action === "set" ? logo.dataUrl : logo.action === "remove" ? null : logoUrl(address, stored);
  const previewProfile = { ...cleanFields({ name, description, reference }), logoVersion: null, updatedAt: 0 };
  const hasLogo = previewLogo !== null;

  return (
    <div className="flex flex-col gap-6">
      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Así te ven tus clientes</h2>
        <div className="flex items-center gap-4 rounded-xl border border-black/10 bg-white p-4">
          <BodegaAvatar address={address} profile={previewProfile} size="lg" previewUrl={previewLogo} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              {previewProfile.name || "Tu bodega"}
            </p>
            {previewProfile.description && <p className="truncate text-sm text-[#55564f]">{previewProfile.description}</p>}
            <p className={`truncate ${mutedTextClass}`}>
              {previewProfile.reference ? `${previewProfile.reference} · ` : ""}Código #{bodegaCode ?? "…"}
            </p>
          </div>
        </div>
        <p className={mutedTextClass}>Aparece cuando escanean tu QR o escriben tu código, y en el mapa de bodegas cercanas.</p>
      </section>

      <section className={cardClass}>
        <h2 className={sectionTitleClass}>Perfil de tu bodega</h2>

        <div className="flex flex-wrap items-center gap-3">
          <BodegaAvatar address={address} profile={previewProfile} size="lg" previewUrl={previewLogo} />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              id="bodega-logo"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <label htmlFor="bodega-logo" className={`${outlineButtonClass} min-h-9 py-1 text-xs`}>
              {hasLogo ? "Cambiar logo" : "Subir logo"}
            </label>
            {hasLogo && (
              <button type="button" onClick={() => setLogo({ action: "remove" })} className={`${outlineButtonClass} min-h-9 py-1 text-xs`}>
                Quitar
              </button>
            )}
          </div>
        </div>
        <p className={mutedTextClass}>Opcional. Una foto de tu letrero o tu logo — la recortamos en cuadrado.</p>
        {logoError && <p className="text-xs text-red-500">{logoError}</p>}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-[#0a0a0b]">Nombre de la bodega</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={PROFILE_LIMITS.name}
            placeholder="Ej: Bodega Don Pepe"
            className={textInputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-[#0a0a0b]">
            Qué vendes <span className="font-normal text-[#8a8c81]">(opcional)</span>
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={PROFILE_LIMITS.description}
            placeholder="Ej: Abarrotes, bebidas y panadería"
            className={textInputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-[#0a0a0b]">
            Referencia <span className="font-normal text-[#8a8c81]">(opcional)</span>
          </span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={PROFILE_LIMITS.reference}
            placeholder="Ej: Frente al parque, Surquillo"
            className={textInputClass}
          />
        </label>

        <button onClick={handleSave} disabled={isSaving || !signAsOwner} className={primaryButtonClass} style={primaryButtonStyle}>
          {isSaving ? "Guardando..." : "Guardar perfil"}
        </button>
        <p className={mutedTextClass}>Al guardar te pedimos confirmar con tu cuenta, para que nadie más pueda cambiar tu perfil.</p>
        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
        {saved && (
          <p className="text-xs text-green-600">
            ¡Listo! Tu perfil está actualizado ✓{" "}
            <button type="button" onClick={() => navigate("inicio")} className="cursor-pointer underline">
              Volver al inicio
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
