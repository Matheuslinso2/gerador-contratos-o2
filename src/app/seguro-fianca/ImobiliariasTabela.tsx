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

export default function ImobiliariasTabela({ imobiliarias }: { imobiliarias: LinhaImobiliaria[] }) {
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
            <th className={styles.numCol}>Em Andamento</th>
            <th className={styles.numCol}>Recusados</th>
            <th className={styles.numCol}>Perdidos</th>
            <th className={styles.numCol}>Convertidos</th>
            <th className={styles.numCol}>Prêmio Cotado</th>
            <th className={styles.numCol}>Comissão Cotada</th>
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
              <td colSpan={12} style={{ color: "var(--ink-faint)" }}>
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
