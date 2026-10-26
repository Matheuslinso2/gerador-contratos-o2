import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import { listarFaturas, TOLERANCIA_FATURA } from "@/lib/erp/faturaTela";
import FiltrosErp from "../FiltrosErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Faturas" };

// Etapa "Faturas" (fase B, Matheus 26/10): uma linha por fatura — imobiliária + seguradora + identidade da fatura na
// seguradora; nunca mistura faturas (ex.: Expan tem 4: Porto Fiança pela O2 Corretora, Porto Fiança pela O2 Cap e
// duas apólices-fatura da Tokio). Começa por Tokio e Porto.
const mesBr = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

export default async function ErpFaturasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = lerFiltros(await searchParams);
  const supabase = await createClient();
  const [faturas, { count: alertas }] = await Promise.all([
    listarFaturas(supabase, { seguradora: f.seguradora, imobiliaria: f.imobiliaria, mes: f.mes }),
    supabase.from("erp_fora_faturas_pronto").select("documento_id", { count: "exact", head: true }),
  ]);
  const divergentes = faturas.filter((l) => l.valor_boleto !== null && Math.abs(Number(l.valor_boleto) - Number(l.valor_itens)) > TOLERANCIA_FATURA).length;

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <h1 className="text-xl font-semibold text-o2-navy">Faturas</h1>
        <p className="text-sm text-gray-600">
          Uma tela por fatura: imobiliária + seguradora + a fatura na seguradora. Mostra o último mês carregado; abra a fatura para ver o movimento mês a mês. 
          Tokio, Porto, Pottencial, Too e Yelum. Os arquivos continuam chegando pelo /faturas do Workspace.
        </p>
      </div>
      <FiltrosErp
        caminho="/erp/faturas"
        campos={["seguradora", "imobiliaria", "mes"]}
        valores={f}
        resumo={
          <>
            {faturas.length} faturas · {divergentes} com boleto diferente da soma das linhas (acima de {formatarReais(TOLERANCIA_FATURA)}) ·{" "}
            <Link href="/erp/faturas/alertas" className="underline">
              {alertas ?? 0} apólices fora das últimas faturas
            </Link>
          </>
        }
      />
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Imobiliária</th>
              <th className="px-3 py-2">Seguradora · fatura</th>
              <th className="px-3 py-2">Corretora</th>
              <th className="px-3 py-2">Último mês</th>
              <th className="px-3 py-2 text-right">Apólices</th>
              <th className="px-3 py-2 text-right">Boleto</th>
              <th className="px-3 py-2 text-right">Soma das linhas</th>
              <th className="px-3 py-2">Conferência</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {faturas.map((l) => {
              const dif = l.valor_boleto === null ? null : Number(l.valor_boleto) - Number(l.valor_itens);
              return (
                <tr key={l.fatura.id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5">
                    <Link href={`/erp/faturas/${l.fatura.id}`} className="text-o2-navy hover:underline">
                      {l.fatura.imobiliaria.nome}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    {l.fatura.seguradora} <span className="text-xs text-gray-500">{l.fatura.chave}</span>
                  </td>
                  <td className="px-3 py-1.5 text-xs">{l.fatura.corretora ?? "—"}</td>
                  <td className="px-3 py-1.5">{mesBr(l.competencia)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {l.anterior_itens !== null ? <span className="text-gray-400">{l.anterior_itens} → </span> : null}
                    {l.qtd_itens}
                  </td>
                  <td className="px-3 py-1.5 text-right">{l.valor_boleto === null ? "—" : formatarReais(Number(l.valor_boleto))}</td>
                  <td className="px-3 py-1.5 text-right">{formatarReais(Number(l.valor_itens))}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {dif === null ? (
                      <span className="text-gray-400">sem boleto</span>
                    ) : Math.abs(dif) <= TOLERANCIA_FATURA ? (
                      <span className="text-green-700">bate</span>
                    ) : (
                      <span className="font-medium text-red-700">diferença {formatarReais(dif)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
