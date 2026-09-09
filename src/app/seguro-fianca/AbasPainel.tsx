"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import styles from "./seguro-fianca.module.css";

// Abas reais (como navegador/planilha), não só seções de uma página longa
// -- pedido do Matheus, 09/09/2026. O conteúdo de cada aba continua vindo
// pronto do servidor (busca de dados no Bitrix não muda); esse componente só
// decide qual bloco já renderizado mostrar. Todo conteúdo é enviado ao
// cliente de qualquer forma (React só esconde o resto com `hidden`) -- não é
// carregamento sob demanda, é só organização visual.
const AbaContext = createContext<{ ativa: string; setAtiva: (id: string) => void } | null>(null);

export type DefinicaoAba = { id: string; label: string };

export function AbasProvider({ abas, children }: { abas: DefinicaoAba[]; children: ReactNode }) {
  const [ativa, setAtiva] = useState(abas[0]?.id ?? "");
  return (
    <AbaContext.Provider value={{ ativa, setAtiva }}>
      <div className={styles.tabBar} role="tablist">
        {abas.map((aba) => (
          <button
            key={aba.id}
            type="button"
            role="tab"
            aria-selected={ativa === aba.id}
            onClick={() => setAtiva(aba.id)}
            className={`${styles.tab} ${ativa === aba.id ? styles.tabAtiva : ""}`}
          >
            {aba.label}
          </button>
        ))}
      </div>
      {children}
    </AbaContext.Provider>
  );
}

// Cada quadro do painel (renderizado no servidor) é embrulhado num AbaSlot
// pra dizer a qual aba ele pertence -- fica escondido (não removido do DOM)
// quando a aba não está ativa.
export function AbaSlot({ aba, children }: { aba: string; children: ReactNode }) {
  const ctx = useContext(AbaContext);
  if (!ctx) return <>{children}</>;
  return <div hidden={ctx.ativa !== aba}>{children}</div>;
}
