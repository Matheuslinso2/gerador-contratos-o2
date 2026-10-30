import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import { listarFaturas, TOLERANCIA_FATURA } from "@/lib/erp/faturaTela";
import FiltrosErp from "../FiltrosErp";
import InfoLegenda from "@/components/InfoLegenda";

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
  // Envio (Fase 1 do envio nativo, 30/10): status do envio do Workspace por imobiliária × seguradora × competência.
  const competencias = [...new Set(faturas.map((l) => l.competencia))];
  const { data: envios } = competencias.length
    ? await supabase.from("erp_fatura_envio_status").select("imobiliaria_id, seguradora, competencia, situacao_envio, docs_total, docs_enviados, ultimo_envio_em, ultimo_envio_por").in("competencia", competencias)
    : { data: [] };
  type Envio = { imobiliaria_id: string; seguradora: string; competencia: string; situacao_envio: string; docs_total: number; docs_enviados: number; ultimo_envio_em: string | null; ultimo_envio_por: string | null };
  const envioDe = new Map(((envios ?? []) as Envio[]).map((e) => [`${e.imobiliaria_id}|${e.seguradora}|${e.competencia}`, e]));
  const divergentes = faturas.filter((l) => l.valor_boleto !== null && Math.abs(Number(l.valor_boleto) - Number(l.valor_itens)) > TOLERANCIA_FATURA).length;

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <h1 className="text-xl font-semibold text-o2-navy">
          Faturas
          <InfoLegenda titulo="Faturas">
            Fatura é o conjunto de apólices que a seguradora cobra de uma imobiliária num único boleto; ela não tem apólice própria. Cada linha da lista é uma fatura: imobiliária mais seguradora mais a identificação da fatura na seguradora, sem misturar faturas (uma imobiliária pode ter várias, por seguradora, corretora ou produto). Os dados vêm dos arquivos de fatura enviados pelas seguradoras (Tokio, Porto, Pottencial, Too e Yelum), que continuam chegando pelo /faturas do Workspace. Cada fatura é mostrada pelo último mês carregado, ou pelo mês escolhido no filtro; clique na imobiliária para ver o movimento mês a mês.
          </InfoLegenda>
        </h1>
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
              {alertas ?? 0} contratadas fora da fatura (informativo, não é pendência)
            </Link>
            <InfoLegenda titulo="Resumo das faturas">
              Faturas: quantas faturas aparecem na lista com os filtros atuais. Com boleto diferente: faturas em que o valor do boleto da seguradora difere da soma das linhas em mais de R$ 1,00. Contratadas fora da fatura: apólices com parcela vencendo no período das últimas faturas que não apareceram em nenhuma delas (candidatas a boleto ou cartão); é só informativo, não é pendência. O número vem de uma tabela pronta, sem os filtros da tela.
            </InfoLegenda>
          </>
        }
      />
      <p className="flex items-center text-xs font-semibold uppercase tracking-wide text-o2-navy">
        Lista de faturas
        <InfoLegenda titulo="Lista de faturas">
          Imobiliária: dona da fatura (abre a tela da fatura). Seguradora · fatura: a seguradora e a identificação da fatura. Nº da fatura: número do documento do boleto, lido do arquivo da seguradora. Corretora: a corretora da O2 ligada à fatura (por exemplo, O2 Corretora ou O2 Cap). Último mês: o mês mais recente carregado (ou o mês do filtro). Apólices: quantidade de apólices na fatura nesse mês; quando há mês anterior, aparece “mês anterior → este mês”. Boleto: valor do boleto da seguradora. Soma das linhas: soma do que a fatura cobra de cada apólice. Conferência: “bate” quando boleto e soma diferem em até R$ 1,00; fora disso mostra a diferença; “sem boleto” quando o arquivo não trouxe o valor do boleto. Envio à imobiliária: situação do envio da fatura daquele mês, lida do envio de faturas que hoje roda no Workspace — “enviada” (com a data do último envio e, ao passar o mouse, quem enviou), “parcial” (só parte dos arquivos foi enviada), “a enviar” (arquivos prontos, ainda não enviados) ou “aguardando arquivo”. Na Porto, as faturas de Fiança e de Ramos Elementares aparecem juntas porque o controle do ERP não as separa.
        </InfoLegenda>
      </p>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Imobiliária</th>
              <th className="px-3 py-2">Seguradora · fatura</th>
              <th className="px-3 py-2">Nº da fatura</th>
              <th className="px-3 py-2">Corretora</th>
              <th className="px-3 py-2">Último mês</th>
              <th className="px-3 py-2 text-right">Apólices</th>
              <th className="px-3 py-2 text-right">Boleto</th>
              <th className="px-3 py-2 text-right">Soma das linhas</th>
              <th className="px-3 py-2">Conferência</th>
              <th className="px-3 py-2">Envio à imobiliária</th>
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
                  <td className="px-3 py-1.5 text-xs font-medium">{(l as { numero_fatura?: string | null }).numero_fatura ?? <span className="text-gray-300">—</span>}</td>
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
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                    {(() => {
                      const e = envioDe.get(`${l.fatura.imobiliaria_id}|${l.fatura.seguradora}|${l.competencia}`);
                      if (!e) return <span className="text-gray-400">sem arquivo no envio</span>;
                      const quando = e.ultimo_envio_em ? new Date(e.ultimo_envio_em).toLocaleDateString("pt-BR") : null;
                      if (e.situacao_envio === "enviada") return <span className="text-green-700" title={e.ultimo_envio_por ? `Enviado por ${e.ultimo_envio_por}` : undefined}>enviada{quando ? ` em ${quando}` : ""}</span>;
                      if (e.situacao_envio === "parcial") return <span className="font-medium text-amber-700">parcial · {e.docs_enviados} de {e.docs_total} arquivos</span>;
                      if (e.situacao_envio === "a_enviar") return <span className="font-medium text-sky-700">a enviar</span>;
                      return <span className="text-gray-500">aguardando arquivo</span>;
                    })()}
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
