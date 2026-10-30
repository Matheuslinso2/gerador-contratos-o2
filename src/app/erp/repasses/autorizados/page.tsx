import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import { DESCONTO_PCT, arredonda, mesRepasse, rotuloMes } from "@/lib/erp/repasse";
import InfoLegenda from "@/components/InfoLegenda";
import FiltrosErp from "../../FiltrosErp";
import { cancelarAutorizacao } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repasses autorizados" };

type Lote = {
  id: string;
  imobiliaria_id: string;
  competencia: string;
  total_bruto: number;
  total_retido: number;
  total_liquido: number;
  status: string;
  autorizado_em: string | null;
  pago_em: string | null;
  nibo_valor: number | null;
  relatorio_enviado_em: string | null;
  imobiliarias: { nome: string } | null;
};

// Repasses autorizados (Matheus 30/10): só o resumo do que foi autorizado a pagar. O pagamento é confirmado SOMENTE pelo Nibo (lançamento que bate com o
// valor autorizado). Depois de pago, o relatório é enviado à imobiliária pelo mecanismo de envio do Workspace.
export default async function ErpRepassesAutorizadosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const { mes } = mesRepasse(f.mes);
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const erro = typeof sp.erro === "string" ? sp.erro : undefined;
  const sb = await createClient();
  const { data } = await sb
    .from("erp_repasse_lotes")
    .select("id, imobiliaria_id, competencia, total_bruto, total_retido, total_liquido, status, autorizado_em, pago_em, nibo_valor, relatorio_enviado_em, imobiliarias(nome)")
    .eq("competencia", `${mes}-01`)
    .in("status", ["autorizado", "pago", "enviado"])
    .order("autorizado_em", { ascending: false })
    .limit(1000);
  const busca = f.imobiliaria?.toLowerCase();
  const lotes = ((data ?? []) as unknown as Lote[]).filter((l) => !busca || (l.imobiliarias?.nome ?? "").toLowerCase().includes(busca));
  const soma = (fn: (l: Lote) => boolean) => arredonda(lotes.filter(fn).reduce((s, l) => s + Number(l.total_liquido), 0));
  const aguardando = lotes.filter((l) => l.status === "autorizado");
  const pagos = lotes.filter((l) => l.status !== "autorizado");

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <Link href={`/erp/repasses?mes=${mes}`} className="text-xs text-gray-500 hover:underline">
          ← Repasses
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-o2-navy">
          Repasses autorizados · {rotuloMes(mes)}
          <InfoLegenda titulo="Repasses autorizados">
            Resumo do que foi autorizado a pagar neste mês de repasse, uma linha por imobiliária, com os valores travados na autorização (desconto de {DESCONTO_PCT}% sobre o total). O pagamento é confirmado
            automaticamente quando o Nibo registra um pagamento de repasse com o mesmo valor líquido. Depois de pago, o relatório é enviado à imobiliária pelo envio de repasses do Workspace.
          </InfoLegenda>
        </h1>
      </div>
      {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-2 text-sm text-green-800">{ok}</p>}
      {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{erro}</p>}
      <FiltrosErp
        caminho="/erp/repasses/autorizados"
        campos={["mes", "imobiliaria"]}
        valores={f}
        resumo={
          <>
            {lotes.length} autorizados · aguardando o Nibo {formatarReais(soma((l) => l.status === "autorizado"))} ({aguardando.length}) · pagos {formatarReais(soma((l) => l.status !== "autorizado"))} ({pagos.length})
          </>
        }
      />
      {lotes.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">Nenhum repasse autorizado para {rotuloMes(mes)} ainda. Autorize na tela de Repasses.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Imobiliária</th>
                <th className="px-3 py-2">Autorizado em</th>
                <th className="px-3 py-2 text-right">Bruto</th>
                <th className="px-3 py-2 text-right">−{DESCONTO_PCT}%</th>
                <th className="px-3 py-2 text-right">Líquido</th>
                <th className="px-3 py-2">
                  Pagamento{" "}
                  <InfoLegenda titulo="Pagamento">
                    “Aguardando o Nibo” até o Nibo registrar o pagamento de repasse com o mesmo valor líquido e o nome da imobiliária. Aí passa para “pago”, com a data do Nibo. Não há confirmação manual.
                  </InfoLegenda>
                </th>
                <th className="px-3 py-2">
                  Relatório{" "}
                  <InfoLegenda titulo="Envio do relatório">
                    Com o repasse pago, o relatório e o comprovante são enviados à imobiliária pelo envio de repasses do Workspace (e-mail do repasse cadastrado na ficha).
                  </InfoLegenda>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lotes.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-1.5">
                    <Link href={`/erp/repasses/${l.imobiliaria_id}?mes=${mes}`} className="text-o2-navy hover:underline">
                      {l.imobiliarias?.nome ?? "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{l.autorizado_em ? formatarData(l.autorizado_em.slice(0, 10)) : "—"}</td>
                  <td className="px-3 py-1.5 text-right">{formatarReais(Number(l.total_bruto))}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{formatarReais(Number(l.total_retido))}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{formatarReais(Number(l.total_liquido))}</td>
                  <td className="px-3 py-1.5">
                    {l.status === "autorizado" ? (
                      <div className="flex items-center gap-2">
                        <span className="text-amber-700">aguardando o Nibo</span>
                        <form action={cancelarAutorizacao}>
                          <input type="hidden" name="lote_id" value={l.id} />
                          <input type="hidden" name="mes" value={mes} />
                          <button type="submit" className="text-[11px] text-gray-500 underline hover:text-red-700">
                            cancelar autorização
                          </button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-green-700">pago em {l.pago_em ? formatarData(l.pago_em) : "—"} (Nibo)</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {l.status === "autorizado" ? (
                      <span className="text-gray-400">após o pagamento</span>
                    ) : l.relatorio_enviado_em ? (
                      <span className="text-green-700">enviado em {formatarData(l.relatorio_enviado_em.slice(0, 10))}</span>
                    ) : (
                      <Link href="/repasses/upload" className="rounded-lg bg-o2-navy px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">
                        Enviar relatório
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
