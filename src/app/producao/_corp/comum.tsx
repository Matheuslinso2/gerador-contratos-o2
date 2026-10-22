import Link from "next/link";
import type { ReactNode } from "react";
import InfoLegenda from "@/components/InfoLegenda";
import ExportarEste from "@/components/ExportarEste";

// Peças comuns das abas "Power BI - O2 Seguros" (mesmas páginas do Power BI
// "PBI O2 SEGUROS - PRODUÇÃO CORP", lendo as tabelas corp_* — ver
// supabase/schema_corp_sharepoint.sql). Cores já validadas no Workspace
// (azul #2E6FB7 + laranja O2 #F8540D passam no validador da skill dataviz).

export const AZUL = "#2E6FB7";
export const LARANJA = "#F8540D";

export const ABAS = [
  { href: "/producao", rotulo: "Imobiliária 360" },
  { href: "/producao/geral", rotulo: "Produção Geral" },
  { href: "/producao/historica", rotulo: "Produção Histórica" },
  { href: "/producao/flash", rotulo: "Flash Report" },
  { href: "/producao/sinistros", rotulo: "Sinistros" },
  { href: "/producao/inconsistencias", rotulo: "Inconsistências" },
] as const;

export function Abas({ ativa }: { ativa: (typeof ABAS)[number]["href"] }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200">
      {ABAS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className={`-mb-px rounded-t-lg border px-4 py-2 text-sm font-medium ${
            a.href === ativa ? "border-gray-200 border-b-white bg-white text-o2-navy" : "border-transparent text-gray-500 hover:text-o2-navy"
          }`}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const rotuloMes = (m: string) => `${MESES_PT[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
export const rotuloMesLongo = (m: string) => `${MESES_LONGO[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
export const num = (v: number | null | undefined) => Math.round(v ?? 0).toLocaleString("pt-BR");
export const reais = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const compacto = (v: number | null | undefined) => {
  const x = v ?? 0;
  if (Math.abs(x) >= 1_000_000) return `R$ ${(x / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (Math.abs(x) >= 1_000) return `R$ ${(x / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return reais(x);
};
export const pct = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas })}%`;
export const div = (a: number | null | undefined, b: number | null | undefined) => (b ? (a ?? 0) / b : null);
// Análise horizontal do Power BI: atual ÷ anterior − 1 (em branco quando o atual é zero).
export const ah = (atual: number | null | undefined, anterior: number | null | undefined) =>
  !atual || !anterior ? null : atual / anterior - 1;

export function somarMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const mesValido = (v: string | undefined) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
export const lista = (v: string | undefined) => (v ? v.split("|").map((x) => x.trim()).filter(Boolean) : []);
export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";

export function Variacao({ v, rotulo }: { v: number | null; rotulo?: string }) {
  if (v === null) return <span className="text-gray-400">—</span>;
  const cls = Math.abs(v) < 0.02 ? "text-gray-500" : v > 0 ? "text-green-700" : "text-red-700";
  return (
    <span className={cls}>
      {rotulo ? `${rotulo} ` : ""}
      {v >= 0 ? "+" : "−"}
      {(Math.abs(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

export function Cartao({ rotulo, valor, legenda, children }: { rotulo: string; valor: string; legenda?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4" style={{ borderLeft: `4px solid ${LARANJA}` }}>
      <p className="flex items-center gap-1 text-xs font-semibold text-gray-600">
        {rotulo}
        {legenda && <InfoLegenda titulo={rotulo}>{legenda}</InfoLegenda>}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-o2-navy">{valor}</p>
      {children && <div className="mt-1 space-y-0.5 text-[11px] text-gray-500 tabular-nums">{children}</div>}
    </div>
  );
}

export function Quadro({ titulo, legenda, acoes, children }: { titulo: string; legenda?: ReactNode; acoes?: ReactNode; children: ReactNode }) {
  return (
    <div data-quadro={titulo} className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-o2-navy">
          {titulo}
          {legenda && <InfoLegenda titulo={titulo}>{legenda}</InfoLegenda>}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {acoes}
          <ExportarEste titulo={titulo} />
        </div>
      </div>
      {children}
    </div>
  );
}

// Barras horizontais (uma série): rótulo, barra proporcional e valor + participação.
export function BarrasH({
  itens,
  formato = "numero",
  maxItens = 12,
}: {
  itens: { k: string; v: number }[];
  formato?: "numero" | "reais";
  maxItens?: number;
}) {
  const total = itens.reduce((t, i) => t + i.v, 0);
  const visiveis = itens.slice(0, maxItens);
  const resto = itens.slice(maxItens).reduce((t, i) => t + i.v, 0);
  const linhas = resto ? [...visiveis, { k: `Outros (${itens.length - maxItens})`, v: resto }] : visiveis;
  const max = Math.max(1, ...linhas.map((i) => Math.abs(i.v)));
  const fmt = (v: number) => (formato === "reais" ? compacto(v) : num(v));
  if (!linhas.length) return <p className="text-sm text-gray-400">Sem dados no recorte.</p>;
  return (
    <div className="space-y-1.5">
      {/* Só para o Excel do quadro (ExportarEste); não aparece na tela. */}
      <table hidden data-export-tabela="Dados">
        <tbody>
          <tr>
            <th>Item</th>
            <th>Valor</th>
            <th>Participação</th>
          </tr>
          {linhas.map((i) => (
            <tr key={i.k}>
              <td>{i.k}</td>
              <td>{formato === "reais" ? `R$ ${i.v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : i.v.toLocaleString("pt-BR")}</td>
              <td>{pct(div(i.v, total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {linhas.map((i) => (
        <div key={i.k} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs" title={`${i.k}: ${fmt(i.v)} (${pct(div(i.v, total))})`}>
          <span className="truncate text-gray-700">{i.k}</span>
          <span className="h-3 rounded-r" style={{ width: `${Math.max(1, (Math.abs(i.v) / max) * 100)}%`, background: AZUL }} />
          <span className="whitespace-nowrap tabular-nums text-o2-navy">
            {fmt(i.v)} <span className="text-gray-400">{pct(div(i.v, total))}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// Colunas por período (ano/trimestre/mês) com a variação contra o período
// anterior escrita acima de cada coluna (um eixo só — a variação é texto).
export function Colunas({
  itens,
  formato = "numero",
  altura = 140,
}: {
  itens: { rotulo: string; v: number; cresc?: number | null }[];
  formato?: "numero" | "reais";
  altura?: number;
}) {
  if (!itens.length) return <p className="text-sm text-gray-400">Sem dados no período.</p>;
  const fmt = (v: number) => (formato === "reais" ? compacto(v) : num(v));
  const max = Math.max(1, ...itens.map((i) => i.v));
  const poucos = itens.length <= 16;
  const passo = poucos ? 1 : Math.ceil(itens.length / 16);
  return (
    <div className="flex items-end gap-[2px]" style={{ height: altura + 34 }}>
      {/* Só para o Excel do quadro (ExportarEste); não aparece na tela. */}
      <table hidden data-export-tabela="Dados">
        <tbody>
          <tr>
            <th>Período</th>
            <th>Valor</th>
            <th>Variação</th>
          </tr>
          {itens.map((i) => (
            <tr key={i.rotulo}>
              <td>{i.rotulo}</td>
              <td>{formato === "reais" ? `R$ ${i.v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : i.v.toLocaleString("pt-BR")}</td>
              <td>{i.cresc != null ? `${(i.cresc * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {itens.map((i, n) => (
        <div key={i.rotulo} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={`${i.rotulo}: ${fmt(i.v)}${i.cresc != null ? ` (${pct(i.cresc)} vs período anterior)` : ""}`}>
          {poucos && i.cresc != null && (
            <span className={`mb-0.5 text-[10px] tabular-nums ${i.cresc >= 0 ? "text-green-700" : "text-red-700"}`}>
              {i.cresc >= 0 ? "+" : "−"}
              {(Math.abs(i.cresc) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            </span>
          )}
          <div className="w-full max-w-[28px] rounded-t" style={{ height: Math.max(1, (Math.max(0, i.v) / max) * altura), background: AZUL }} />
          <span className="mt-1 h-3 truncate text-[10px] text-gray-500">{n % passo === 0 ? i.rotulo : ""}</span>
        </div>
      ))}
    </div>
  );
}

// Link que troca um parâmetro da URL mantendo os demais.
export function hrefCom(base: string, sp: Record<string, string | undefined>, troca: Record<string, string | null>) {
  const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  for (const [k, v] of Object.entries(troca)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export function Alternador({ base, sp, chave, opcoes, atual }: { base: string; sp: Record<string, string | undefined>; chave: string; opcoes: { valor: string; rotulo: string }[]; atual: string }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
      {opcoes.map((o) => (
        <Link
          key={o.valor}
          href={hrefCom(base, sp, { [chave]: o.valor })}
          scroll={false}
          className={`rounded-md px-2.5 py-1 ${o.valor === atual ? "bg-white font-semibold text-o2-navy shadow-sm" : "text-gray-500 hover:text-o2-navy"}`}
        >
          {o.rotulo}
        </Link>
      ))}
    </div>
  );
}

export function FonteDados({ importadoEm, arquivoEm }: { importadoEm: string | null; arquivoEm: string | null }) {
  return (
    <p className="text-xs text-gray-500">
      Fonte: extrações do Corp no SharePoint &quot;O2 Data Analytics&quot; (mesma base do Power BI)
      {arquivoEm ? ` · planilhas do Corp atualizadas no SharePoint em ${dataHora(arquivoEm)}` : ""} · lido pelo Workspace em {dataHora(importadoEm)}
    </p>
  );
}
