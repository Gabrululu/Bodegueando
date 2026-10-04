"use client";

import { initials, logoUrl, type BodegaProfile } from "@/lib/bodega/profile";

const SIZES = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-xl" } as const;

/** Logo de la bodega, o sus iniciales sobre verde lima si todavía no subió uno. */
export function BodegaAvatar({
  address,
  profile,
  size = "md",
  previewUrl,
}: {
  address: string;
  profile: BodegaProfile | null | undefined;
  size?: keyof typeof SIZES;
  /** Para la vista previa del formulario, antes de guardar. */
  previewUrl?: string | null;
}) {
  const src = previewUrl === undefined ? logoUrl(address, profile) : previewUrl;
  const box = `${SIZES[size]} shrink-0 overflow-hidden rounded-xl`;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- logo servido por nuestra API o data URL de la vista previa
    return <img src={src} alt="" className={`${box} border border-black/10 bg-white object-cover`} />;
  }
  return (
    <span aria-hidden className={`${box} flex items-center justify-center bg-[#c9e265] font-bold text-[#0a0a0b] [font-family:var(--font-bricolage)]`}>
      {profile?.name ? initials(profile.name) : "B"}
    </span>
  );
}
