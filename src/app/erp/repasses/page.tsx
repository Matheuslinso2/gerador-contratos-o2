import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import { DESCONTO_PCT, REPASSE_ERP_EM_TESTE, arredonda, mesAnterior, mesRepasse, repasseRetidoPossivel, rotuloMes } from "@/lib/erp/repasse";
import InfoLegenda from "@/components/InfoLegenda";
import FiltrosErp from "../FiltrosErp";
import { autorizarRepasse } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repasses" };

type Preparo = {
  imobiliaria_id: string;
  imobiliaria: string;
  parcelas: number;
  bruto: number;
  sem_repasse: number;
  pro_labore_direto: number;
  baixa_divergente: number;
  previstas_sem_baixa: number;
  comissao_prevista_sem_baixa: number;
  inadimplentes: number;
  sem_email_repasse: boolean;
  sem_codigo_corp: boolean;
};
type RepasseErp = { imobiliaria_id: string; competencia: string; valor_bruto: number; valor_liquido: number; valor_retido: number; status: string; imobiliarias: { nome: string } | null };

// Tela geral de Repasses (Matheus 30/10): por imobiliária, o repasse que o ERP gerou das baixas, o aviso de comparação com o Corp, as pendências
// (baixa, atraso, cadastro) e o botão “Autorizar repasse”. Quem autoriza vê o que sobrou de pendência, mas ela não bloqueia: falha de baixa é erro de processo.
// O que foi autorizado segue para a tela “Repasses autorizados”, onde o Nibo confirma o pagamento.
export default async function ErpRepassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const { mes } = mesRepasse(f.mes);
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const erro = typeof sp.erro === "string" ? sp.erro : undefined;
  const sb = await createClient();
  const dia1 = `${mes}-01`;
  const [{ data: prep }, { data: erpData }, retido] = await Promise.all([
    sb.rpc("erp_repasse_preparo", { p_mes_repasse: dia1 }).limit(1000),
    sb.from("erp_repasses").select("imobiliaria_id, competencia, valor_bruto, valor_liquido, valor_retido, status, imobiliarias(nome)").lte("competencia", dia1).in("status", ["pendente", "em_lote", "pago"]).limit(20000),
    repasseRetidoPossivel(sb, mes),
  ]);

  const porImob = new Map<string, { nome: string; preparo?: Preparo; pend: number; pendBruto: number; mesBruto: number; mesParcelas: number; autorizadas: number }>();
  const pega = (id: string, nome: string) => porImob.get(id) ?? porImob.set(id, { nome, pend: 0, pendBruto: 0, mesBruto: 0, mesParcelas: 0, autorizadas: 0 }).get(id)!;
  for (const p of (prep ?? []) as Preparo[]) pega(p.imobiliaria_id, p.imobiliaria).preparo = { ...p, bruto: Number(p.bruto), comissao_prevista_sem_baixa: Number(p.comissao_prevista_sem_baixa) };
  for (const r of (erpData ?? []) as unknown as RepasseErp[]) {
    const g = pega(r.imobiliaria_id, r.imobiliarias?.nome ?? "—");
    const bruto = Number(r.valor_bruto);
    if (r.status === "pendente") {
      g.pend += 1;
      g.pendBruto += bruto;
    }
    if (r.status === "em_lote" || r.status === "pago") g.autorizadas += 1;
    if (r.competencia === dia1 && r.status !== "cancelado") {
      g.mesBruto += bruto;
      g.mesParcelas += 1;
    }
  }

  const busca = f.imobiliaria?.toLowerCase();
  const linhas = [...porImob.entries()]
    .map(([id, g]) => {
      const corp = g.preparo?.bruto ?? 0;
      const dif = arredonda(corp - g.mesBruto);
      const aviso = g.mesParcelas === 0 && corp === 0 ? null : Math.abs(dif) <= 1 ? "bate" : dif > 0 ? "maior" : "menor";
      const p = g.preparo;
      const pendencias = p ? p.previstas_sem_baixa + p.baixa_divergente + p.inadimplentes + p.pro_labore_direto + (p.sem_email_repasse ? 1 : 0) : 0;
      return { id, ...g, corp, dif, aviso, pendencias };
    })
    .filter((l) => (!busca || l.nome.toLowerCase().includes(busca)) && (l.pend > 0 || l.mesParcelas > 0 || l.corp > 0 || l.autorizadas > 0))
    .sort((a, b) => b.pendBruto - a.pendBruto || b.corp - a.corp);

  const totPend = arredonda(linhas.reduce((s, l) => s + l.pendBruto, 0));
  const semBaixa = linhas.reduce((s, l) => s + (l.preparo?.previstas_sem_baixa ?? 0), 0);
  const valorSemBaixa = arredonda(linhas.reduce((s, l) => s + (l.preparo?.comissao_prevista_sem_baixa ?? 0), 0));
  const chip = (n: number, txt: string, cor: string) => (n > 0 ? <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 ${cor}`}>{txt}</span> : null);

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
      <FiltrosErp
        caminho="/erp/repasses"
        campos={["mes", "imobiliaria"]}
        valores={f}
        resumo={
          <>
            {linhas.length} imobiliárias · pendente de autorização {formatarReais(totPend)} bruto · comissão de {rotuloMes(mesAnterior(mes))} ainda sem baixa {formatarReais(valorSemBaixa)} (
            {semBaixa.toLocaleString("pt-BR")} parcelas)
          </>
        }
      />
      {retido && retido.linhas > 0 && (
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
      )}
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
                  Repasse bruto de {rotuloMes(mes)} segundo as baixas do Corp, para comparar com o do ERP. “Bate” quando a diferença é de até R$ 1,00; “Corp a maior” ou “Corp a menor” quando passa disso. A conferência de
                  fato é manual, por quem verifica a tela.
                </InfoLegenda>
              </th>
              <th className="px-3 py-2">
                Pendências{" "}
                <InfoLegenda titulo="Pendências">
                  Sem baixa: comissões previstas para {rotuloMes(mesAnterior(mes))} que ainda não foram baixadas. Divergente: baixa com valor diferente do esperado. Em atraso: parcelas avisadas pela seguradora como não pagas.
                  Pró-labore: pago direto pela seguradora, a confirmar. As pendências não impedem a autorização; mostram o que merece atenção.
                </InfoLegenda>
              </th>
              <th className="px-3 py-2">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-1.5">
                  <Link href={`/erp/repasses/${l.id}?mes=${mes}`} className="text-o2-navy hover:underline">
                    {l.nome}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right">
                  {l.pend > 0 ? (
                    <>
                      <b>{formatarReais(arredonda(l.pendBruto))}</b>
                      <span className="block text-[11px] text-gray-500">{l.pend} parcela(s)</span>
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
                      {l.aviso === "maior" && <span className="text-amber-700">Corp a maior ({l.mesParcelas === 0 ? "ERP sem baixa" : formatarReais(l.dif)})</span>}
                      {l.aviso === "menor" && <span className="text-amber-700">Corp a menor ({formatarReais(Math.abs(l.dif))})</span>}
                    </>
                  )}
                </td>
                <td className="px-3 py-1.5 text-gray-700">
                  {l.preparo && (
                    <>
                      {chip(l.preparo.previstas_sem_baixa, `${l.preparo.previstas_sem_baixa} sem baixa (${formatarReais(l.preparo.comissao_prevista_sem_baixa)})`, "bg-amber-50 text-amber-800")}
                      {chip(l.preparo.baixa_divergente, `${l.preparo.baixa_divergente} divergente(s)`, "bg-amber-50 text-amber-800")}
                      {chip(l.preparo.inadimplentes, `${l.preparo.inadimplentes} em atraso`, "bg-red-50 text-red-800")}
                      {chip(l.preparo.pro_labore_direto, `${l.preparo.pro_labore_direto} pró-labore a confirmar`, "bg-blue-50 text-blue-800")}
                      {chip(l.preparo.sem_email_repasse ? 1 : 0, "sem e-mail do repasse", "bg-gray-100 text-gray-700")}
                    </>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {l.pend > 0 ? (
                    <form action={autorizarRepasse}>
                      <input type="hidden" name="imobiliaria_id" value={l.id} />
                      <input type="hidden" name="mes" value={mes} />
                      <button type="submit" className="rounded-lg bg-o2-navy px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">
                        Autorizar repasse
                      </button>
                    </form>
                  ) : l.autorizadas > 0 ? (
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
      <p className="text-xs text-gray-500">
        Autorizar trava os valores do lote da imobiliária (com {DESCONTO_PCT}% de desconto sobre o total) e leva para “Repasses autorizados”. Quem confirma o pagamento é o Nibo, quando o lançamento bate com o valor autorizado.
        Ainda não entram: valor fixo, estorno por endosso e dados bancários (próximas fases).
      </p>
    </main>
  );
}
