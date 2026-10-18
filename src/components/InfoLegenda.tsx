"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// Ícone ⓘ que explica a lógica de um quadro/indicador (pedido da Patricia na
// reunião de 15/10/2026: legenda nos painéis, descrevendo como as
// classificações e os números são calculados). Abre ao clicar ou ao passar o
// mouse/focar -- o `title` nativo do navegador não aparece no celular e some
// rápido demais pra um texto de várias linhas. O clique só abre (o mouse já
// abriu ao chegar); fecha ao sair, ao clicar fora ou com Esc.
//
// `data-export-ignore` tira o ícone do PNG/PDF exportado (ver ExportarQuadro).
export default function InfoLegenda({
  titulo,
  children,
  alinhar = "esquerda",
}: {
  titulo?: string;
  children: ReactNode;
  // Lado em que o balão abre: "direita" abre pra esquerda do ícone (ícones
  // perto da borda direita da tela).
  alinhar?: "esquerda" | "direita";
}) {
  const [aberto, setAberto] = useState(false);
  const [viraPraEsquerda, setViraPraEsquerda] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  const idBalao = useId();

  // Ícone perto da borda direita da tela (ex.: último KPI de uma linha):
  // abre o balão pra esquerda em vez de cortar.
  function abrir() {
    if (raiz.current) {
      const { left } = raiz.current.getBoundingClientRect();
      setViraPraEsquerda(left + 300 > window.innerWidth - 12);
    }
    setAberto(true);
  }

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent | TouchEvent) {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("touchstart", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("touchstart", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <span
      ref={raiz}
      data-export-ignore="true"
      style={{ position: "relative", display: "inline-block", marginLeft: 6, verticalAlign: "middle", textTransform: "none", letterSpacing: "normal", fontWeight: 400 }}
      onMouseEnter={abrir}
      onMouseLeave={() => setAberto(false)}
    >
      <button
        type="button"
        aria-label={titulo ? `Como é calculado: ${titulo}` : "Como é calculado"}
        aria-expanded={aberto}
        aria-controls={idBalao}
        onClick={abrir}
        onFocus={abrir}
        onBlur={() => setAberto(false)}
        style={{
          width: 16,
          height: 16,
          padding: 0,
          borderRadius: "50%",
          border: "1px solid #8a97a6",
          background: aberto ? "#01192e" : "#ffffff",
          color: aberto ? "#ffffff" : "#5b6b7c",
          fontSize: 10.5,
          fontWeight: 700,
          fontStyle: "italic",
          fontFamily: "Georgia, 'Times New Roman', serif",
          lineHeight: "14px",
          cursor: "help",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        i
      </button>
      {aberto && (
        <span
          id={idBalao}
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            [alinhar === "direita" || viraPraEsquerda ? "right" : "left"]: -6,
            zIndex: 50,
            width: 300,
            maxWidth: "80vw",
            padding: "10px 12px",
            borderRadius: 10,
            background: "#01192e",
            color: "#ffffff",
            boxShadow: "0 8px 24px rgba(1, 25, 46, 0.25)",
            fontSize: 12,
            lineHeight: 1.5,
            textAlign: "left",
            whiteSpace: "normal",
          }}
        >
          {titulo && <strong style={{ display: "block", marginBottom: 4, fontSize: 12.5 }}>{titulo}</strong>}
          {children}
        </span>
      )}
    </span>
  );
}
