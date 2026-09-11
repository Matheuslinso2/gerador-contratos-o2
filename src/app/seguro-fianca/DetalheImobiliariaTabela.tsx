"use client";

import { useMemo, useState } from "react";
import styles from "./seguro-fianca.module.css";

type LinhaDetalhe = {
  nome: string;
  total: number;
  recusados: number;
  perdidos: number;
  convertidos: number;
  emAndamento: number;
};

function fmtPct(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export default function DetalheImobiliariaTabela({ linhas }: { linhas: LinhaDetalhe[] }) {
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return linhas;
    return linhas.filter((im) => normalizar(im.nome).includes(termo));
  }, [linhas, busca]);

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
            <th>Imobiliária</th>
            <th className={styles.numCol}>Cotações</th>
            <th className={styles.numCol}>Recusados</th>
            <th className={styles.numCol}>% Recus.</th>
            <th className={styles.numCol}>Negativados</th>
            <th className={styles.numCol}>% Neg.</th>
            <th className={styles.numCol}>Contratados</th>
            <th className={styles.numCol}>% Contr.</th>
            <th className={styles.numCol}>Andamento</th>
          </tr>
        </thead>
        <tbody>
          {filtradas.map((im) => (
            <tr key={im.nome}>
              <td>{im.nome}</td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                {im.total}
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>{im.recusados}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtPct((im.recusados / im.total) * 100)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{im.perdidos}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtPct((im.perdidos / im.total) * 100)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{im.convertidos}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtPct((im.convertidos / im.total) * 100)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{im.emAndamento}</td>
            </tr>
          ))}
          {filtradas.length === 0 && (
            <tr>
              <td colSpan={9} style={{ color: "var(--ink-faint)" }}>
                {busca ? "Nenhuma imobiliária encontrada com esse nome." : "Nenhuma cotação registrada neste período."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
