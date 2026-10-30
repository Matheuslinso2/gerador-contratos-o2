"use client";

import { useState, type ReactNode } from "react";

// Duas abas no painel da Capitalização (pedido do Matheus, 30/10/2026): o painel ficou
// extenso e misturava o que é título novo com o que é reaplicação. Cada aba é um
// conjunto de quadros próprio, montado no servidor e só alternado aqui.
export default function AbasCapitalizacao({
  novos,
  reaplicacao,
  totalNovos,
  totalReaplicacao,
}: {
  novos: ReactNode;
  reaplicacao: ReactNode;
  totalNovos: number;
  totalReaplicacao: number;
}) {
  const [aba, setAba] = useState<"novos" | "reaplicacao">("novos");
  const estilo = (ativa: boolean): React.CSSProperties => ({
    padding: "8px 18px",
    borderRadius: 9999,
    border: "1px solid var(--line, #263241)",
    background: ativa ? "var(--accent, #F8540D)" : "transparent",
    color: ativa ? "#fff" : "var(--ink, #01192e)",
    fontWeight: 600,
    fontSize: 13.5,
    cursor: "pointer",
  });
  return (
    <>
      <div role="tablist" style={{ display: "flex", gap: 8, margin: "0 0 18px", flexWrap: "wrap" }}>
        <button type="button" role="tab" aria-selected={aba === "novos"} style={estilo(aba === "novos")} onClick={() => setAba("novos")}>
          Capitalização nova <span style={{ opacity: 0.8, fontWeight: 500 }}>· {totalNovos} no mês</span>
        </button>
        <button type="button" role="tab" aria-selected={aba === "reaplicacao"} style={estilo(aba === "reaplicacao")} onClick={() => setAba("reaplicacao")}>
          Reaplicação <span style={{ opacity: 0.8, fontWeight: 500 }}>· {totalReaplicacao} no mês</span>
        </button>
      </div>
      <div hidden={aba !== "novos"}>{novos}</div>
      <div hidden={aba !== "reaplicacao"}>{reaplicacao}</div>
    </>
  );
}
