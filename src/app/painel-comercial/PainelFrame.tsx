"use client";

import { useEffect, useRef, useState } from "react";

// Moldura do Painel Comercial v5: o painel roda isolado num iframe do mesmo
// domínio (CSS próprio) e avisa a altura do conteúdo para a moldura crescer
// junto, sem barra de rolagem dupla.
export default function PainelFrame() {
  const ref = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(900);

  useEffect(() => {
    const ouvir = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow) return;
      const d = e.data as { tipo?: string; altura?: number } | null;
      if (d?.tipo === "painel-comercial-altura" && typeof d.altura === "number" && d.altura > 200) setAltura(Math.ceil(d.altura) + 8);
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, []);

  return (
    <iframe
      ref={ref}
      src="/painel-comercial/app"
      title="Painel comercial"
      style={{ width: "100%", height: altura, border: 0, display: "block" }}
    />
  );
}
