"use client";

import { useMemo, useState } from "react";
import styles from "./seguro-fianca.module.css";
import { ORDEM_HIERARQUIA, type ClasseImobiliaria } from "@/lib/bitrix/classificacaoImobiliarias";

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

type ClassificacaoImobiliaria = { cotacoes: ClasseImobiliaria | null; contratacoes: ClasseImobiliaria | null };

// Cores por classe operacional (estudo da Patricia, 16/09/2026) -- segue a
// equivalência comercial que ela usou (platina/diamante/ouro/prata/cobre/
// latão), não são cores decorativas soltas.
const COR_CLASSE: Record<string, { bg: string; ink: string }> = {
  "Pilar Central": { bg: "#E7EAF3", ink: "#3E4A66" }, // platina
  Consolidado: { bg: "#E1EBFC", ink: "#2F6FED" }, // diamante
  Expansão: { bg: "#FBF0DA", ink: "#9A6B08" }, // ouro
  "Fiel da Balança": { bg: "#EEF0F2", ink: "#6B7280" }, // prata
  Avulso: { bg: "#F6E7DA", ink: "#A15A22" }, // cobre
  "Fora de Linha": { bg: "#F1EEE3", ink: "#8C7A3E" }, // latão
};

function BadgeClasse({ classe }: { classe: ClasseImobiliaria | null }) {
  if (!classe) return <span style={{ color: "var(--ink-faint)" }}>—</span>;
  const cor = COR_CLASSE[classe.classe] ?? { bg: "#EEEEEE", ink: "#555555" };
  return (
    <span
      title={`Volume no par de meses: ${classe.volume}`}
      style={{
        display: "inline-block",
        whiteSpace: "nowrap",
        borderRadius: 999,
        padding: "2px 9px",
        fontSize: 11.5,
        fontWeight: 600,
        background: cor.bg,
        color: cor.ink,
      }}
    >
      {classe.classe}
    </span>
  );
}

// Posição na hierarquia pra ordenar por classe (maior classe primeiro);
// quem não tem classe nenhuma (nunca teve atividade) fica sempre por último.
function posicaoHierarquia(classe: ClasseImobiliaria | null): number {
  if (!classe) return ORDEM_HIERARQUIA.length;
  const indice = ORDEM_HIERARQUIA.indexOf(classe.classe);
  return indice === -1 ? ORDEM_HIERARQUIA.length : indice;
}

// "tendencia" e as 2 colunas de classificação não são campos salvos em
// LinhaImobiliaria (são calculados/vêm de outra fonte à parte), por isso
// entram como colunas ordenáveis à parte, não chaves do tipo acima.
type ColunaOrdenavel = keyof LinhaImobiliaria | "tendencia" | "classeCotacao" | "classeContratacao";

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

// Valor numérico/comparável de cada coluna, usado só pra ordenar -- nome
// ordena por texto normalizado, tendência vira um número com sinal (alta
// positiva, baixa negativa), o resto usa o próprio campo numérico.
function valorOrdenacao(
  i: LinhaImobiliaria,
  coluna: ColunaOrdenavel,
  totalMesAnteriorPorImobiliaria: Record<string, number>,
  classificacaoPorImobiliaria: Record<string, ClassificacaoImobiliaria>
): number | string {
  if (coluna === "nome") return normalizar(i.nome);
  if (coluna === "tendencia") {
    const t = tendencia(i.total, totalMesAnteriorPorImobiliaria[i.nome] ?? 0);
    if (t.direcao === "flat") return 0;
    return t.direcao === "up" ? t.pct : -t.pct;
  }
  if (coluna === "classeCotacao") return posicaoHierarquia(classificacaoPorImobiliaria[i.nome]?.cotacoes ?? null);
  if (coluna === "classeContratacao") return posicaoHierarquia(classificacaoPorImobiliaria[i.nome]?.contratacoes ?? null);
  return i[coluna];
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

function Th({
  coluna,
  ordenacao,
  onClick,
  numerica,
  title,
  children,
}: {
  coluna: ColunaOrdenavel;
  ordenacao: { coluna: ColunaOrdenavel; direcao: "asc" | "desc" } | null;
  onClick: (coluna: ColunaOrdenavel) => void;
  numerica?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const ativo = ordenacao?.coluna === coluna;
  return (
    <th
      className={numerica ? styles.numCol : undefined}
      title={title}
      onClick={() => onClick(coluna)}
    >
      <span className={ativo ? styles.ordenacaoAtiva : undefined}>
        {children}
        {ativo && (ordenacao!.direcao === "desc" ? " ▼" : " ▲")}
      </span>
    </th>
  );
}

export default function ImobiliariasTabela({
  imobiliarias,
  totalMesAnteriorPorImobiliaria = {},
  classificacaoPorImobiliaria = {},
}: {
  imobiliarias: LinhaImobiliaria[];
  totalMesAnteriorPorImobiliaria?: Record<string, number>;
  classificacaoPorImobiliaria?: Record<string, ClassificacaoImobiliaria>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [busca, setBusca] = useState("");
  // null = ordem padrão (como veio do servidor, por volume de cotações).
  // 1º clique num cabeçalho ordena decrescente, 2º clique inverte pra
  // crescente, 3º clique volta pro padrão.
  const [ordenacao, setOrdenacao] = useState<{ coluna: ColunaOrdenavel; direcao: "asc" | "desc" } | null>(null);
  const LIMITE = 10;

  function alternarOrdenacao(coluna: ColunaOrdenavel) {
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
            <Th coluna="nome" ordenacao={ordenacao} onClick={alternarOrdenacao}>
              Imobiliária
            </Th>
            <Th coluna="total" ordenacao={ordenacao} onClick={alternarOrdenacao} numerica>
              Cotações
            </Th>
            <Th
              coluna="classeCotacao"
              ordenacao={ordenacao}
              onClick={alternarOrdenacao}
              title="Classificação operacional em Cotações — estudo da Patricia, atualiza a cada 2 meses"
            >
              Classe Cotação
            </Th>
            <Th
              coluna="tendencia"
              ordenacao={ordenacao}
              onClick={alternarOrdenacao}
              numerica
              title="Tendência — comparado ao total de cotações do mês anterior"
            >
              Tend.
            </Th>
            <Th coluna="emAndamento" ordenacao={ordenacao} onClick={alternarOrdenacao} numerica title="Em Andamento">
              Andamento
            </Th>
            <Th coluna="recusados" ordenacao={ordenacao} onClick={alternarOrdenacao} numerica title="Recusados">
              Recus.
            </Th>
            <Th coluna="perdidos" ordenacao={ordenacao} onClick={alternarOrdenacao} numerica title="Negativados">
              Neg.
            </Th>
            <Th coluna="convertidos" ordenacao={ordenacao} onClick={alternarOrdenacao} numerica title="Convertidos">
              Conv.
            </Th>
            <Th
              coluna="classeContratacao"
              ordenacao={ordenacao}
              onClick={alternarOrdenacao}
              title="Classificação operacional em Contratações — estudo da Patricia, atualiza a cada 2 meses"
            >
              Classe Contratação
            </Th>
            <Th
              coluna="premioCotado"
              ordenacao={ordenacao}
              onClick={alternarOrdenacao}
              numerica
              title="Ticket Médio do Prêmio — prêmio total de cada card (parcela × nº de parcelas, média entre seguradoras quando mais de uma cotou), depois média entre os cards da imobiliária. É o tamanho médio de negócio, não a soma do mês."
            >
              Tkt. Méd. Prêmio
            </Th>
            <Th
              coluna="comissaoCotada"
              ordenacao={ordenacao}
              onClick={alternarOrdenacao}
              numerica
              title="Comissão Média Cotada — comissão total de cada card (prêmio total × % de comissão, média entre seguradoras quando mais de uma cotou), depois média entre os cards da imobiliária. É a comissão média por negócio, não a soma do mês."
            >
              Com. Méd. Cot.
            </Th>
            <Th
              coluna="ticketMedio"
              ordenacao={ordenacao}
              onClick={alternarOrdenacao}
              numerica
              title="Parcela Média — valor da parcela/mensalidade do seguro cotado (sem multiplicar pelo nº de parcelas), média entre os cards da imobiliária. Base do % Pacote Médio ao lado."
            >
              Parcela Méd.
            </Th>
            <Th
              coluna="mediaPercentualPacote"
              ordenacao={ordenacao}
              onClick={alternarOrdenacao}
              numerica
              title="% Pacote Médio — percentual médio do pacote de locação que vira parcela do seguro, mesma lógica do Ticket Médio"
            >
              % Pacote
            </Th>
            <Th coluna="premioEfetivado" ordenacao={ordenacao} onClick={alternarOrdenacao} numerica title="Prêmio Efetivado">
              Prêmio Efet.
            </Th>
            <Th coluna="comissaoEfetivada" ordenacao={ordenacao} onClick={alternarOrdenacao} numerica title="Comissão Efetivada">
              Com. Efet.
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
              <td className={`${styles.numCol} ${styles.num}`}>{i.recusados}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{i.perdidos}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{i.convertidos}</td>
              <td className={styles.numCol}>
                <BadgeClasse classe={classificacaoPorImobiliaria[i.nome]?.contratacoes ?? null} />
              </td>
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
              <td colSpan={15} style={{ color: "var(--ink-faint)" }}>
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
