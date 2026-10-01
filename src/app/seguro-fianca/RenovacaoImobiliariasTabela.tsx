"use client";

import { useMemo, useState } from "react";
import styles from "./seguro-fianca.module.css";
import type { PainelRenovacao } from "@/lib/bitrix/renovacaoFianca";
import {
  BadgeClasse,
  ContagemComPct,
  Tendencia,
  Th,
  normalizar,
  posicaoHierarquia,
  tendencia,
  type ClassificacaoImobiliaria,
} from "./ImobiliariasTabela";

// Quadro "status de todos os cards" da aba Renovação -- mesmo modelo do
// quadro de status da aba Imobiliária (busca, ordenação por coluna, 10
// primeiras + "mostrar todas", `12 · 30%` na mesma célula), só com o funil
// de Renovação (Matheus, 01/10/2026). Diferenças por não existirem no funil:
// sem "Recusados" (renovação não tem recusa) e sem "Parcela Méd."; entra
// "Reajuste Méd.". As classes são as da imobiliária no Fiança (estudo da
// Patricia) -- a Renovação não tem classificação própria.

type Linha = PainelRenovacao["imobiliarias"][number];
type Coluna =
  | "nome"
  | "total"
  | "classeCotacao"
  | "tendencia"
  | "emAndamento"
  | "perdidos"
  | "renovados"
  | "classeContratacao"
  | "premioMedio"
  | "comissaoMedia"
  | "reajusteMedio"
  | "taxaPacoteMedia"
  | "premioRenovado"
  | "comissaoRenovada";

function fmtBRL(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function valorOrdenacao(
  i: Linha,
  coluna: Coluna,
  totalMesAnterior: Record<string, number>,
  classificacao: Record<string, ClassificacaoImobiliaria>
): number | string {
  if (coluna === "nome") return normalizar(i.nome);
  if (coluna === "tendencia") {
    const t = tendencia(i.total, totalMesAnterior[i.nome] ?? 0);
    if (t.direcao === "flat") return 0;
    return t.direcao === "up" ? t.pct : -t.pct;
  }
  if (coluna === "classeCotacao") return posicaoHierarquia(classificacao[i.nome]?.cotacoes ?? null);
  if (coluna === "classeContratacao") return posicaoHierarquia(classificacao[i.nome]?.contratacoes ?? null);
  // Sem valor (null/retrato antigo) ordena como o menor possível.
  return i[coluna] ?? -Infinity;
}

export default function RenovacaoImobiliariasTabela({
  imobiliarias,
  totalMesAnteriorPorImobiliaria = {},
  classificacaoPorImobiliaria = {},
}: {
  imobiliarias: Linha[];
  totalMesAnteriorPorImobiliaria?: Record<string, number>;
  classificacaoPorImobiliaria?: Record<string, ClassificacaoImobiliaria>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<{ coluna: Coluna; direcao: "asc" | "desc" } | null>(null);
  const LIMITE = 10;

  function alternarOrdenacao(coluna: Coluna) {
    setOrdenacao((atual) => {
      if (!atual || atual.coluna !== coluna) return { coluna, direcao: "desc" };
      if (atual.direcao === "desc") return { coluna, direcao: "asc" };
      return null;
    });
  }

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return imobiliarias;
    return imobiliarias.filter((i) => normalizar(i.nome).includes(termo));
  }, [imobiliarias, busca]);

  const ordenadas = useMemo(() => {
    if (!ordenacao) return filtradas;
    const { coluna, direcao } = ordenacao;
    const copia = [...filtradas];
    copia.sort((a, b) => {
      const va = valorOrdenacao(a, coluna, totalMesAnteriorPorImobiliaria, classificacaoPorImobiliaria);
      const vb = valorOrdenacao(b, coluna, totalMesAnteriorPorImobiliaria, classificacaoPorImobiliaria);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return direcao === "asc" ? cmp : -cmp;
    });
    return copia;
  }, [filtradas, ordenacao, totalMesAnteriorPorImobiliaria, classificacaoPorImobiliaria]);

  const visiveis = expandido || busca ? ordenadas : ordenadas.slice(0, LIMITE);
  const restantes = filtradas.length - LIMITE;
  const th = { ordenacao, onClick: alternarOrdenacao };

  return (
    <div className={styles.tableWrap}>
      <input
        type="text"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar imobiliária..."
        style={{
          marginBottom: 10,
          width: "100%",
          maxWidth: 320,
          border: "1px solid var(--line)",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 13,
        }}
      />
      <table className={`${styles.data} ${styles.compacta}`}>
        <thead>
          <tr>
            <Th coluna="nome" {...th}>Imobiliária</Th>
            <Th coluna="total" {...th} numerica title="Cards de renovação do mês (novos + herdados)">
              Renovações
            </Th>
            <Th coluna="classeCotacao" {...th} title="Classificação operacional em Cotações da imobiliária no Fiança — estudo da Patricia, atualiza a cada 2 meses">
              Classe Cotação
            </Th>
            <Th coluna="tendencia" {...th} numerica title="Tendência — comparado ao total de renovações do mês anterior">
              Tend.
            </Th>
            <Th coluna="emAndamento" {...th} numerica title="Em Andamento">
              Andamento
            </Th>
            <Th coluna="perdidos" {...th} numerica title="Perdidos — quantidade · % sobre as renovações da imobiliária no mês">
              Perd.
            </Th>
            <Th coluna="renovados" {...th} numerica title="Renovados — quantidade · % sobre as renovações da imobiliária no mês">
              Renov.
            </Th>
            <Th coluna="classeContratacao" {...th} title="Classificação operacional em Contratações da imobiliária no Fiança — estudo da Patricia, atualiza a cada 2 meses">
              Classe Contratação
            </Th>
            <Th coluna="premioMedio" {...th} numerica title="Prêmio líquido médio dos cards de renovação da imobiliária no mês">
              Prêmio Méd.
            </Th>
            <Th coluna="comissaoMedia" {...th} numerica title="Comissão média (prêmio líquido × % comissão) dos cards da imobiliária no mês">
              Com. Méd.
            </Th>
            <Th coluna="reajusteMedio" {...th} numerica title="Reajuste médio (%) informado nos cards da imobiliária no mês">
              Reajuste Méd.
            </Th>
            <Th coluna="taxaPacoteMedia" {...th} numerica title="Taxa do pacote de locação (%) média da renovação">
              % Pacote
            </Th>
            <Th coluna="premioRenovado" {...th} numerica title="Prêmio líquido dos cards renovados no mês">
              Prêmio Renov.
            </Th>
            <Th coluna="comissaoRenovada" {...th} numerica title="Comissão dos cards renovados no mês">
              Com. Renov.
            </Th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((i) => (
            <tr key={i.nome}>
              <td>{i.nome}</td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                {i.total}
              </td>
              <td className={styles.numCol}>
                <BadgeClasse classe={classificacaoPorImobiliaria[i.nome]?.cotacoes ?? null} />
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>
                <Tendencia atual={i.total} anterior={totalMesAnteriorPorImobiliaria[i.nome] ?? 0} />
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>{i.emAndamento}</td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ whiteSpace: "nowrap" }}>
                <ContagemComPct valor={i.perdidos} total={i.total} />
              </td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ whiteSpace: "nowrap" }}>
                <ContagemComPct valor={i.renovados} total={i.total} />
              </td>
              <td className={styles.numCol}>
                <BadgeClasse classe={classificacaoPorImobiliaria[i.nome]?.contratacoes ?? null} />
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(i.premioMedio)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(i.comissaoMedia)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(i.reajusteMedio)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(i.taxaPacoteMedia)}</td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ color: "var(--negative)" }}>
                {fmtBRL(i.premioRenovado)}
              </td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ color: "var(--negative)" }}>
                {fmtBRL(i.comissaoRenovada)}
              </td>
            </tr>
          ))}
          {filtradas.length === 0 && (
            <tr>
              <td colSpan={14} style={{ color: "var(--ink-faint)" }}>
                {busca ? "Nenhuma imobiliária encontrada com esse nome." : "Nenhum card de renovação neste período."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!busca && restantes > 0 && (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          style={{
            marginTop: 12,
            background: "none",
            border: "1px solid var(--line)",
            color: "var(--accent-ink)",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          {expandido ? "Mostrar só as 10 maiores" : `Mostrar todas (mais ${restantes})`}
        </button>
      )}
    </div>
  );
}
