"use client";

import { useMemo, useState } from "react";
import styles from "./painel-capitalizacao.module.css";

// Quadro "Status de todos os cards" da Capitalização (mesmo desenho do quadro de
// imobiliárias do Seguro Fiança e de Ramos Elementares): uma linha por imobiliária
// (ou por seguradora), com solicitações, tendência contra o mês anterior, em
// andamento, não pagas, fechadas, prêmio e comissão.
export type LinhaStatus = {
  chave: string;
  nome: string;
  solicitacoes: number;
  emAndamento: number;
  naoPagas: number;
  fechadas: number;
  premioSolicitado: number;
  premioFechado: number;
  comissaoFechada: number;
  solicitacoesMesAnterior: number;
  semVinculo?: boolean;
};

type Coluna = "nome" | "solicitacoes" | "tendencia" | "emAndamento" | "naoPagas" | "fechadas" | "premioSolicitado" | "premioFechado" | "comissaoFechada";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normalizar = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function variacao(atual: number, anterior: number): number | null {
  if (atual === anterior) return 0;
  if (anterior === 0) return 100;
  return ((atual - anterior) / anterior) * 100;
}

function valor(l: LinhaStatus, c: Coluna): number | string {
  if (c === "nome") return normalizar(l.nome);
  if (c === "tendencia") return variacao(l.solicitacoes, l.solicitacoesMesAnterior) ?? 0;
  return l[c];
}

function Tendencia({ atual, anterior }: { atual: number; anterior: number }) {
  const v = variacao(atual, anterior);
  const cor = !v ? "var(--ink-faint, #8a97a6)" : v > 0 ? "var(--positive)" : "var(--negative)";
  return (
    <span style={{ color: cor, fontWeight: 700 }} title={`Mês anterior: ${anterior}`}>
      {!v ? "—" : `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`}
    </span>
  );
}

function ComPct({ valor: v, total }: { valor: number; total: number }) {
  return (
    <>
      {v}
      {total > 0 && <small style={{ color: "var(--ink-faint, #8a97a6)" }}> · {((v / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</small>}
    </>
  );
}

export default function StatusCardsTabela({ linhas: todasAsLinhas, rotuloPrimeiraColuna, comBusca }: { linhas: LinhaStatus[]; rotuloPrimeiraColuna: string; comBusca: boolean }) {
  // Linha que só existia no mês anterior (0 solicitações agora) não aparece na lista, mas
  // entra no total do mês anterior da tendência.
  const linhas = useMemo(() => todasAsLinhas.filter((l) => l.solicitacoes > 0), [todasAsLinhas]);
  const [busca, setBusca] = useState("");
  const [expandido, setExpandido] = useState(false);
  const [ordenacao, setOrdenacao] = useState<{ coluna: Coluna; direcao: "asc" | "desc" } | null>(null);
  const LIMITE = 10;

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    return termo ? linhas.filter((l) => normalizar(l.nome).includes(termo)) : linhas;
  }, [linhas, busca]);

  const ordenadas = useMemo(() => {
    if (!ordenacao) return filtradas;
    const { coluna, direcao } = ordenacao;
    return [...filtradas].sort((a, b) => {
      const va = valor(a, coluna);
      const vb = valor(b, coluna);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return direcao === "asc" ? cmp : -cmp;
    });
  }, [filtradas, ordenacao]);

  const visiveis = expandido || busca ? ordenadas : ordenadas.slice(0, LIMITE);
  const restantes = filtradas.length - LIMITE;

  function alternar(coluna: Coluna) {
    setOrdenacao((atual) => {
      if (!atual || atual.coluna !== coluna) return { coluna, direcao: "desc" };
      if (atual.direcao === "desc") return { coluna, direcao: "asc" };
      return null;
    });
  }

  const Th = ({ coluna, titulo, children }: { coluna: Coluna; titulo?: string; children: React.ReactNode }) => (
    <th className={coluna === "nome" ? undefined : styles.numCol} title={titulo} onClick={() => alternar(coluna)} style={{ cursor: "pointer" }}>
      {children}
      {ordenacao?.coluna === coluna && (ordenacao.direcao === "desc" ? " ▼" : " ▲")}
    </th>
  );

  const total = todasAsLinhas.reduce(
    (t, l) => ({
      solicitacoes: t.solicitacoes + l.solicitacoes,
      emAndamento: t.emAndamento + l.emAndamento,
      naoPagas: t.naoPagas + l.naoPagas,
      fechadas: t.fechadas + l.fechadas,
      premioSolicitado: t.premioSolicitado + l.premioSolicitado,
      premioFechado: t.premioFechado + l.premioFechado,
      comissaoFechada: t.comissaoFechada + l.comissaoFechada,
      anterior: t.anterior + l.solicitacoesMesAnterior,
    }),
    { solicitacoes: 0, emAndamento: 0, naoPagas: 0, fechadas: 0, premioSolicitado: 0, premioFechado: 0, comissaoFechada: 0, anterior: 0 }
  );

  return (
    <div>
      {comBusca && (
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar imobiliária..."
          style={{ margin: "0 0 10px", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "transparent", color: "var(--ink)", fontSize: 13, width: "100%", maxWidth: 320 }}
        />
      )}
      <div className={styles.tableWrap}>
        <table className={styles.data}>
          <thead>
            <tr>
              <Th coluna="nome">{rotuloPrimeiraColuna}</Th>
              <Th coluna="solicitacoes" titulo="Cards do recorte do mês (novos + herança)">Solicitações</Th>
              <Th coluna="tendencia" titulo="Tendência — solicitações comparadas ao mês anterior (mesmo recorte)">Tend.</Th>
              <Th coluna="emAndamento" titulo="Cards ainda abertos">Em andamento</Th>
              <Th coluna="naoPagas" titulo="Propostas que não foram pagas no mês (Pagamento não realizado ou Desistência) — quantidade · % sobre as solicitações">Não pagas</Th>
              <Th coluna="fechadas" titulo="Fechadas = títulos com pagamento confirmado no mês — quantidade · % sobre as solicitações">Fechadas</Th>
              <Th coluna="premioSolicitado" titulo="Prêmio (valor do título) de todas as solicitações do recorte">Prêmio solicitado</Th>
              <Th coluna="premioFechado" titulo="Prêmio (valor do título) das fechadas — o card da Capitalização não tem prêmio líquido separado">Prêmio fechado</Th>
              <Th coluna="comissaoFechada" titulo="Comissão gerada pelas fechadas">Comissão gerada</Th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.chave}>
                <td>
                  {l.nome}
                  {l.semVinculo && (
                    <small title="Nome ainda sem vínculo confirmado na base unificada de imobiliárias (Admin › Imobiliárias)" style={{ color: "var(--warning)" }}>
                      {" "}ⓥ
                    </small>
                  )}
                </td>
                <td className={styles.numCol} style={{ fontWeight: 700 }}>{l.solicitacoes}</td>
                <td className={styles.numCol}><Tendencia atual={l.solicitacoes} anterior={l.solicitacoesMesAnterior} /></td>
                <td className={styles.numCol}>{l.emAndamento}</td>
                <td className={styles.numCol}><ComPct valor={l.naoPagas} total={l.solicitacoes} /></td>
                <td className={styles.numCol} style={{ color: "var(--positive)", fontWeight: 600 }}><ComPct valor={l.fechadas} total={l.solicitacoes} /></td>
                <td className={styles.numCol}>{brl(l.premioSolicitado)}</td>
                <td className={styles.numCol}>{brl(l.premioFechado)}</td>
                <td className={styles.numCol}>{brl(l.comissaoFechada)}</td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={9} className={styles.panelSub}>
                  {busca ? "Nada encontrado com esse nome." : "Nenhum card neste recorte — 0"}
                </td>
              </tr>
            )}
            {!busca && (
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                <td className={styles.numCol}>{total.solicitacoes}</td>
                <td className={styles.numCol}><Tendencia atual={total.solicitacoes} anterior={total.anterior} /></td>
                <td className={styles.numCol}>{total.emAndamento}</td>
                <td className={styles.numCol}><ComPct valor={total.naoPagas} total={total.solicitacoes} /></td>
                <td className={styles.numCol}><ComPct valor={total.fechadas} total={total.solicitacoes} /></td>
                <td className={styles.numCol}>{brl(total.premioSolicitado)}</td>
                <td className={styles.numCol}>{brl(total.premioFechado)}</td>
                <td className={styles.numCol}>{brl(total.comissaoFechada)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!busca && restantes > 0 && (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          style={{ marginTop: 8, background: "transparent", border: "1px solid var(--line)", borderRadius: 9999, padding: "3px 12px", fontSize: 12, color: "var(--ink-muted)", cursor: "pointer" }}
        >
          {expandido ? "Mostrar apenas as 10 maiores" : `Mostrar todas (mais ${restantes})`}
        </button>
      )}
    </div>
  );
}
