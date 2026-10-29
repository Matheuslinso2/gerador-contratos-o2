"use client";

import { useMemo, useState } from "react";
import type { ItemAgrupado } from "@/lib/ramos-elementares/analise";
import type { ImobiliariaUnificada } from "@/lib/ramos-elementares/imobiliariasUnificadas";
import styles from "./ramos-elementares.module.css";

// Quadro "status de todos os cards" por imobiliária, inspirado no da aba
// Imobiliária do /seguro-fianca (reunião Kamila/Matheus 22/10/2026):
// ranking de todas as imobiliárias em produção no setor, ordenável, com
// tendência contra o mês anterior e os itens (endereços) cotados e
// contratados -- lote = 1 card com vários itens. Substitui a lista simples
// Total/Efetivados/Conversão. No RE não existe recusa × negativação como no
// Fiança: o funil só tem "Encerrado sem emissão".

type Coluna =
  | "nome"
  | "total"
  | "tendencia"
  | "emAndamento"
  | "encerrados"
  | "efetivados"
  | "itensCotados"
  | "itensContratados"
  | "premioCotado"
  | "premioEfetivado"
  | "comissaoEfetivada";

function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function variacao(atual: number, anterior: number): number | null {
  if (atual === anterior) return 0;
  if (anterior === 0) return 100;
  return ((atual - anterior) / anterior) * 100;
}

function valor(i: ItemAgrupado, coluna: Coluna, anterior: Record<string, number> | null): number | string {
  if (coluna === "nome") return normalizar(i.nome);
  if (coluna === "tendencia") return anterior ? (variacao(i.total, anterior[i.nome] ?? 0) ?? 0) : 0;
  return i[coluna] ?? 0;
}

function ComPct({ valor, total }: { valor: number; total: number }) {
  return (
    <>
      {valor}
      {total > 0 && (
        <small className={styles.pctCelula}>
          {" · "}
          {((valor / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
        </small>
      )}
    </>
  );
}

function Tendencia({ atual, anterior }: { atual: number; anterior: number }) {
  const v = variacao(atual, anterior);
  if (!v) return <span className={styles.tendenciaNeutra} title={`Mês anterior: ${anterior}`}>—</span>;
  const subiu = v > 0;
  return (
    <span className={subiu ? styles.tendenciaAlta : styles.tendenciaBaixa} title={`Mês anterior: ${anterior}`}>
      {subiu ? "▲" : "▼"} {Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  );
}

type Ordenacao = { coluna: Coluna; direcao: "asc" | "desc" } | null;

function Th({
  coluna,
  titulo,
  ordenacao,
  onOrdenar,
  children,
}: {
  coluna: Coluna;
  titulo?: string;
  ordenacao: Ordenacao;
  onOrdenar: (coluna: Coluna) => void;
  children: React.ReactNode;
}) {
  const ativo = ordenacao?.coluna === coluna;
  return (
    <th className={coluna === "nome" ? undefined : styles.numCol} title={titulo} onClick={() => onOrdenar(coluna)}>
      <span className={ativo ? styles.ordenacaoAtiva : undefined}>
        {children}
        {ativo && (ordenacao!.direcao === "desc" ? " ▼" : " ▲")}
      </span>
    </th>
  );
}

export default function ImobiliariasRamosTabela({
  imobiliarias,
  totalMesAnterior,
}: {
  imobiliarias: ImobiliariaUnificada[];
  // Cards por imobiliária no mês anterior (mesmo recorte); null = sem retrato.
  totalMesAnterior: Record<string, number> | null;
}) {
  const [expandido, setExpandido] = useState(false);
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(null);
  const LIMITE = 10;
  const temItens = imobiliarias.some((i) => i.itensCotados !== undefined);

  function alternar(coluna: Coluna) {
    setOrdenacao((atual) => {
      if (!atual || atual.coluna !== coluna) return { coluna, direcao: "desc" };
      if (atual.direcao === "desc") return { coluna, direcao: "asc" };
      return null;
    });
  }

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    return termo ? imobiliarias.filter((i) => normalizar(i.nome).includes(termo)) : imobiliarias;
  }, [imobiliarias, busca]);

  const ordenadas = useMemo(() => {
    if (!ordenacao) return filtradas;
    const { coluna, direcao } = ordenacao;
    return [...filtradas].sort((a, b) => {
      const va = valor(a, coluna, totalMesAnterior);
      const vb = valor(b, coluna, totalMesAnterior);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return direcao === "asc" ? cmp : -cmp;
    });
  }, [filtradas, ordenacao, totalMesAnterior]);

  const visiveis = expandido || busca ? ordenadas : ordenadas.slice(0, LIMITE);
  const restantes = filtradas.length - LIMITE;


  return (
    <div>
      <input
        type="text"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar imobiliária..."
        className={styles.buscaTabela}
      />
      <div className={styles.tabelaRolagem}>
        <table className={styles.tabelaImobs}>
          <thead>
            <tr>
              <th className={styles.numCol}>#</th>
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="nome">Imobiliária</Th>
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="total" titulo="Cards (negociações) da imobiliária no recorte selecionado">Cards</Th>
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="tendencia" titulo="Tendência — cards comparados ao mês anterior (mesmo recorte)">Tend.</Th>
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="emAndamento" titulo="Cards ainda abertos">Em andamento</Th>
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="encerrados" titulo="Encerrados sem emissão — quantidade · % sobre os cards da imobiliária">Encerrados</Th>
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="efetivados" titulo="Efetivados — quantidade · % sobre os cards da imobiliária (conversão)">Efetivados</Th>
              {temItens && (
                <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="itensCotados" titulo="Itens cotados — soma de &quot;Quantidade de endereços&quot; dos cards (individual = 1, lote = nº de itens)">Itens cot.</Th>
              )}
              {temItens && (
                <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="itensContratados" titulo="Itens contratados — soma de &quot;Endereços contratados&quot; dos cards efetivados. ⚠ = efetivados sem o campo preenchido (ficam de fora da soma)">Itens contr.</Th>
              )}
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="premioCotado" titulo="Prêmio total cotado — soma do prêmio total de todos os cards da imobiliária no recorte (efetivados ou não)">Prêmio cotado</Th>
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="premioEfetivado" titulo="Prêmio total dos cards efetivados">Prêmio efet.</Th>
              <Th ordenacao={ordenacao} onOrdenar={alternar} coluna="comissaoEfetivada" titulo="Comissão estimada dos cards efetivados">Comissão efet.</Th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((i, posicao) => (
              <tr key={i.nome}>
                <td className={`${styles.numCol} ${styles.posicao}`}>{ordenacao ? "" : posicao + 1}</td>
                <td className={styles.nomeImob}>
                  {i.nome}
                  {i.semVinculo && (
                    <small className={styles.avisoCelula} title="Nome ainda sem vínculo confirmado na base unificada de imobiliárias (Admin › Imobiliárias)">
                      {" "}ⓥ
                    </small>
                  )}
                </td>
                <td className={styles.numCol} style={{ fontWeight: 700 }}>{i.total}</td>
                <td className={styles.numCol}>
                  {totalMesAnterior ? <Tendencia atual={i.total} anterior={totalMesAnterior[i.nome] ?? 0} /> : "—"}
                </td>
                <td className={styles.numCol}>{i.emAndamento ?? "—"}</td>
                <td className={styles.numCol}>
                  {i.encerrados === undefined ? "—" : <ComPct valor={i.encerrados} total={i.total} />}
                </td>
                <td className={`${styles.numCol} ${styles.ok}`}>
                  <ComPct valor={i.efetivados} total={i.total} />
                </td>
                {temItens && <td className={styles.numCol}>{i.itensCotados ?? "—"}</td>}
                {temItens && (
                  <td className={styles.numCol}>
                    {i.itensContratados ?? "—"}
                    {!!i.efetivadosSemItensContratados && (
                      <small
                        className={styles.avisoCelula}
                        title={`${i.efetivadosSemItensContratados} card(s) efetivado(s) sem "Endereços contratados" — ver Alertas`}
                      >
                        {" "}⚠{i.efetivadosSemItensContratados}
                      </small>
                    )}
                  </td>
                )}
                <td className={styles.numCol}>{i.premioCotado === undefined ? "—" : brl(i.premioCotado)}</td>
                <td className={styles.numCol}>{i.premioEfetivado === undefined ? "—" : brl(i.premioEfetivado)}</td>
                <td className={styles.numCol}>{brl(i.comissaoEfetivada)}</td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={12} className={styles.zeroState}>
                  {busca ? "Nenhuma imobiliária encontrada com esse nome." : "Nenhuma imobiliária neste recorte — 0"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!busca && restantes > 0 && (
        <button type="button" className={styles.expandir} onClick={() => setExpandido((v) => !v)}>
          {expandido ? "Mostrar apenas as 10 maiores" : `Mostrar todas (mais ${restantes})`}
        </button>
      )}
    </div>
  );
}
