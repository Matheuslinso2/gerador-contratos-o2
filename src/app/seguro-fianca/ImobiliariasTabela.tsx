"use client";

import { useState } from "react";
import styles from "./seguro-fianca.module.css";

type LinhaImobiliaria = {
  nome: string;
  total: number;
  recusados: number;
  emAndamento: number;
  perdidos: number;
  convertidos: number;
};

export default function ImobiliariasTabela({ imobiliarias }: { imobiliarias: LinhaImobiliaria[] }) {
  const [expandido, setExpandido] = useState(false);
  const LIMITE = 10;
  const visiveis = expandido ? imobiliarias : imobiliarias.slice(0, LIMITE);
  const restantes = imobiliarias.length - LIMITE;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.data}>
        <thead>
          <tr>
            <th>Imobiliária</th>
            <th className={styles.numCol}>Cotações</th>
            <th className={styles.numCol}>Em Andamento</th>
            <th className={styles.numCol}>Recusados</th>
            <th className={styles.numCol}>Perdidos</th>
            <th className={styles.numCol}>Convertidos</th>
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
            </tr>
          ))}
          {imobiliarias.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "var(--ink-faint)" }}>
                Nenhuma imobiliária com cotação registrada neste período.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {restantes > 0 && (
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
