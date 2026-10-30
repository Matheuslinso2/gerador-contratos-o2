"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Conta telas (troca de página) e cliques da pessoa e envia em lote a cada
// 30 s e ao sair da aba (reunião Kamila 29/10/2026). Não guarda nada além dos
// dois números; ver /api/uso e /admin/acessos.
export default function UsoTracker() {
  const pathname = usePathname();
  const telas = useRef(0);
  const cliques = useRef(0);

  useEffect(() => {
    telas.current += 1;
  }, [pathname]);

  useEffect(() => {
    function enviar() {
      if (!telas.current && !cliques.current) return;
      const corpo = JSON.stringify({ telas: telas.current, cliques: cliques.current });
      telas.current = 0;
      cliques.current = 0;
      try {
        navigator.sendBeacon("/api/uso", new Blob([corpo], { type: "application/json" }));
      } catch {
        /* sem registro de uso: não atrapalha a tela */
      }
    }
    const aoClicar = () => {
      cliques.current += 1;
    };
    const aoEsconder = () => {
      if (document.visibilityState === "hidden") enviar();
    };
    document.addEventListener("click", aoClicar, true);
    document.addEventListener("visibilitychange", aoEsconder);
    window.addEventListener("pagehide", enviar);
    const timer = window.setInterval(enviar, 30_000);
    return () => {
      document.removeEventListener("click", aoClicar, true);
      document.removeEventListener("visibilitychange", aoEsconder);
      window.removeEventListener("pagehide", enviar);
      window.clearInterval(timer);
      enviar();
    };
  }, []);

  return null;
}
