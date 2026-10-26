import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros, limitesMes } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parcelas" };

// Etapa "Parcelas" — 1ª parte: conferência dos vencimentos (Matheus 26/10: no Corp muitas apólices estão com a
// programação das parcelas deslocada, o que erra a previsão de receita e a baixa de comissão). Compara o vencimento
// de cada parcela no Corp com o vencimento em que a seguradora COBROU a mesma parcela na fatura. Tabela pronta
// (erp_vencimentos_pronto), refeita a cada leitura das faturas.
type Linha = {
  parcela_id: string;
  documento_id: string;
  nosso_numero: number | null;
  nosso_numero_corp: number | null;
  seguradora: string | null;
  imobiliaria: string | null;
  apolice: string | null;
  parcela_n: number | null;
  parcelas_total: number | null;
  venc_corp: string;
  venc_seguradora: string;
  dif_meses: number;
  comissao_prevista: number | null;
  gerado_em: string;
};

export default async function ErpParcelasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = lerFiltros(await searchParams);
  const supabase = await createClient();
  let q = supabase.from("erp_vencimentos_pronto").select("*");
  if (f.seguradora) q = q.eq("seguradora", f.seguradora);
  if (f.imobiliaria) q = q.ilike("imobiliaria", `%${f.imobiliaria.replace(/[%_,()]/g, "")}%`);
  if (f.mes) {
    const m = limitesMes(f.mes);
    q = q.gte("venc_seguradora", m.de).lte("venc_seguradora", m.ate);
  }
  const { data } = await q.order("venc_seguradora", { ascending: false }).order("imobiliaria").limit(3000);
  const linhas = (data ?? []) as Linha[];
  const total = linhas.reduce((s, l) => s + Number(l.comissao_prevista ?? 0), 0);
  const porMes = new Map<string, { n: number; v: number }>();
  for (const l of linhas) {
    const k = l.venc_seguradora.slice(0, 7);
    const a = porMes.get(k) ?? { n: 0, v: 0 };
    porMes.set(k, { n: a.n + 1, v: a.v + Number(l.comissao_prevista ?? 0) });
  }
  const csv = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <h1 className="text-xl font-semibold text-o2-navy">Parcelas · conferência dos vencimentos</h1>
        <p className="text-sm text-gray-600">
          Parcelas cujo vencimento no Corp está em outro mês do que a seguradora cobrou na fatura. Enquanto não for corrigido no Corp, a previsão de receita e a
          baixa de comissão caem no mês errado. Fonte: faturas Tokio, Porto, Pottencial, Too e Yelum. A inadimplência entra nesta etapa depois.
        </p>
      </div>
      <FiltrosErp
        caminho="/erp/parcelas"
        campos={["seguradora", "imobiliaria", "mes"]}
        valores={f}
        resumo={
          <>
            {linhas.length.toLocaleString("pt-BR")} parcelas divergentes · comissão prevista no mês errado {formatarReais(total)} ·{" "}
            <a href={`/erp/parcelas/csv?${csv}`} className="underline">
              baixar lista para corrigir no Corp (CSV)
            </a>
            {linhas[0] ? ` · atualizado em ${new Date(linhas[0].gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
          </>
        }
      />
      <div className="flex flex-wrap gap-2 text-xs">
        {[...porMes.entries()].sort().reverse().map(([m, x]) => (
          <span key={m} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5">
            cobrado em {m.slice(5)}/{m.slice(0, 4)}: <b>{x.n}</b> parcelas · {formatarReais(x.v)}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Código O2</th>
              <th className="px-3 py-2">Nº Corp</th>
              <th className="px-3 py-2">Seg.</th>
              <th className="px-3 py-2">Apólice</th>
              <th className="px-3 py-2">Imobiliária</th>
              <th className="px-3 py-2">Parcela</th>
              <th className="px-3 py-2">Vencimento no Corp</th>
              <th className="px-3 py-2">Cobrado pela seguradora</th>
              <th className="px-3 py-2">Diferença</th>
              <th className="px-3 py-2 text-right">Comissão prevista</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.slice(0, 500).map((l) => (
              <tr key={l.parcela_id}>
                <td className="px-3 py-1">
                  <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">
                    {l.nosso_numero}
                  </Link>
                </td>
                <td className="px-3 py-1">{l.nosso_numero_corp ?? "—"}</td>
                <td className="px-3 py-1">{l.seguradora}</td>
                <td className="px-3 py-1">{l.apolice}</td>
                <td className="px-3 py-1">{l.imobiliaria ?? "—"}</td>
                <td className="px-3 py-1">
                  {l.parcela_n}
                  {l.parcelas_total ? `/${l.parcelas_total}` : ""}
                </td>
                <td className="px-3 py-1 text-red-700">{formatarData(l.venc_corp)}</td>
                <td className="px-3 py-1 font-medium">{formatarData(l.venc_seguradora)}</td>
                <td className="px-3 py-1">{l.dif_meses > 0 ? `Corp ${l.dif_meses} mês(es) depois` : `Corp ${-l.dif_meses} mês(es) antes`}</td>
                <td className="px-3 py-1 text-right">{l.comissao_prevista === null ? "—" : formatarReais(Number(l.comissao_prevista))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {linhas.length > 500 && <p className="p-3 text-xs text-gray-500">Mostrando 500 de {linhas.length}; use os filtros ou baixe o CSV para ver tudo.</p>}
      </div>
    </main>
  );
}
