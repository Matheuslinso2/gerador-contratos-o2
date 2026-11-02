import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { podeVerNibo } from "@/lib/erp/acessoNibo";
import { mesAtual } from "@/lib/erp/periodo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nibo" };

// Espelho do "Painel de Acompanhamento" do Nibo (Relatórios > Painel de acompanhamento, visão Caixa, Realizado).
// Só Matheus, Nathalie e William (decisão do Matheus, 03/11/2026). Três sub-abas: Consolidado (soma dos dois CNPJs, abre
// primeiro), Corretora e Capitalização. Abre no mês atual (coluna destacada) e permite consultar qualquer mês e ano.
// Os números vêm de erp_nibo_painel(ano, empresa), alimentada pela sincronização com o Nibo (somente leitura).

type Linha = {
  bloco: string;
  bloco_ordem: number;
  linha_tipo: "categoria" | "subtotal" | "margem" | "margem_pct" | "resultado";
  ordem: number;
  rotulo: string;
  categoria_nome: string | null;
  m01: number | null; m02: number | null; m03: number | null; m04: number | null; m05: number | null; m06: number | null;
  m07: number | null; m08: number | null; m09: number | null; m10: number | null; m11: number | null; m12: number | null;
  total: number | null;
};

const ABAS = [
  { chave: "consolidado", rotulo: "Consolidado", sub: "Corretora + Capitalização" },
  { chave: "corretora", rotulo: "Corretora", sub: "CNPJ da corretora" },
  { chave: "capitalizacao", rotulo: "Capitalização", sub: "O2 Capitalização e Seguros Ltda · 54.493.758/0001-38" },
] as const;
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const COLS = ["m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12"] as const;

const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
function fmt(v: number | null | undefined, pct = false): string {
  const n = Math.round(Number(v ?? 0));
  if (pct) return `${n} %`;
  if (n < 0) return `(${num.format(Math.abs(n))})`;
  return num.format(n);
}
const cor = (v: number | null | undefined) => (Number(v ?? 0) < -0.5 ? "text-red-600" : "text-gray-800");

export default async function NiboPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!podeVerNibo(user?.email)) redirect("/erp");

  const atual = mesAtual(); // AAAA-MM
  const anoAtual = Number(atual.slice(0, 4));
  const mesDoAno = Number(atual.slice(5, 7));
  const aba = ABAS.find((a) => a.chave === sp.aba)?.chave ?? "consolidado";
  const ano = /^\d{4}$/.test(sp.ano ?? "") ? Number(sp.ano) : anoAtual;
  const mSel = /^(0?[1-9]|1[0-2])$/.test(sp.m ?? "") ? Number(sp.m) : ano === anoAtual ? mesDoAno : 12;

  const sb = createServiceClient();
  const { data, error } = await sb.rpc("erp_nibo_painel", { p_ano: ano, p_empresa: aba });
  const linhas = ((data ?? []) as Linha[]).slice().sort((a, b) => a.bloco_ordem - b.bloco_ordem || a.ordem - b.ordem);
  const { data: sinc } = await sb.from("erp_nibo_lancamentos").select("sincronizado_em").order("sincronizado_em", { ascending: false }).limit(1);
  const ultimaSync = sinc?.[0]?.sincronizado_em ? new Date(sinc[0].sincronizado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;

  const href = (p: { aba?: string; ano?: number; m?: number }) => {
    const q = new URLSearchParams();
    q.set("aba", p.aba ?? aba);
    q.set("ano", String(p.ano ?? ano));
    q.set("m", String(p.m ?? mSel));
    return `/erp/nibo?${q.toString()}`;
  };
  const doMes = (t: Linha["linha_tipo"], bloco?: string) => linhas.find((l) => l.linha_tipo === t && (!bloco || l.bloco === bloco));
  const col = COLS[mSel - 1];
  const resumo = [
    { nome: "Receitas operacionais (A)", l: doMes("subtotal", "A") },
    { nome: "Custos operacionais (B)", l: doMes("subtotal", "B") },
    { nome: "Margem de contribuição", l: doMes("margem") },
    { nome: "Despesas operacionais e outras (C)", l: doMes("subtotal", "C") },
    { nome: "Resultado (A+B+C)", l: doMes("resultado") },
  ];
  const abaAtiva = ABAS.find((a) => a.chave === aba)!;

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-o2-navy">Nibo · Painel de acompanhamento</h1>
          <p className="text-xs text-gray-500">
            Espelho do relatório do Nibo, visão Caixa, Realizado. Só leitura.{ultimaSync ? ` Última sincronização: ${ultimaSync}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={href({ ano: ano - 1 })} className="rounded-full border border-gray-300 px-3 py-1 hover:bg-white" aria-label="Ano anterior">‹</Link>
          <span className="w-12 text-center text-base font-semibold text-o2-navy">{ano}</span>
          <Link href={href({ ano: ano + 1 })} className="rounded-full border border-gray-300 px-3 py-1 hover:bg-white" aria-label="Próximo ano">›</Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {ABAS.map((a) => (
          <Link key={a.chave} href={href({ aba: a.chave })} title={a.sub} className={`rounded-full border px-4 py-1.5 text-sm font-medium ${a.chave === aba ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-700 hover:bg-white"}`}>
            {a.rotulo}
          </Link>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-500">{abaAtiva.sub}</p>

      <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
        {MESES.map((nome, i) => (
          <Link key={nome} href={href({ m: i + 1 })} className={`rounded-full border px-3 py-1 font-medium ${i + 1 === mSel ? "border-o2-coral bg-o2-coral text-white" : "border-gray-300 text-gray-700 hover:bg-white"}`}>
            {nome}
            {ano === anoAtual && i + 1 === mesDoAno ? " ·atual" : ""}
          </Link>
        ))}
      </div>

      {error ? (
        <p className="mt-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não consegui ler o painel do Nibo: {error.message}</p>
      ) : (
        <>
          <section className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
            {resumo.map((r) => (
              <div key={r.nome} className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{r.nome}</p>
                <p className={`text-lg font-semibold ${cor(r.l?.[col])}`}>{fmt(r.l?.[col])}</p>
                <p className="text-[11px] text-gray-500">{MESES[mSel - 1]}/{ano} · no ano: {fmt(r.l?.total)}</p>
              </div>
            ))}
          </section>

          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[1000px] text-right text-[12px]">
              <thead>
                <tr className="bg-gray-100 text-[11px] uppercase tracking-wide text-gray-600">
                  <th className="px-3 py-2 text-left">Resultado</th>
                  {MESES.map((n, i) => (
                    <th key={n} className={`px-2 py-2 ${i + 1 === mSel ? "bg-o2-coral/15 text-o2-coral" : ""}`}>{n}</th>
                  ))}
                  <th className="px-3 py-2">{ano}</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, idx) => {
                  const destaque = l.linha_tipo !== "categoria";
                  const pct = l.linha_tipo === "margem_pct";
                  return (
                    <tr key={`${l.bloco}-${l.linha_tipo}-${l.ordem}-${idx}`} className={`border-t border-gray-100 ${destaque ? "bg-gray-50 font-semibold" : ""}`}>
                      <td className={`px-3 py-1.5 text-left ${destaque ? "text-o2-navy" : "pl-6 text-gray-700"}`}>{l.rotulo}</td>
                      {COLS.map((c, i) => (
                        <td key={c} className={`px-2 py-1.5 tabular-nums ${i + 1 === mSel ? "bg-o2-coral/10" : ""} ${cor(l[c])}`}>{fmt(l[c], pct)}</td>
                      ))}
                      <td className={`px-3 py-1.5 tabular-nums ${cor(l.total)}`}>{fmt(l.total, pct)}</td>
                    </tr>
                  );
                })}
                {!linhas.length ? (
                  <tr><td colSpan={14} className="px-3 py-6 text-center text-gray-500">Sem dados do Nibo para {ano}.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
