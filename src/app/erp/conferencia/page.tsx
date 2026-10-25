import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { signOut } from "../../actions";

export const dynamic = "force-dynamic";

// ERP O2 — Fase 0: conferência da carga contra o retrato do Power BI
// (view erp_conferencia_corp). Só as células que diferem; o resto bate.

type Linha = {
  mes: string;
  ramo: string | null;
  seg: string | null;
  corp_docs: number | null;
  erp_docs: number | null;
  corp_comissao: number | null;
  erp_comissao: number | null;
  dif_docs: number;
  dif_comissao: number;
};

// Alertas de fatura (Matheus 25/10): proposta efetivada em modo fatura tem de entrar na fatura;
// a seguradora dá destino em ~10 dias. Regras de corte = hipótese até dez/2026 (Tokio e Pottencial).
type AlertaFatura = {
  documento_id: string;
  codigo_o2: number;
  nosso_numero_corp: number | null;
  numero_apolice: string | null;
  situacao: string;
  vigencia_inicio: string | null;
  efetivacao: string | null;
  imobiliaria: string;
  seguradora: string;
  fatura_prevista: string | null;
  fatura_carregada_vencimento: string | null;
  alerta: string;
  gerado_em: string;
};
const ROTULO_ALERTA: Record<string, { texto: string; cor: string }> = {
  fora_da_fatura: { texto: "Efetivado e FORA da fatura carregada", cor: "bg-red-100 text-red-700" },
  sem_destino_seguradora: { texto: "Sem destino da seguradora há mais de 10 dias", cor: "bg-orange-100 text-orange-800" },
  fatura_prevista_nao_carregada: { texto: "Fatura prevista já venceu e não foi carregada", cor: "bg-yellow-100 text-yellow-800" },
  relatorio_incompleto: { texto: "Relatório da fatura cortado na leitura (conferir à mão)", cor: "bg-gray-200 text-gray-700" },
};

// Fora das últimas faturas (Matheus 25/10): cruzando as últimas faturas de cada imob×seguradora
// descobre-se quem é da fatura (vira forma de pagamento = fatura) e quem ficou de fora mesmo
// tendo parcela na janela → candidato a outra forma de pagamento; confirmar no extrato de comissão.
type ForaFatura = {
  documento_id: string;
  codigo_o2: number;
  nosso_numero_corp: number | null;
  numero_apolice: string | null;
  imobiliaria: string;
  seguradora: string;
  produto: string;
  vigencia_inicio: string | null;
  faturas_carregadas: number;
  parcela_na_janela: string | null;
  no_extrato: boolean;
};

// Extratos de comissão (ERP Fase 2, 25/10): Pottencial e Too mandam planilha por apólice × parcela;
// Tokio só o total do mês; Porto/Yelum só no portal. Linhas casadas por nº de apólice (erp_cruzar_extratos).
type ExtratoResumo = {
  seguradora: string;
  tipo: string;
  competencia: string | null;
  total_bruto: number | null;
  observacao: string | null;
  created_at: string;
  linhas: number;
  casadas: number;
  parcelas: number;
};

export default async function ErpConferenciaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: todas }, { data: difs }, { data: alertasBrutos, error: erroAlertas }, { data: todosAlertas }, { data: foraBrutos, error: erroFora }, { data: extratosBrutos }, { data: recebimentos }] = await Promise.all([
    supabase.from("erp_conferencia_corp").select("mes", { count: "exact", head: true }),
    supabase.from("erp_conferencia_corp").select("*").or("dif_docs.neq.0,dif_comissao.gte.0.01,dif_comissao.lte.-0.01").order("mes", { ascending: false }),
    supabase
      .from("erp_alertas_fatura_pronto")
      .select("documento_id, codigo_o2, nosso_numero_corp, numero_apolice, situacao, vigencia_inicio, efetivacao, imobiliaria, seguradora, fatura_prevista, fatura_carregada_vencimento, alerta, gerado_em")
      .in("alerta", ["fora_da_fatura", "sem_destino_seguradora", "fatura_prevista_nao_carregada", "relatorio_incompleto"])
      .order("fatura_prevista", { ascending: false })
      .limit(300),
    supabase.rpc("erp_contar_alertas_fatura"),
    supabase.from("erp_fora_faturas_pronto").select("documento_id, codigo_o2, nosso_numero_corp, numero_apolice, imobiliaria, seguradora, produto, vigencia_inicio, faturas_carregadas, parcela_na_janela, no_extrato").order("seguradora").order("imobiliaria").limit(400),
    supabase.from("erp_extratos_resumo").select("*").order("created_at", { ascending: false }).limit(40),
    supabase.from("erp_comissao_recebimentos").select("diferenca").limit(5000),
  ]);
  const diferencas = (difs ?? []) as Linha[];
  if (erroAlertas) console.error("erp_alertas_fatura:", erroAlertas.message);
  const alertas = (alertasBrutos ?? []) as AlertaFatura[];
  const contagemAlertas = ((todosAlertas ?? []) as { alerta: string; n: number }[]).reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.alerta]: Number(a.n) }), {});
  void todas;
  const fora = (foraBrutos ?? []) as ForaFatura[];
  if (erroFora) console.error("erp_fora_das_ultimas_faturas:", erroFora.message);
  const extratos = (extratosBrutos ?? []) as ExtratoResumo[];
  const difRecebimentos = ((recebimentos ?? []) as { diferenca: number | null }[]).map((r) => Number(r.diferenca ?? 0));
  const recebIguais = difRecebimentos.filter((d) => Math.abs(d) < 0.05).length;
  const recebMenos = difRecebimentos.filter((d) => d <= -0.05).length;
  const recebMais = difRecebimentos.filter((d) => d >= 0.05).length;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-[1100px] flex-1 space-y-6 p-8">
        <PageHeader
          icon={<IconReport />}
          titulo="ERP O2 — Conferência com o Corp"
          subtitulo="Documentos e comissão por mês × ramo × seguradora: ERP contra o retrato congelado do Power BI. Só o que difere aparece."
        />
        <p className="text-sm text-gray-600">
          <Link href="/erp/documentos" className="underline">← Documentos</Link>. As diferenças abaixo são, em regra, alterações que o próprio Corp fez depois do fechamento do mês
          (cancelamentos e ajustes registrados em <code>corp_alteracoes_pos_fechamento</code>); contra a grade viva do Corp o ERP bate em todas as células.
        </p>
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Alertas de fatura (Tokio e Pottencial)</h2>
          <p className="text-xs text-gray-500">
            Seguro novo de imobiliária com fatura: pela regra de corte (hipótese até dez/2026) ele tem uma fatura prevista. Alerta quando a fatura carregada não o contém, quando a seguradora não deu destino em 10 dias, ou quando a fatura prevista venceu e ainda não foi carregada no /faturas.
            {alertas[0]?.gerado_em ? ` Lista gerada ${formatarData(alertas[0].gerado_em)} (atualiza de hora em hora).` : ""}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(ROTULO_ALERTA).map(([k, v]) => (
              <span key={k} className={`rounded-full px-2 py-0.5 ${v.cor}`}>
                {v.texto}: <b>{contagemAlertas[k] ?? 0}</b>
              </span>
            ))}
          </div>
          {erroAlertas && <p className="text-xs text-red-700">Não consegui ler os alertas: {erroAlertas.message}</p>}
          <p className="text-[11px] text-gray-500">
            Sem alerta: {contagemAlertas.ok ?? 0} na fatura · {contagemAlertas.aguardando_fatura ?? 0} aguardando a fatura prevista.{alertas.length === 300 ? " Lista abaixo limitada aos 300 mais recentes." : ""}
          </p>
          {alertas.length === 0 ? (
            <p className="text-xs text-green-700">Nenhum alerta.</p>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-2 py-1">Alerta</th>
                    <th className="px-2 py-1">Código O2</th>
                    <th className="px-2 py-1">Nº Corp</th>
                    <th className="px-2 py-1">Imobiliária</th>
                    <th className="px-2 py-1">Seg.</th>
                    <th className="px-2 py-1">Situação</th>
                    <th className="px-2 py-1">Início vig.</th>
                    <th className="px-2 py-1">Efetivação</th>
                    <th className="px-2 py-1">Fatura prevista</th>
                    <th className="px-2 py-1">Fatura carregada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {alertas.map((a) => (
                    <tr key={a.documento_id}>
                      <td className="px-2 py-1">
                        <span className={`rounded-full px-2 py-0.5 ${ROTULO_ALERTA[a.alerta]?.cor ?? "bg-gray-100"}`}>{ROTULO_ALERTA[a.alerta]?.texto ?? a.alerta}</span>
                      </td>
                      <td className="px-2 py-1">
                        <Link href={`/erp/documentos/${a.documento_id}`} className="text-o2-navy hover:underline">
                          {a.codigo_o2}
                        </Link>
                      </td>
                      <td className="px-2 py-1 text-gray-500">{a.nosso_numero_corp ?? "—"}</td>
                      <td className="px-2 py-1">{a.imobiliaria}</td>
                      <td className="px-2 py-1">{a.seguradora}</td>
                      <td className="px-2 py-1">{a.situacao}</td>
                      <td className="px-2 py-1">{formatarData(a.vigencia_inicio)}</td>
                      <td className="px-2 py-1">{formatarData(a.efetivacao)}</td>
                      <td className="px-2 py-1">{formatarData(a.fatura_prevista)}</td>
                      <td className="px-2 py-1">{formatarData(a.fatura_carregada_vencimento)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Fora das últimas faturas ({fora.length})</h2>
          <p className="text-xs text-gray-500">
            Cruzamento das últimas faturas carregadas de cada imobiliária × seguradora (Tokio, Pottencial, Too, Yelum): quem apareceu em alguma fatura ficou com forma de pagamento “fatura”.
            Aqui estão as apólices com parcela vencendo na janela dessas faturas que não apareceram em nenhuma delas (imobiliárias com 2+ faturas carregadas) — candidatas a boleto/cartão, a confirmar no extrato de comissão.
          </p>
          {fora.length === 0 ? (
            <p className="text-xs text-green-700">Nenhuma apólice fora das faturas.</p>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-2 py-1">Código O2</th>
                    <th className="px-2 py-1">Nº Corp</th>
                    <th className="px-2 py-1">Apólice</th>
                    <th className="px-2 py-1">Imobiliária</th>
                    <th className="px-2 py-1">Seg.</th>
                    <th className="px-2 py-1">Produto</th>
                    <th className="px-2 py-1">Início vig.</th>
                    <th className="px-2 py-1">Parcela na janela</th>
                    <th className="px-2 py-1">Faturas conferidas</th>
                    <th className="px-2 py-1">No extrato?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {fora.map((f) => (
                    <tr key={f.documento_id}>
                      <td className="px-2 py-1">
                        <Link href={`/erp/documentos/${f.documento_id}`} className="text-o2-navy hover:underline">{f.codigo_o2}</Link>
                      </td>
                      <td className="px-2 py-1 text-gray-500">{f.nosso_numero_corp ?? "—"}</td>
                      <td className="px-2 py-1">{f.numero_apolice}</td>
                      <td className="px-2 py-1">{f.imobiliaria}</td>
                      <td className="px-2 py-1">{f.seguradora}</td>
                      <td className="px-2 py-1">{f.produto}</td>
                      <td className="px-2 py-1">{formatarData(f.vigencia_inicio)}</td>
                      <td className="px-2 py-1">{formatarData(f.parcela_na_janela)}</td>
                      <td className="px-2 py-1">{f.faturas_carregadas}</td>
                      <td className="px-2 py-1">{f.no_extrato ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">sim · pago fora da fatura</span> : <span className="text-gray-400">não</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Extratos de comissão das seguradoras</h2>
          <p className="text-xs text-gray-500">
            Lidos do e-mail de hora em hora: Pottencial (demonstrativo mensal, 1 linha por apólice × parcela) e Too (demonstrativo semanal). Tokio só manda o total do mês; Porto e Yelum não mandam extrato por e-mail (só no portal).
            Cada linha é casada com o documento e a parcela do ERP e vira um recebimento de comissão conferido contra o previsto.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">Comissão igual ao previsto: <b>{recebIguais}</b></span>
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-800">Recebeu menos (estorno/ajuste): <b>{recebMenos}</b></span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">Recebeu mais: <b>{recebMais}</b></span>
          </div>
          {extratos.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhum extrato carregado ainda.</p>
          ) : (
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-2 py-1">Seguradora</th>
                    <th className="px-2 py-1">Tipo</th>
                    <th className="px-2 py-1">Competência</th>
                    <th className="px-2 py-1">Total bruto</th>
                    <th className="px-2 py-1">Linhas</th>
                    <th className="px-2 py-1">Casadas</th>
                    <th className="px-2 py-1">Com parcela</th>
                    <th className="px-2 py-1">Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {extratos.map((e, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">{e.seguradora}</td>
                      <td className="px-2 py-1">{e.tipo === "resumo_mensal" ? "só total do mês" : "demonstrativo"}</td>
                      <td className="px-2 py-1">{e.competencia ? e.competencia.slice(0, 7) : "—"}</td>
                      <td className="px-2 py-1">{e.total_bruto != null ? Number(e.total_bruto).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</td>
                      <td className="px-2 py-1">{e.linhas}</td>
                      <td className="px-2 py-1">{e.casadas}</td>
                      <td className="px-2 py-1">{e.parcelas}</td>
                      <td className="max-w-[320px] truncate px-2 py-1 text-gray-500" title={e.observacao ?? ""}>{e.observacao ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Conferência com o retrato do Power BI</h2>
        {diferencas.length === 0 ? (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">Nenhuma diferença.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Mês</th>
                  <th className="px-3 py-2">Ramo</th>
                  <th className="px-3 py-2">Seg.</th>
                  <th className="px-3 py-2 text-right">Docs Corp</th>
                  <th className="px-3 py-2 text-right">Docs ERP</th>
                  <th className="px-3 py-2 text-right">Dif.</th>
                  <th className="px-3 py-2 text-right">Comissão Corp</th>
                  <th className="px-3 py-2 text-right">Comissão ERP</th>
                  <th className="px-3 py-2 text-right">Dif.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {diferencas.map((l) => (
                  <tr key={`${l.mes}-${l.ramo}-${l.seg}`}>
                    <td className="px-3 py-1.5">{l.mes.slice(0, 7)}</td>
                    <td className="px-3 py-1.5">{l.ramo}</td>
                    <td className="px-3 py-1.5">{l.seg}</td>
                    <td className="px-3 py-1.5 text-right">{l.corp_docs ?? 0}</td>
                    <td className="px-3 py-1.5 text-right">{l.erp_docs ?? 0}</td>
                    <td className={`px-3 py-1.5 text-right ${l.dif_docs ? "font-semibold" : ""}`}>{l.dif_docs}</td>
                    <td className="px-3 py-1.5 text-right">{formatarReais(l.corp_comissao ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right">{formatarReais(l.erp_comissao ?? 0)}</td>
                    <td className={`px-3 py-1.5 text-right ${Math.abs(l.dif_comissao) >= 0.01 ? "font-semibold" : ""}`}>{formatarReais(l.dif_comissao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
