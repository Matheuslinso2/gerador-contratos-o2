import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros, limitesMes } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";
import BotaoVerDocumento from "../BotaoVerDocumento";
import InfoLegenda from "@/components/InfoLegenda";

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

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <div className="flex gap-3 text-sm">
          <span className="border-b-2 border-o2-navy font-semibold text-o2-navy">Conferência dos vencimentos</span>
          <Link href="/erp/parcelas/cobranca" className="text-gray-500 hover:text-o2-navy hover:underline">Cobrança e inadimplência</Link>
        </div>
        <h1 className="mt-2 text-xl font-semibold text-o2-navy">Parcelas · conferência dos vencimentos<InfoLegenda titulo="Conferência dos vencimentos">O vencimento de cada parcela no ERP é conferido contra a apólice (PDF), a fatura da seguradora e a regra do calendário, nessa ordem de prioridade. Esta lista mostra as parcelas em que o vencimento do ERP está em outro mês do que a seguradora cobrou na fatura (Tokio, Porto, Pottencial, Too e Yelum) e que ainda pedem conferência. A lista é refeita a cada leitura das faturas. O filtro de mês vale pelo vencimento cobrado pela seguradora, e a tela mostra 500 parcelas.</InfoLegenda></h1>
        <p className="text-sm text-gray-600">
          O ERP confere o vencimento de cada parcela com a apólice, a fatura da seguradora e a regra do calendário. Aqui ficam as parcelas em que o vencimento do ERP
          está em outro mês do que a seguradora cobrou na fatura. Fonte: faturas Tokio, Porto, Pottencial, Too e Yelum.
        </p>
      </div>
      <FiltrosErp
        caminho="/erp/parcelas"
        campos={["seguradora", "imobiliaria", "mes"]}
        valores={f}
        resumo={
          <>
            {linhas.length.toLocaleString("pt-BR")} parcelas em conferência · comissão prevista nelas {formatarReais(total)}
            {linhas[0] ? ` · atualizado em ${new Date(linhas[0].gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
          </>
        }
      />
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="self-center"><InfoLegenda titulo="Cobrado em (por mês)">Agrupa as parcelas em conferência pelo mês em que a seguradora cobrou. Cada cartão mostra quantas parcelas são e a soma da comissão prevista delas.</InfoLegenda></span>{[...porMes.entries()].sort().reverse().map(([m, x]) => (
          <span key={m} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5">
            cobrado em {m.slice(5)}/{m.slice(0, 4)}: <b>{x.n}</b> parcelas · {formatarReais(x.v)}
          </span>
        ))}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-o2-navy">Parcelas em conferência<InfoLegenda titulo="Parcelas em conferência">Cada linha é uma parcela. Vencimento no ERP é a data que o ERP tem para a parcela; Cobrado pela seguradora é o vencimento dessa mesma parcela na fatura da seguradora; Diferença diz quantos meses o vencimento do ERP está adiantado ou atrasado em relação à fatura. Comissão prevista é a comissão esperada daquela parcela. Parcela mostra o número da parcela e o total quando se sabe. Abrir leva ao documento no ERP.</InfoLegenda></p>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Abrir</th>
              <th className="px-3 py-2">Código O2 do documento</th>
              <th className="px-3 py-2">Nosso nº do Corp</th>
              <th className="px-3 py-2">Seg.</th>
              <th className="px-3 py-2">Nº da apólice</th>
              <th className="px-3 py-2">Imobiliária</th>
              <th className="px-3 py-2">Parcela</th>
              <th className="px-3 py-2">Vencimento no ERP</th>
              <th className="px-3 py-2">Cobrado pela seguradora</th>
              <th className="px-3 py-2">Diferença</th>
              <th className="px-3 py-2 text-right">Comissão prevista</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.slice(0, 500).map((l) => (
              <tr key={l.parcela_id}>
                <td className="px-3 py-1"><BotaoVerDocumento id={l.documento_id} /></td>
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
                <td className="px-3 py-1">{formatarData(l.venc_corp)}</td>
                <td className="px-3 py-1 font-medium">{formatarData(l.venc_seguradora)}</td>
                <td className="px-3 py-1">{l.dif_meses > 0 ? `${l.dif_meses} mês(es) depois da fatura` : `${-l.dif_meses} mês(es) antes da fatura`}</td>
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
