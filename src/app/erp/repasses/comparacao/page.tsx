import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import { arredonda, mesRepasse, rotuloMes } from "@/lib/erp/repasse";
import InfoLegenda from "@/components/InfoLegenda";
import FiltrosErp from "../../FiltrosErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repasses · comparação ERP × Corp" };

type Linha = {
  imobiliaria_id: string;
  imobiliaria: string;
  repasse_id: string;
  documento_id: string;
  apolice: string | null;
  parcela_n: number | null;
  recebida_em: string;
  status: string;
  motivo: string | null;
  base_erp: number | null;
  pct_rep: number | null;
  bruto_erp: number;
  tem_corp: boolean;
  base_corp: number | null;
  bruto_corp: number | null;
};

// Comparação (Matheus 30/10): o ERP dá a baixa pelo extrato e o robô do Corp segue em paralelo. Para as MESMAS parcelas baixadas pelo ERP,
// mostra o repasse que o ERP gerou ao lado do que o Corp calcularia. Só leitura.
export default async function ErpRepassesComparacaoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = lerFiltros(await searchParams);
  const { mes } = mesRepasse(f.mes);
  const sb = await createClient();
  const { data } = await sb.rpc("erp_repasse_comparacao", { p_mes_repasse: `${mes}-01` }).order("imobiliaria").order("apolice").limit(5000);
  const busca = f.imobiliaria?.toLowerCase();
  const linhas = ((data ?? []) as Linha[])
    .map((l) => ({ ...l, bruto_erp: Number(l.bruto_erp), bruto_corp: l.bruto_corp === null ? null : Number(l.bruto_corp) }))
    .filter((l) => !busca || l.imobiliaria.toLowerCase().includes(busca));

  const grupos = new Map<string, { id: string; nome: string; linhas: Linha[] }>();
  for (const l of linhas) {
    const g = grupos.get(l.imobiliaria_id) ?? { id: l.imobiliaria_id, nome: l.imobiliaria, linhas: [] };
    g.linhas.push(l);
    grupos.set(l.imobiliaria_id, g);
  }
  const pagar = (l: Linha) => l.status !== "cancelado";
  const lista = [...grupos.values()].map((g) => {
    const aPagar = g.linhas.filter(pagar);
    const comCorp = aPagar.filter((l) => l.tem_corp);
    const erp = arredonda(aPagar.reduce((s, l) => s + l.bruto_erp, 0));
    const erpComCorp = arredonda(comCorp.reduce((s, l) => s + l.bruto_erp, 0));
    const corp = arredonda(comCorp.reduce((s, l) => s + Number(l.bruto_corp ?? 0), 0));
    return { ...g, aPagar: aPagar.length, quitadas: g.linhas.length - aPagar.length, semCorp: aPagar.length - comCorp.length, erp, erpComCorp, corp, dif: arredonda(erpComCorp - corp) };
  });
  const totErp = arredonda(lista.reduce((s, g) => s + g.erp, 0));

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <Link href={`/erp/repasses?mes=${mes}`} className="text-xs text-gray-500 hover:underline">
          ← Simulação do mês {rotuloMes(mes)}
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-o2-navy">
          Repasses · comparação ERP × Corp · {rotuloMes(mes)}
          <InfoLegenda titulo="Comparação ERP × Corp">
            O ERP já dá baixa em extratos e gera o repasse dessas parcelas; o Corp segue baixando em paralelo. Aqui, para as mesmas parcelas, o repasse que o ERP gerou fica ao lado do que o Corp
            calcularia com a baixa dele. Se o Corp ainda não baixou a parcela, ela aparece como “sem baixa no Corp” e não entra na diferença. Parcelas com pró-labore pago direto aparecem como quitadas e
            não somam no valor a pagar. É só leitura.
          </InfoLegenda>
        </h1>
      </div>
      <FiltrosErp
        caminho="/erp/repasses/comparacao"
        campos={["mes", "imobiliaria"]}
        valores={f}
        resumo={
          <>
            {lista.length} imobiliárias com repasse gerado pelo ERP · bruto a pagar {formatarReais(totErp)}
          </>
        }
      />
      {lista.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          O ERP ainda não gerou repasse para {rotuloMes(mes)}: nenhuma baixa de extrato feita pelo ERP caiu nesse mês de repasse.
        </p>
      ) : (
        lista.map((g) => (
          <div key={g.id} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-3 py-2 text-xs">
              <Link href={`/erp/repasses/${g.id}?mes=${mes}`} className="text-sm font-medium text-o2-navy hover:underline">
                {g.nome}
              </Link>
              <span>ERP: <b>{formatarReais(g.erp)}</b> ({g.aPagar} parcelas)</span>
              <span>Corp (mesmas parcelas): <b>{formatarReais(g.corp)}</b></span>
              <span className={g.dif === 0 ? "text-green-700" : "text-amber-700"}>diferença {formatarReais(g.dif)}</span>
              {g.semCorp > 0 && <span className="text-gray-500">{g.semCorp} sem baixa no Corp</span>}
              {g.quitadas > 0 && <span className="text-blue-800">{g.quitadas} quitada(s) por pró-labore direto</span>}
            </div>
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-1.5">Nº da apólice</th>
                  <th className="px-3 py-1.5">Parc.</th>
                  <th className="px-3 py-1.5">Recebida em</th>
                  <th className="px-3 py-1.5 text-right">Base (ERP)</th>
                  <th className="px-3 py-1.5 text-right">% Rep.</th>
                  <th className="px-3 py-1.5 text-right">Repasse ERP</th>
                  <th className="px-3 py-1.5 text-right">Repasse Corp</th>
                  <th className="px-3 py-1.5">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {g.linhas.map((l) => (
                  <tr key={l.repasse_id}>
                    <td className="px-3 py-1">
                      <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">
                        {l.apolice}
                      </Link>
                    </td>
                    <td className="px-3 py-1">{l.parcela_n}</td>
                    <td className="px-3 py-1">{formatarData(l.recebida_em)}</td>
                    <td className="px-3 py-1 text-right">{formatarReais(Number(l.base_erp))}</td>
                    <td className="px-3 py-1 text-right">{Number(l.pct_rep ?? 0).toLocaleString("pt-BR")}%</td>
                    <td className="px-3 py-1 text-right font-medium">{formatarReais(l.bruto_erp)}</td>
                    <td className="px-3 py-1 text-right">{l.tem_corp ? formatarReais(l.bruto_corp) : <span className="text-gray-400">sem baixa no Corp</span>}</td>
                    <td className="px-3 py-1">{l.status === "cancelado" ? l.motivo ?? "quitado" : l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </main>
  );
}
