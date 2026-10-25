import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData } from "@/lib/sinistros/regras";
import { aprovarBaixa, salvarTratativa } from "./actions";

export const dynamic = "force-dynamic";

// ERP O2 — Baixa de comissão ASSISTIDA (Fase 1 do "robô de baixa", 25/10/2026).
// Cada extrato da seguradora (e-mail ou pasta do Drive) é conferido linha a linha como as baixas do Corp:
// cheia / pró-labore pago direto / estorno / divergente / não encontrada. A equipe confere o resumo e aprova;
// a aprovação grava o recebimento no ERP e a "lista pronta para o Corp" sai em planilha. Nada é escrito no Corp.

type Mensal = {
  mes: string; corretora: string | null; seguradora: string; seg_abrev: string; extratos: number; aprovados: number; so_total: number;
  linhas: number; n_cheia: number; n_pro_labore: number; n_estorno: number; n_divergente: number; n_nao_encontrada: number;
  bruto: number; imposto_pct: number; imposto: number; desconto: number; liquido_esperado: number; valor_a_baixar: number;
  pro_labore_pago_direto: number; conta_fecha: boolean; entrou_banco_valor: number | null; entrou_banco_em: string | null;
};
type Extrato = {
  id: string; seguradora: string; seg_abrev: string; corretora: string | null; mes: string; competencia: string; tipo: string; origem: string;
  leitura: string; arquivo_path: string | null; created_at: string; total_extrato: number | null; soma_linhas: number; linhas: number; conta_fecha: boolean;
  n_cheia: number; n_pro_labore: number; n_estorno: number; n_divergente: number; n_nao_encontrada: number;
  valor_cheia: number; valor_pro_labore: number; valor_tratar: number; valor_a_baixar: number; pro_labore_pago_direto: number;
  ja_baixadas_corp: number; tratar_em_aberto: number; imposto_pct: number; imposto: number; liquido_sem_desconto: number;
  baixa_aprovada_em: string | null; baixa_aprovada_por_email: string | null; entrou_banco_em: string | null; entrou_banco_valor: number | null;
};
type LinhaExtrato = {
  id: string; extrato_id: string; n: number; tipo: string | null; apolice: string | null; parcela: number | null; cliente: string | null;
  premio: number | null; valor_comissao: number | null; pct_doc: number | null; pct_recebido: number | null; valor_esperado: number | null;
  pct_pro_labore: number | null; valor_falta: number | null; conferencia: string | null; motivo_auto: string | null; ja_baixada_corp: boolean;
  documento_id: string | null; tratar_motivo: string | null; tratar_resolvido_em: string | null; tratar_por_email: string | null;
  documento: { nosso_numero_corp: number | null } | null;
};

const CLASSE: Record<string, { texto: string; cor: string }> = {
  cheia: { texto: "Cheia", cor: "bg-green-100 text-green-800" },
  pro_labore_direto: { texto: "Pró-labore conferido", cor: "bg-teal-100 text-teal-800" },
  estorno: { texto: "Estorno", cor: "bg-purple-100 text-purple-800" },
  divergente: { texto: "Divergente", cor: "bg-orange-100 text-orange-800" },
  nao_encontrada: { texto: "Não encontrada", cor: "bg-red-100 text-red-700" },
};
const PARA_TRATAR = ["estorno", "divergente", "nao_encontrada"];

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const mesTexto = (m: string) => {
  const [a, mm] = m.slice(0, 7).split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mm) - 1]}/${a}`;
};

function Chips({ e }: { e: Pick<Extrato, "n_cheia" | "n_pro_labore" | "n_estorno" | "n_divergente" | "n_nao_encontrada"> }) {
  const itens: [string, number][] = [
    ["cheia", e.n_cheia], ["pro_labore_direto", e.n_pro_labore], ["estorno", e.n_estorno], ["divergente", e.n_divergente], ["nao_encontrada", e.n_nao_encontrada],
  ];
  return (
    <span className="flex flex-wrap gap-1">
      {itens.filter(([, n]) => Number(n) > 0).map(([k, n]) => (
        <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] ${CLASSE[k].cor}`}>{CLASSE[k].texto}: <b>{n}</b></span>
      ))}
    </span>
  );
}

export default async function ErpBaixasPage({ searchParams }: { searchParams: Promise<{ erro?: string; sucesso?: string; aprovado?: string; tratar?: string }> }) {
  const { erro, sucesso, aprovado, tratar } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: mensaisBrutos }, { data: extratosBrutos }, { data: linhasBrutas }] = await Promise.all([
    supabase.from("erp_baixa_assistida_mensal").select("*").order("mes", { ascending: false }).order("seguradora").order("corretora"),
    supabase.from("erp_baixa_assistida_resumo").select("*").order("mes", { ascending: false }).order("seguradora").order("created_at"),
    supabase
      .from("erp_extrato_linhas")
      .select("id, extrato_id, n, tipo, apolice, parcela, cliente, premio, valor_comissao, pct_doc, pct_recebido, valor_esperado, pct_pro_labore, valor_falta, conferencia, motivo_auto, ja_baixada_corp, documento_id, tratar_motivo, tratar_resolvido_em, tratar_por_email, documento:erp_documentos(nosso_numero_corp)")
      .order("n")
      .limit(5000),
  ]);
  const mensais = (mensaisBrutos ?? []) as Mensal[];
  const extratos = (extratosBrutos ?? []) as Extrato[];
  const linhas = (linhasBrutas ?? []) as unknown as LinhaExtrato[];
  const linhasPorExtrato = linhas.reduce<Record<string, LinhaExtrato[]>>((acc, l) => ((acc[l.extrato_id] ??= []).push(l), acc), {});
  const extratoPorId = Object.fromEntries(extratos.map((e) => [e.id, e]));
  const meses = [...new Set(mensais.map((m) => m.mes))];

  const pendentes = extratos.filter((e) => !e.baixa_aprovada_em && e.tipo !== "resumo_mensal");
  const aprovados = extratos.filter((e) => e.baixa_aprovada_em);
  const paraTratar = linhas.filter((l) => PARA_TRATAR.includes(l.conferencia ?? "") && extratoPorId[l.extrato_id]?.baixa_aprovada_em && !l.tratar_resolvido_em);
  const tratadas = linhas.filter((l) => PARA_TRATAR.includes(l.conferencia ?? "") && l.tratar_resolvido_em).length;
  const linhasAprovadasParaCorp = linhas.filter((l) => l.conferencia !== "nao_encontrada" && extratoPorId[l.extrato_id]?.baixa_aprovada_em);

  return (
    <>
      <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-8">
        <PageHeader
          icon={<IconReport />}
          titulo="ERP O2 — Baixa de comissão assistida"
          subtitulo="Cada extrato da seguradora conferido apólice por apólice. Você confere o resumo e aprova; o ERP grava o recebimento e monta a lista para lançar no Corp."
        />
        <p className="text-sm text-gray-600">
          <Link href="/erp/conferencia" className="underline">← Conferência</Link>. Os extratos chegam de hora em hora pelo e-mail e pela pasta do Drive “BAIXA DE COMISSÃO / EXTRATOS DE COMISSÃO (o ERP lê daqui)”.
          Nada é lançado no Corp por aqui: a lista pronta sai em planilha para o financeiro (baixa pelo valor bruto, previsão de repasse dia 15 do mês seguinte).
        </p>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Não deu certo: {erro === "dados" ? "dados incompletos" : erro}</p>}
        {aprovado != null && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
            Baixa aprovada: {aprovado} recebimento(s) gravado(s) no ERP{Number(tratar) > 0 ? `; ${tratar} linha(s) foram para “Para tratar”` : ""}.
          </p>
        )}
        {sucesso && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">Salvo.</p>}

        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Como cada linha é classificada</h2>
          <ul className="grid gap-1 sm:grid-cols-2">
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.cheia.cor}`}>Cheia</span> recebido = prêmio × % de comissão do documento.</li>
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.pro_labore_direto.cor}`}>Pró-labore conferido</span> faltou exatamente o pró-labore que a seguradora paga direto à imobiliária.</li>
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.estorno.cor}`}>Estorno</span> valor negativo (endosso de cancelamento/restituição).</li>
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.divergente.cor}`}>Divergente</span> % pago diferente do documento, ou endosso.</li>
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.nao_encontrada.cor}`}>Não encontrada</span> apólice/parcela que o ERP não conhece.</li>
            <li>Ao aprovar, só <b>cheia</b> e <b>pró-labore conferido</b> viram recebimento no ERP; o resto vai para “Para tratar”. Para o Corp vale o extrato inteiro menos as não encontradas.</li>
          </ul>
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Resumo por corretora × seguradora × mês</h2>
          <p className="text-xs text-gray-500">
            Bruto = soma dos extratos do mês. Líquido esperado = bruto − imposto retido − desconto da seguradora (ex.: empréstimo Porto). “Entrou no banco” será preenchido pela integração com o Nibo.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-1">Mês</th>
                  <th className="px-2 py-1">Corretora</th>
                  <th className="px-2 py-1">Seguradora</th>
                  <th className="px-2 py-1">Extratos</th>
                  <th className="px-2 py-1">Linhas</th>
                  <th className="px-2 py-1 text-right">Bruto</th>
                  <th className="px-2 py-1 text-right">Imposto</th>
                  <th className="px-2 py-1 text-right">Desconto</th>
                  <th className="px-2 py-1 text-right">Líquido esperado</th>
                  <th className="px-2 py-1 text-right">A baixar</th>
                  <th className="px-2 py-1">Conta fecha</th>
                  <th className="px-2 py-1">Entrou no banco</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mensais.map((m) => (
                  <tr key={`${m.mes}-${m.corretora}-${m.seg_abrev}`}>
                    <td className="px-2 py-1">{mesTexto(m.mes)}</td>
                    <td className="px-2 py-1">{m.corretora ?? "—"}</td>
                    <td className="px-2 py-1">{m.seguradora}</td>
                    <td className="px-2 py-1">
                      {m.aprovados}/{m.extratos - m.so_total} aprovados{m.so_total > 0 ? <span className="text-gray-400"> · só total do mês</span> : null}
                    </td>
                    <td className="px-2 py-1"><Chips e={m} /></td>
                    <td className="px-2 py-1 text-right">{brl(m.bruto)}</td>
                    <td className="px-2 py-1 text-right">{brl(m.imposto)} <span className="text-gray-400">({pct(m.imposto_pct)})</span></td>
                    <td className="px-2 py-1 text-right">{Number(m.desconto) ? brl(m.desconto) : "—"}</td>
                    <td className="px-2 py-1 text-right font-semibold">{brl(m.liquido_esperado)}</td>
                    <td className="px-2 py-1 text-right">{m.so_total === m.extratos ? "—" : brl(m.valor_a_baixar)}</td>
                    <td className="px-2 py-1">{m.so_total === m.extratos ? <span className="text-gray-400">só total</span> : m.conta_fecha ? <span className="text-green-700">✓</span> : <span className="font-semibold text-red-700">não fecha</span>}</td>
                    <td className="px-2 py-1">{m.entrou_banco_valor != null ? `${brl(m.entrou_banco_valor)} em ${formatarData(m.entrou_banco_em ?? "")}` : <span className="text-gray-400">aguardando Nibo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Extratos pendentes de baixa ({pendentes.length})</h2>
          <p className="text-xs text-gray-500">Abra o extrato para ver linha a linha. “Já baixada no Corp” = a parcela já aparece nas comissões recebidas do Corp (não lançar de novo).</p>
          {meses.map((mes) => {
            const doMes = pendentes.filter((e) => e.mes === mes);
            if (doMes.length === 0) return null;
            return (
              <div key={mes} className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-700">{mesTexto(mes)}</h3>
                {doMes.map((e) => (
                  <ExtratoCard key={e.id} e={e} linhas={linhasPorExtrato[e.id] ?? []} />
                ))}
              </div>
            );
          })}
          {pendentes.length === 0 && <p className="text-xs text-green-700">Nenhum extrato pendente.</p>}
          {extratos.some((e) => e.tipo === "resumo_mensal") && (
            <p className="text-[11px] text-gray-500">
              Tokio manda por e-mail só o total do mês (sem apólices): aparece no resumo acima, mas não tem linhas para aprovar. O extrato por apólice da Tokio deve ser baixado do portal e colocado na pasta do Drive.
            </p>
          )}
        </section>

        <section id="para-tratar" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Para tratar ({paraTratar.length})</h2>
          <p className="text-xs text-gray-500">
            Linhas de extratos já aprovados que não viraram baixa (estorno, divergente, não encontrada). Escreva o motivo/o que foi feito e marque “resolvida”. {tratadas} já resolvida(s).
          </p>
          {paraTratar.length === 0 ? (
            <p className="text-xs text-green-700">Nada para tratar.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-2 py-1">Classificação</th>
                    <th className="px-2 py-1">Seg.</th>
                    <th className="px-2 py-1">Nº Corp</th>
                    <th className="px-2 py-1">Apólice</th>
                    <th className="px-2 py-1">Parc.</th>
                    <th className="px-2 py-1 text-right">Valor</th>
                    <th className="px-2 py-1 text-right">Esperado</th>
                    <th className="px-2 py-1">Por quê</th>
                    <th className="px-2 py-1">Motivo / tratativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paraTratar.map((l) => (
                    <tr key={l.id}>
                      <td className="px-2 py-1"><span className={`rounded-full px-2 py-0.5 ${CLASSE[l.conferencia ?? ""]?.cor}`}>{CLASSE[l.conferencia ?? ""]?.texto}</span></td>
                      <td className="px-2 py-1">{extratoPorId[l.extrato_id]?.seg_abrev}</td>
                      <td className="px-2 py-1">{l.documento_id ? <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">{l.documento?.nosso_numero_corp ?? "ver"}</Link> : "—"}</td>
                      <td className="px-2 py-1">{l.apolice}</td>
                      <td className="px-2 py-1">{l.parcela ?? "—"}</td>
                      <td className="px-2 py-1 text-right">{brl(l.valor_comissao)}</td>
                      <td className="px-2 py-1 text-right">{brl(l.valor_esperado)}</td>
                      <td className="max-w-[220px] px-2 py-1 text-gray-600">{l.motivo_auto}</td>
                      <td className="px-2 py-1">
                        <form action={salvarTratativa} className="flex items-center gap-1">
                          <input type="hidden" name="linha_id" value={l.id} />
                          <input name="tratar_motivo" defaultValue={l.tratar_motivo ?? ""} placeholder="ex.: restituição lançada no Corp" className="w-56 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                          <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" name="resolvido" /> resolvida</label>
                          <button className="rounded bg-o2-navy px-2 py-0.5 text-white">Salvar</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Lista pronta para o Corp</h2>
          <p className="text-xs text-gray-500">
            Tudo o que o InCorp do Corp aceita dos extratos aprovados (apólices e endossos/estornos; divergentes vão marcados para conferir), na ordem Seguradora → Nosso Nº → Parcela, com valor bruto,
            data de recebimento e previsão de repasse (dia 15 do mês seguinte). Ficam de fora só as “não encontradas” (= linhas amarelas do InCorp, pendência de cadastro/emissão).
            Tokio, Porto, Pottencial e Too: lançar pelo InCorp com o arquivo original e usar a lista para conferir; as demais seguradoras, à mão. Abre no Excel. {linhasAprovadasParaCorp.length} linha(s) aprovada(s), {linhasAprovadasParaCorp.filter((l) => l.ja_baixada_corp).length} já baixada(s) no Corp.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <a href="/erp/baixas/lista-corp" className="rounded-lg bg-o2-navy px-3 py-1.5 text-white">Baixar lista completa (CSV)</a>
            <a href="/erp/baixas/lista-corp?pendentes_corp=1" className="rounded-lg border border-o2-navy px-3 py-1.5 text-o2-navy">Só o que ainda não está baixado no Corp</a>
            {meses.map((m) => (
              <a key={m} href={`/erp/baixas/lista-corp?mes=${m.slice(0, 7)}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700">{mesTexto(m)}</a>
            ))}
          </div>
        </section>

        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Baixas aprovadas ({aprovados.length})</h2>
          {aprovados.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhuma ainda.</p>
          ) : (
            aprovados.map((e) => <ExtratoCard key={e.id} e={e} linhas={linhasPorExtrato[e.id] ?? []} />)
          )}
        </section>
      </main>
    </>
  );
}

// Manual BAIXA DE COMISSÃO: Pottencial só a partir do dia 26 (ou com pagamento confirmado pelo financeiro);
// Too (e saúde) só depois da NF emitida e do dinheiro na conta. Aviso, não bloqueio.
function quandoBaixar(e: Extrato): string | null {
  if (e.entrou_banco_valor != null) return null;
  if (e.seg_abrev === "POTT") {
    const hoje = new Date();
    const [a, m] = e.mes.split("-").map(Number);
    if (hoje < new Date(a, m - 1, 26)) return "Pottencial: pelo manual, baixar só a partir do dia 26 ou quando o financeiro confirmar o pagamento.";
    return null;
  }
  if (e.seg_abrev === "TOO") return "Too: pelo manual, baixar só depois da NF emitida e do dinheiro na conta (confirmar com o financeiro).";
  return null;
}

function ExtratoCard({ e, linhas }: { e: Extrato; linhas: LinhaExtrato[] }) {
  return (
    <details id={`extrato-${e.id}`} className="rounded-lg border border-gray-200">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
        <span className="font-semibold text-o2-navy">{e.seguradora}</span>
        <span>{e.corretora ?? "corretora ?"}</span>
        <span className="text-gray-500">{e.origem === "drive" ? "pasta do Drive" : "e-mail"} · {e.arquivo_path ?? "—"}</span>
        <Chips e={e} />
        <span>
          Soma {brl(e.soma_linhas)} × extrato {brl(e.total_extrato)}{" "}
          {e.conta_fecha ? <span className="text-green-700">✓ fecha</span> : <span className="font-semibold text-red-700">não fecha</span>}
        </span>
        <span>Imposto {brl(e.imposto)} · líquido {brl(e.liquido_sem_desconto)}</span>
        <span className="font-semibold">A baixar {brl(e.valor_a_baixar)}</span>
        {e.ja_baixadas_corp > 0 && <span className="text-gray-500">{e.ja_baixadas_corp} já baixada(s) no Corp</span>}
        <span className="text-gray-400">{e.entrou_banco_valor != null ? `banco: ${brl(e.entrou_banco_valor)}` : "banco: aguardando Nibo"}</span>
      </summary>
      <div className="space-y-2 border-t border-gray-100 p-3">
        {e.baixa_aprovada_em ? (
          <p className="text-xs text-green-800">
            Baixa aprovada por {e.baixa_aprovada_por_email ?? "—"} em {new Date(e.baixa_aprovada_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
          </p>
        ) : (
          <>
          {quandoBaixar(e) && <p className="rounded bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800">{quandoBaixar(e)}</p>}
          <form action={aprovarBaixa} className="flex items-center gap-3">
            <input type="hidden" name="extrato_id" value={e.id} />
            <button className="rounded-lg bg-o2-coral px-3 py-1.5 text-xs font-semibold text-white">Aprovar baixa</button>
            <span className="text-[11px] text-gray-500">
              Grava {e.n_cheia + e.n_pro_labore} recebimento(s) ({brl(e.valor_a_baixar)}) no ERP e quita as parcelas; {e.n_estorno + e.n_divergente + e.n_nao_encontrada} linha(s) vão para “Para tratar”.
            </span>
          </form>
          </>
        )}
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Classificação</th>
                <th className="px-2 py-1">Nº Corp</th>
                <th className="px-2 py-1">Apólice</th>
                <th className="px-2 py-1">Parc.</th>
                <th className="px-2 py-1 text-right">Prêmio</th>
                <th className="px-2 py-1 text-right">% doc</th>
                <th className="px-2 py-1 text-right">% pago</th>
                <th className="px-2 py-1 text-right">Recebido</th>
                <th className="px-2 py-1 text-right">Esperado</th>
                <th className="px-2 py-1">Obs.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map((l) => (
                <tr key={l.id}>
                  <td className="px-2 py-1 text-gray-400">{l.n}</td>
                  <td className="px-2 py-1"><span className={`rounded-full px-2 py-0.5 ${CLASSE[l.conferencia ?? ""]?.cor ?? "bg-gray-100"}`}>{CLASSE[l.conferencia ?? ""]?.texto ?? "—"}</span></td>
                  <td className="px-2 py-1">{l.documento_id ? <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">{l.documento?.nosso_numero_corp ?? "ver"}</Link> : "—"}</td>
                  <td className="px-2 py-1">{l.apolice}</td>
                  <td className="px-2 py-1">{l.parcela ?? "—"}</td>
                  <td className="px-2 py-1 text-right">{brl(l.premio)}</td>
                  <td className="px-2 py-1 text-right">{pct(l.pct_doc)}</td>
                  <td className="px-2 py-1 text-right">{pct(l.pct_recebido)}</td>
                  <td className="px-2 py-1 text-right">{brl(l.valor_comissao)}</td>
                  <td className="px-2 py-1 text-right">{brl(l.valor_esperado)}</td>
                  <td className="px-2 py-1 text-gray-500">
                    {l.motivo_auto ?? (l.conferencia === "pro_labore_direto" ? `pró-labore ${pct(l.pct_pro_labore)} pago direto à imob` : "")}
                    {l.ja_baixada_corp ? <span className="ml-1 rounded bg-gray-100 px-1">já baixada no Corp</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
