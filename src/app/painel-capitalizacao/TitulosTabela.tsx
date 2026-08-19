"use client";

import { useMemo, useState } from "react";
import styles from "./painel-capitalizacao.module.css";

type Titulo = {
  id: number;
  titular: string;
  imobiliaria: string;
  etapaNome: string;
  valorTitulo: number;
  comissao: number;
};

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Filtro por imobiliária (pedido da Patricia) -- mesmo padrão de busca já
// usado na tabela de imobiliárias do painel de Seguro Fiança.
export default function TitulosTabela({ titulos }: { titulos: Titulo[] }) {
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return titulos;
    return titulos.filter((t) => normalizar(t.imobiliaria).includes(termo));
  }, [titulos, busca]);

  return (
    <div className={styles.tableWrap}>
      <input
        type="text"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Filtrar por imobiliária..."
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
            <th>Titular</th>
            <th>Imobiliária</th>
            <th>Status</th>
            <th className={styles.numCol}>Prêmio</th>
            <th className={styles.numCol}>Comissão</th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map((t) => (
            <tr key={t.id}>
              <td>{t.titular}</td>
              <td>{t.imobiliaria}</td>
              <td>{t.etapaNome}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(t.valorTitulo)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(t.comissao)}</td>
            </tr>
          ))}
          {filtrados.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "var(--ink-faint)" }}>
                {busca ? "Nenhum título encontrado com essa imobiliária." : "Nenhum título encontrado."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
