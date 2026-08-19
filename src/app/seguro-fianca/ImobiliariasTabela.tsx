"use client";

import { useMemo, useState } from "react";
import styles from "./seguro-fianca.module.css";

type LinhaImobiliaria = {
  nome: string;
  total: number;
  recusados: number;
  emAndamento: number;
  perdidos: number;
  convertidos: number;
  premioCotado: number;
  comissaoCotada: number;
  premioEfetivado: number;
  comissaoEfetivada: number;
  ticketMedio: number;
  mediaPercentualPacote: number;
};

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPct(v: number): string {
  return v ? `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—";
}

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Tendência vs. mês anterior (pedido da Patricia): sem histórico do mês
// anterior ainda, entra como "alta" (mesma leitura de quem tinha 0 e passou
// a ter cotação) -- é o comportamento esperado enquanto o painel não tem
// mais de um mês de histórico salvo.
function tendencia(atual: number, anterior: number): { pct: number; direcao: "up" | "down" | "flat" } {
  if (atual === anterior) return { pct: 0, direcao: "flat" };
  if (anterior === 0) return { pct: 100, direcao: "up" };
  const variacao = ((atual - anterior) / anterior) * 100;
  return { pct: Math.abs(variacao), direcao: variacao >= 0 ? "up" : "down" };
}

function Tendencia({ atual, anterior }: { atual: number; anterior: number }) {
  const t = tendencia(atual, anterior);
  if (t.direcao === "flat") return <span style={{ color: "var(--ink-faint)" }}>—</span>;
  const seta = t.direcao === "up" ? "▲" : "▼";
  const cor = t.direcao === "up" ? "var(--info)" : "var(--negative)";
  return (
    <span style={{ color: cor, fontWeight: 700 }}>
      {seta} {t.pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  );
}

export default function ImobiliariasTabela({
  imobiliarias,
  totalMesAnteriorPorImobiliaria = {},
}: {
  imobiliarias: LinhaImobiliaria[];
  totalMesAnteriorPorImobiliaria?: Record<string, number>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [busca, setBusca] = useState("");
  const LIMITE = 10;

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return imobiliarias;
    return imobiliarias.filter((i) => normalizar(i.nome).includes(termo));
  }, [imobiliarias, busca]);

  const visiveis = expandido || busca ? filtradas : filtradas.slice(0, LIMITE);
  const restantes = filtradas.length - LIMITE;

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
      <table className={styles.data}>
        <thead>
          <tr>
            <th>Imobiliária</th>
            <th className={styles.numCol}>Cotações</th>
            <th className={styles.numCol} title="Comparado ao total de cotações do mês anterior">
              Tendência
            </th>
            <th className={styles.numCol}>Em Andamento</th>
            <th className={styles.numCol}>Recusados</th>
            <th className={styles.numCol}>Perdidos</th>
            <th className={styles.numCol}>Convertidos</th>
            <th className={styles.numCol} title="Média dos prêmios cotados dentro de cada card, somada entre os cards da imobiliária">
              Prêmio Cotado
            </th>
            <th className={styles.numCol} title="Média das comissões cotadas dentro de cada card, somada entre os cards da imobiliária">
              Comissão Cotada
            </th>
            <th className={styles.numCol} title="Média das cotações de cada card, depois média entre os cards da imobiliária">
              Ticket Médio
            </th>
            <th className={styles.numCol} title="Percentual médio do pacote de locação que vira parcela do seguro, mesma lógica do Ticket Médio">
              % Pacote Médio
            </th>
            <th className={styles.numCol}>Prêmio Efetivado</th>
            <th className={styles.numCol}>Comissão Efetivada</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((i) => (
            <tr key={i.nome}>
              <td>{i.nome}</td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                {i.total}
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>
                <Tendencia atual={i.total} anterior={totalMesAnteriorPorImobiliaria[i.nome] ?? 0} />
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>{i.emAndamento}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{i.recusados}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{i.perdidos}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{i.convertidos}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(i.premioCotado)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(i.comissaoCotada)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(i.ticketMedio)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(i.mediaPercentualPacote)}</td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ color: "var(--negative)" }}>
                {fmtBRL(i.premioEfetivado)}
              </td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ color: "var(--negative)" }}>
                {fmtBRL(i.comissaoEfetivada)}
              </td>
            </tr>
          ))}
          {filtradas.length === 0 && (
            <tr>
              <td colSpan={13} style={{ color: "var(--ink-faint)" }}>
                {busca ? "Nenhuma imobiliária encontrada com esse nome." : "Nenhuma imobiliária com cotação registrada neste período."}
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
