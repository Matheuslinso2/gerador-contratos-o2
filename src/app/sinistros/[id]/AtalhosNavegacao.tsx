"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Setas ← → andam para o caso anterior/próximo da lista da Gestão (mesmos
// filtros e ordem). Não interfere quando o cursor está num campo.
export default function AtalhosNavegacao({ anterior, proximo }: { anterior: string | null; proximo: string | null }) {
  const router = useRouter();
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft" && anterior) router.push(anterior);
      if (e.key === "ArrowRight" && proximo) router.push(proximo);
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [anterior, proximo, router]);
  return null;
}
