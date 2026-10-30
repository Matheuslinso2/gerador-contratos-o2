import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros, type ValoresFiltro } from "@/lib/erp/filtros";
import { DESCONTO_PCT, REPASSE_ERP_EM_TESTE, arredonda, mesAnterior, mesRepasse, repasseRetidoPossivel, rotuloMes } from "@/lib/erp/repasse";
import InfoLegenda from "@/components/InfoLegenda";
import FiltrosErp from "../FiltrosErp";
import { atualizarResumoRepasse, autorizarRepasse } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repasses" };

type Resumo = {
  imobiliaria_id: string;
  imobiliaria: string | null;
  corp_parcelas: number;
  corp_bruto: number;
  sem_repasse: number;
  pro_labore_direto: number;
  baixa_divergente: number;
  previstas_sem_baixa: number;
  comissao_prevista_sem_baixa: number;
  inadimplentes: number;
  sem_email_repasse: boolean;
  erp_pend_n: number;
  erp_pend_bruto: number;
  erp_mes_n: number;
  erp_mes_bruto: number;
  erp_autorizadas_n: number;
  gerado_em: string;
};

// Tela geral de Repasses (Matheus 30/10): por imobiliária, o repasse que o ERP gerou das baixas, o aviso de comparação com o Corp, as pendências
// (baixa, atraso, cadastro) e o botão “Autorizar repasse”. As pendências não bloqueiam: falha de baixa é erro de processo.
// DESEMPENHO: o topo aparece na hora; a tabela lê o retrato pronto (erp_repasse_resumo_pronto, refeito por cron e a cada autorização) e o aviso
// “Comissão recebida” carrega à parte.
export default async function ErpRepassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const { mes } = mesRepasse(f.mes);
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const erro = typeof sp.erro === "string" ? sp.erro : undefined;

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-o2-navy">
          Repasses · {rotuloMes(mes)}
          <InfoLegenda titulo="Repasses">
            Tela de trabalho do repasse. O ERP gera o repasse de cada parcela quando a baixa do extrato é feita (todo dia, conforme os extratos chegam) e acumula por imobiliária. Aqui você vê o que está pendente,
            confere as pendências e usa “Autorizar repasse” para liberar o valor a pagar. Comissão recebida em {rotuloMes(mesAnterior(mes))} tem previsão de repasse no dia 15/{rotuloMes(mes)}. O que foi autorizado passa
            para a tela de repasses autorizados, onde o pagamento é confirmado pelo Nibo.
          </InfoLegenda>
        </h1>
        <Link href={`/erp/repasses/autorizados?mes=${mes}`} className="text-xs text-o2-navy underline">
          Repasses autorizados e pagamento →
        </Link>
      </div>
      {REPASSE_ERP_EM_TESTE && (
        <p className="rounded-lg border border-blue-300 bg-blue-50 p-2 text-sm text-blue-900">
          Modo de teste: autorizar, conferir pelo Nibo e enviar funcionam, mas não têm efeito real nos pagamentos. O pagamento dos repasses continua pelo Corp até ele ser desligado.
        </p>
      )}
      {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-2 text-sm text-green-800">{ok}</p>}
      {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{erro}</p>}
      <Suspense fallback={<div className="h-10 animate-pulse rounded-xl bg-gray-200/60" aria-busy="true" />}>
        <AvisoComissaoRecebida mes={mes} />
      </Suspense>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-white" aria-busy="true" />}>
        <TabelaRepasses mes={mes} f={f} />
      </Suspense>
    </main>
  );
}

async function AvisoComissaoRecebida({ mes }: { mes: string }) {
  const sb = await createClient();
  const retido = await repasseRetidoPossivel(sb, mes);
  if (!retido || retido.linhas === 0) return null;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <b>Comissão recebida:</b>{" "}
      <InfoLegenda titulo="Comissão recebida">
        São linhas do extrato em que a O2 já recebeu a comissão da seguradora, mas ainda ninguém ligou a uma parcela. Sem essa ligação (a baixa), o repasse da imobiliária não é criado e ela pode ficar sem receber. O valor é só a
        comissão recebida; não dá para saber ainda de qual imobiliária é cada linha.
      </InfoLegenda>{" "}
      {retido.truncado ? "pelo menos " : ""}
      {retido.linhas.toLocaleString("pt-BR")} linhas de extrato recebidas em {rotuloMes(mesAnterior(mes))} ({formatarReais(retido.valor)} de comissão) ainda estão sem parcela identificada.{" "}
      <Link href="/erp/baixas" className="underline">
        Ir para a baixa de comissão
      </Link>
    </div>
  );
}

async function TabelaRepasses({ mes, f }: { mes: string; f: ValoresFiltro }) {
  const sb = await createClient();
  const dia1 = `${mes}-01`;
  const { data } = await sb.from("erp_repasse_resumo_pronto").select("*").eq("mes", dia1).limit(1000);
  const busca = f.imobiliaria?.toLowerCase();
  const todas = (data ?? []) as Resumo[];
  const geradoEm = todas[0]?.gerado_em;

  const linhas = todas
    .map((r) => {
      const corp = Number(r.corp_bruto);
      const mesBruto = Number(r.erp_mes_bruto);
      const dif = arredonda(corp - mesBruto);
      const aviso = r.erp_mes_n === 0 && corp === 0 ? null : Math.abs(dif) <= 1 ? "bate" : dif > 0 ? "maior" : "menor";
      return { ...r, nome: r.imobiliaria ?? "—", corp, mesBruto, dif, aviso, pendBruto: Number(r.erp_pend_bruto) };
    })
    .filter((l) => (!busca || l.nome.toLowerCase().includes(busca)) && (l.erp_pend_n > 0 || l.erp_mes_n > 0 || l.corp > 0 || l.erp_autorizadas_n > 0))
    .sort((a, b) => b.pendBruto - a.pendBruto || b.corp - a.corp);

  const totPend = arredonda(linhas.reduce((s, l) => s + l.pendBruto, 0));
  const semBaixa = linhas.reduce((s, l) => s + l.previstas_sem_baixa, 0);
  const valorSemBaixa = arredonda(linhas.reduce((s, l) => s + Number(l.comissao_prevista_sem_baixa), 0));
  const chip = (n: number, txt: string, cor: string) => (n > 0 ? <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 ${cor}`}>{txt}</span> : null);

  return (
    <>
      <FiltrosErp
        caminho="/erp/repasses"
        campos={["mes", "imobiliaria"]}
        valores={f}
        resumo={
          <>
            {linhas.length} imobiliárias · pendente de autorização {formatarReais(totPend)} bruto · comissão de {rotuloMes(mesAnterior(mes))} ainda sem baixa {formatarReais(valorSemBaixa)} (
            {semBaixa.toLocaleString("pt-BR")} parcelas)
            {geradoEm ? ` · atualizado em ${new Date(geradoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
          </>
        }
      />
      <form action={atualizarResumoRepasse} className="-mt-2">
        <input type="hidden" name="mes" value={mes} />
        <button type="submit" className="text-xs text-gray-500 underline hover:text-o2-navy">
          {geradoEm ? "Atualizar agora" : "Gerar o retrato deste mês"}
        </button>
      </form>
      {todas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">Ainda não há retrato de {rotuloMes(mes)}. Use “Gerar o retrato deste mês” (leva alguns segundos).</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Imobiliária</th>
                <th className="px-3 py-2 text-right">
                  Pendente (ERP){" "}
                  <InfoLegenda titulo="Pendente (ERP)">
                    Repasse que o ERP gerou das baixas e que ainda não foi autorizado, acumulado até este mês. Bruto, antes do desconto de {DESCONTO_PCT}%, que é aplicado sobre o total na autorização.
                  </InfoLegenda>
                </th>
                <th className="px-3 py-2">
                  Corp{" "}
                  <InfoLegenda titulo="Comparação com o Corp">
                    Repasse bruto de {rotuloMes(mes)} segundo as baixas do Corp, para comparar com o do ERP. “Bate” quando a diferença é de até R$ 1,00; “Corp a maior” ou “Corp a menor” quando passa disso. A conferência
                    de fato é manual, por quem verifica a tela.
                  </InfoLegenda>
                </th>
                <th className="px-3 py-2">
                  Pendências{" "}
                  <InfoLegenda titulo="Pendências">
                    Sem baixa: comissões previstas para {rotuloMes(mesAnterior(mes))} que ainda não foram baixadas. Divergente: baixa com valor diferente do esperado. Em atraso: parcelas avisadas pela seguradora como não
                    pagas. Pró-labore: pago direto pela seguradora, a confirmar. As pendências não impedem a autorização; mostram o que merece atenção.
                  </InfoLegenda>
                </th>
                <th className="px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map((l) => (
                <tr key={l.imobiliaria_id}>
                  <td className="px-3 py-1.5">
                    <Link href={`/erp/repasses/${l.imobiliaria_id}?mes=${mes}`} className="text-o2-navy hover:underline">
                      {l.nome}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {l.erp_pend_n > 0 ? (
                      <>
                        <b>{formatarReais(arredonda(l.pendBruto))}</b>
                        <span className="block text-[11px] text-gray-500">{l.erp_pend_n} parcela(s)</span>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {l.aviso === null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <>
                        {formatarReais(l.corp)}{" "}
                        {l.aviso === "bate" && <span className="text-green-700">bate com o Corp</span>}
                        {l.aviso === "maior" && <span className="text-amber-700">Corp a maior ({l.erp_mes_n === 0 ? "ERP sem baixa" : formatarReais(l.dif)})</span>}
                        {l.aviso === "menor" && <span className="text-amber-700">Corp a menor ({formatarReais(Math.abs(l.dif))})</span>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">
                    {chip(l.previstas_sem_baixa, `${l.previstas_sem_baixa} sem baixa (${formatarReais(Number(l.comissao_prevista_sem_baixa))})`, "bg-amber-50 text-amber-800")}
                    {chip(l.baixa_divergente, `${l.baixa_divergente} divergente(s)`, "bg-amber-50 text-amber-800")}
                    {chip(l.inadimplentes, `${l.inadimplentes} em atraso`, "bg-red-50 text-red-800")}
                    {chip(l.pro_labore_direto, `${l.pro_labore_direto} pró-labore a confirmar`, "bg-blue-50 text-blue-800")}
                    {chip(l.sem_email_repasse ? 1 : 0, "sem e-mail do repasse", "bg-gray-100 text-gray-700")}
                  </td>
                  <td className="px-3 py-1.5">
                    {l.erp_pend_n > 0 ? (
                      <form action={autorizarRepasse}>
                        <input type="hidden" name="imobiliaria_id" value={l.imobiliaria_id} />
                        <input type="hidden" name="mes" value={mes} />
                        <button type="submit" className="rounded-lg bg-o2-navy px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">
                          Autorizar repasse
                        </button>
                      </form>
                    ) : l.erp_autorizadas_n > 0 ? (
                      <span className="text-green-700">autorizado</span>
                    ) : (
                      <span className="text-gray-400">sem repasse do ERP</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Autorizar trava os valores do lote da imobiliária (com {DESCONTO_PCT}% de desconto sobre o total) e leva para “Repasses autorizados”. Quem confirma o pagamento é o Nibo, quando o lançamento bate com o valor autorizado.
        Ainda não entram: valor fixo, estorno por endosso e dados bancários (próximas fases).
      </p>
    </>
  );
}
