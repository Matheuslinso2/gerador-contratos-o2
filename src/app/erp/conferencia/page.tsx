import Link from "next/link";
import { lerFiltros, limitesMes, SEGURADORA_FATURA } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";

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
  corretora: string | null;
  origem: string;
  leitura: string;
  tipo: string;
  competencia: string | null;
  total_bruto: number | null;
  observacao: string | null;
  created_at: string;
  linhas: number;
  casadas: number;
  parcelas: number;
};

// Baixa de comissão (ERP Fase 2, 25/10): Corp → Comissões → Recebidas (data de quitação), por mês × corretora ×
// seguradora, no formato da planilha CONTROLE BAIXA: bruto → imposto → desconto (empréstimo Porto) → líquido esperado.
// "Pró-labore pago direto" = fatia que Tokio/Yelum pagam direto à imobiliária (não é divergência).
type BaixaMensal = {
  mes: string; corretora: string; seguradora: string; linhas: number; bruto: number; premiacao: number | null;
  imposto_pct: number; imposto: number; desconto: number; liquido_esperado: number; pro_labore_pago_direto: number | null; gerado_em: string;
  linhas_divergentes: number; divergencia: number | null; media_3m: number | null;
};
type BaixaAtraso = { mes: string; corretora: string; seguradora: string; bruto: number; media_3m: number; situacao: string };
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export const metadata = { title: "Conferência" };

export default async function ErpConferenciaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  // etapas do processo (Matheus 26/10): esta tela serve a duas etapas — "Faturas" (/erp/faturas, alertas e fora das
  // faturas) e "Baixa de comissão" (/erp/conferencia: baixa mensal, atraso, estornos de endosso, extratos, Power BI)
  const secao: "faturas" | "baixa" = sp.secao === "faturas" ? "faturas" : "baixa";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  // filtros padronizados do ERP: cada seção aplica os níveis que tem (seguradora, corretora, imobiliária, mês)
  const { data: segFiltro } = f.seguradora ? await supabase.from("erp_seguradoras").select("nome").eq("abreviacao", f.seguradora).maybeSingle() : { data: null };
  const segFatura = f.seguradora ? SEGURADORA_FATURA[f.seguradora] ?? "—" : null;
  const mes = f.mes ? limitesMes(f.mes) : null;
  const imobLike = f.imobiliaria ? `%${f.imobiliaria.replace(/[%_,()]/g, "")}%` : null;

  let qConf = supabase.from("erp_conferencia_corp_pronto").select("*").order("mes", { ascending: false });
  if (f.seguradora) qConf = qConf.eq("seg", f.seguradora);
  if (mes) qConf = qConf.eq("mes", mes.de);

  let qAlertas = supabase
    .from("erp_alertas_fatura_pronto")
    .select("documento_id, codigo_o2, nosso_numero_corp, numero_apolice, situacao, vigencia_inicio, efetivacao, imobiliaria, seguradora, fatura_prevista, fatura_carregada_vencimento, alerta, gerado_em")
    .in("alerta", ["fora_da_fatura", "sem_destino_seguradora", "fatura_prevista_nao_carregada", "relatorio_incompleto"]);
  if (segFatura) qAlertas = qAlertas.eq("seguradora", segFatura);
  if (imobLike) qAlertas = qAlertas.ilike("imobiliaria", imobLike);
  if (mes) qAlertas = qAlertas.gte("fatura_prevista", mes.de).lte("fatura_prevista", mes.ate);

  let qFora = supabase.from("erp_fora_faturas_pronto").select("documento_id, codigo_o2, nosso_numero_corp, numero_apolice, imobiliaria, seguradora, produto, vigencia_inicio, faturas_carregadas, parcela_na_janela, no_extrato");
  if (segFatura) qFora = qFora.eq("seguradora", segFatura);
  if (imobLike) qFora = qFora.ilike("imobiliaria", imobLike);

  let qExtratos = supabase.from("erp_extratos_resumo").select("*");
  if (f.seguradora) qExtratos = qExtratos.eq("seguradora", segFiltro?.nome ?? "—");
  if (f.corretora) qExtratos = qExtratos.eq("corretora", f.corretora);
  if (mes) qExtratos = qExtratos.eq("competencia", mes.de);

  let qBaixa = supabase.from("erp_baixa_corp_mensal_pronto").select("*");
  qBaixa = mes ? qBaixa.eq("mes", mes.de) : qBaixa.gte("mes", new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1).toISOString().slice(0, 10));
  if (f.seguradora) qBaixa = qBaixa.eq("seguradora", f.seguradora === "ALF" ? "ALFA" : f.seguradora);
  if (f.corretora) qBaixa = qBaixa.eq("corretora", f.corretora);

  let qAtraso = supabase.from("erp_baixa_corp_atraso_pronto").select("mes, corretora, seguradora, bruto, media_3m, situacao");
  if (f.seguradora) qAtraso = qAtraso.eq("seguradora", f.seguradora === "ALF" ? "ALFA" : f.seguradora);
  if (f.corretora) qAtraso = qAtraso.eq("corretora", f.corretora);
  if (mes) qAtraso = qAtraso.eq("mes", mes.de);

  // estornos de endosso (linha negativa do extrato × endosso do ERP): lista pronta refeita de hora em hora
  let qEstornos = supabase.from("erp_estornos_endosso_pronto").select("alerta, seguradora, codigo_o2, documento_id, apolice, endosso, cliente, valor, data_ref, gerado_em");
  if (segFiltro?.nome) qEstornos = qEstornos.ilike("seguradora", `${segFiltro.nome.split(" ")[0]}%`);
  if (mes) qEstornos = qEstornos.gte("data_ref", mes.de).lte("data_ref", mes.ate);

  const [{ data: difs }, { data: alertasBrutos, error: erroAlertas }, { data: todosAlertas }, { data: foraBrutos, error: erroFora }, { data: extratosBrutos }, { data: pendentesBaixa }, { data: baixasBrutas }, { data: atrasosBrutos }, { data: estornosBrutos }, { data: semMaeBrutos }] = await Promise.all([
    // tabela pronta (só as células que diferem), refeita a cada carga do robô do Corp — premissa de desempenho do ERP
    qConf,
    qAlertas.order("fatura_prevista", { ascending: false }).limit(300),
    supabase.rpc("erp_contar_alertas_fatura"),
    qFora.order("seguradora").order("imobiliaria").limit(400),
    qExtratos.order("created_at", { ascending: false }).limit(40),
    supabase.from("erp_baixa_assistida_resumo").select("id, n_cheia, n_pro_labore, n_estorno, n_divergente, n_nao_encontrada").is("baixa_aprovada_em", null).neq("tipo", "resumo_mensal"),
    qBaixa.order("mes", { ascending: false }).order("corretora").order("seguradora"),
    qAtraso.order("mes", { ascending: false }).order("media_3m", { ascending: false }),
    qEstornos.order("data_ref", { ascending: false }).limit(300),
    // endossos sem apólice-mãe (a ligação automática não resolveu): revisão manual na ficha do endosso. Desde 2021 —
    // os de 2020 são de apólices anteriores à base do Corp no ERP.
    (() => {
      let q = supabase
        .from("erp_documentos")
        .select("id, nosso_numero, tipo, numero_apolice, numero_endosso, vigencia_inicio, premio_liquido, seguradora:erp_seguradoras(nome), cliente:locatarios(nome)")
        .in("tipo", ["C", "D", "I", "M", "R", "X"])
        .is("documento_pai_id", null)
        .gte("vigencia_inicio", "2021-01-01");
      if (mes) q = q.gte("vigencia_inicio", mes.de).lte("vigencia_inicio", mes.ate);
      return q.order("vigencia_inicio", { ascending: false }).limit(300);
    })(),
  ]);
  type SemMae = { id: string; nosso_numero: number; tipo: string; numero_apolice: string | null; numero_endosso: string | null; vigencia_inicio: string | null; premio_liquido: number; seguradora: { nome: string } | null; cliente: { nome: string } | null };
  const semMae = ((semMaeBrutos ?? []) as unknown as SemMae[]).filter((e) => !segFiltro?.nome || e.seguradora?.nome === segFiltro.nome);
  type Estorno = { alerta: string; seguradora: string | null; codigo_o2: number | null; documento_id: string | null; apolice: string | null; endosso: string | null; cliente: string | null; valor: number; data_ref: string | null; gerado_em: string };
  const estornos = (estornosBrutos ?? []) as Estorno[];
  const estornoSemEndosso = estornos.filter((e) => e.alerta === "estorno_sem_endosso");
  const endossoSemEstorno = estornos.filter((e) => e.alerta === "endosso_sem_estorno");
  const diferencas = (difs ?? []) as Linha[];
  if (erroAlertas) console.error("erp_alertas_fatura:", erroAlertas.message);
  const alertas = (alertasBrutos ?? []) as AlertaFatura[];
  const contagemAlertas = ((todosAlertas ?? []) as { alerta: string; n: number }[]).reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.alerta]: Number(a.n) }), {});
  const fora = (foraBrutos ?? []) as ForaFatura[];
  if (erroFora) console.error("erp_fora_das_ultimas_faturas:", erroFora.message);
  const extratos = (extratosBrutos ?? []) as ExtratoResumo[];
  const baixas = (baixasBrutas ?? []) as BaixaMensal[];
  const mesesBaixa = [...new Set(baixas.map((b) => b.mes))];
  const atrasos = (atrasosBrutos ?? []) as BaixaAtraso[];
  const mesesAtraso = [...new Set(atrasos.map((a) => a.mes))];
  type Pend = { n_cheia: number; n_pro_labore: number; n_estorno: number; n_divergente: number; n_nao_encontrada: number };
  const pend = (pendentesBaixa ?? []) as Pend[];
  const somaPend = (k: keyof Pend) => pend.reduce((s, p) => s + Number(p[k] ?? 0), 0);

  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-6 p-8">
        <PageHeader
          icon={<IconReport />}
          titulo={secao === "faturas" ? "ERP O2 — Faturas" : "ERP O2 — Conferência da baixa de comissão"}
          subtitulo={
            secao === "faturas"
              ? "Apólices que deveriam estar na fatura da imobiliária e não estão, por seguradora. A tela de cada fatura (movimento mês a mês e conferência tripla) vem na próxima fase."
              : "Baixa do Corp no formato da planilha CONTROLE BAIXA, baixa atrasada, estornos de endosso, extratos das seguradoras e conferência com o Power BI."
          }
        />
        <FiltrosErp
          caminho={secao === "faturas" ? "/erp/faturas" : "/erp/conferencia"}
          campos={secao === "faturas" ? ["seguradora", "imobiliaria", "mes"] : ["seguradora", "corretora", "mes"]}
          valores={f}
          resumo="Os filtros valem para todas as seções abaixo, em cada uma no nível que ela tem (ex.: imobiliária só nas seções de fatura; corretora nas de baixa e extratos)."
        />
        {secao === "baixa" && (
        <p className="text-sm text-gray-600">
          <Link href="/erp/baixas" className="underline">← Baixa assistida</Link>. As diferenças abaixo são, em regra, alterações que o próprio Corp fez depois do fechamento do mês
          (cancelamentos e ajustes registrados em <code>corp_alteracoes_pos_fechamento</code>); contra a grade viva do Corp o ERP bate em todas as células.
        </p>
        )}
        {secao === "faturas" && (<>
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

        </>)}
        {secao === "baixa" && (<>
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Baixa de comissão (Corp) — formato da planilha CONTROLE BAIXA</h2>
          <p className="text-xs text-gray-500">
            Corp → Comissões → Recebidas, por data de quitação, exportado pelo robô do Corp (12h e 20h). O2 Capitalização = ramos 2FIA/2IMO/2POR, CAP2 e premiação (PREM).
            Líquido esperado = bruto − imposto retido − desconto da seguradora (empréstimo da Porto). Cada baixa é conferida apólice por apólice: % do documento − % recebido. Se a diferença bate com o pró-labore daquela imobiliária naquela seguradora, é “pró-labore conferido” (pago direto à imob, não é pendência); se não bate, é divergência.
            A coluna do Nibo entra quando o token estiver na Vercel.{baixas[0]?.gerado_em ? ` Atualizado ${formatarData(baixas[0].gerado_em)}.` : ""}
          </p>
          {atrasos.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <p className="font-semibold">Baixa de comissão atrasada</p>
              <p className="mt-1 text-red-700">Mês já fechado com baixa no Corp abaixo de 30% da média dos 3 meses anteriores. Sem a baixa, o mês não foi conferido contra os extratos e o fluxo (repasse, conferência, fechamento) fica parado.</p>
              <ul className="mt-2 space-y-1">
                {mesesAtraso.map((m) => {
                  const doMes = atrasos.filter((a) => a.mes === m);
                  return (
                    <li key={m}>
                      <b>{m.slice(5, 7)}/{m.slice(0, 4)}</b>: {doMes.length} {doMes.length === 1 ? "combinação" : "combinações"} — {doMes.map((a) => `${a.seguradora} ${a.corretora === "O2 Capitalização" ? "(Cap)" : ""} ${a.situacao === "sem_baixa" ? "sem baixa" : `baixa ${brl(a.bruto)} de ~${brl(a.media_3m)}`}`).join(" · ")}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {mesesBaixa.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhuma baixa carregada.</p>
          ) : (
            mesesBaixa.map((mes) => {
              const doMes = baixas.filter((b) => b.mes === mes);
              const tot = (k: keyof BaixaMensal) => doMes.reduce((s, b) => s + Number(b[k] ?? 0), 0);
              return (
                <details key={mes} open={mes === mesesBaixa[0]} className="rounded-lg border border-gray-100">
                  <summary className="cursor-pointer px-2 py-1 text-xs font-semibold text-o2-navy">
                    {mes.slice(5, 7)}/{mes.slice(0, 4)} · bruto {brl(tot("bruto"))} · líquido esperado {brl(tot("liquido_esperado"))}
                  </summary>
                  <div className="overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-2 py-1">Corretora</th>
                          <th className="px-2 py-1">Seguradora</th>
                          <th className="px-2 py-1 text-right">Bruto</th>
                          <th className="px-2 py-1 text-right">Imposto</th>
                          <th className="px-2 py-1 text-right">Desconto</th>
                          <th className="px-2 py-1 text-right">Líquido esperado</th>
                          <th className="px-2 py-1 text-right">Premiação</th>
                          <th className="px-2 py-1 text-right">Pró-labore conferido</th>
                          <th className="px-2 py-1 text-right">Divergência</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {doMes.map((b) => (
                          <tr key={b.corretora + b.seguradora}>
                            <td className="px-2 py-1">{b.corretora}</td>
                            <td className="px-2 py-1">{b.seguradora}</td>
                            <td className="px-2 py-1 text-right">{brl(b.bruto)}</td>
                            <td className="px-2 py-1 text-right">{Number(b.imposto_pct) ? `${brl(b.imposto)} (${Number(b.imposto_pct)}%)` : "—"}</td>
                            <td className="px-2 py-1 text-right">{Number(b.desconto) ? brl(b.desconto) : "—"}</td>
                            <td className="px-2 py-1 text-right font-semibold">{brl(b.liquido_esperado)}</td>
                            <td className="px-2 py-1 text-right">{b.premiacao ? brl(b.premiacao) : "—"}</td>
                            <td className="px-2 py-1 text-right text-gray-500">{b.pro_labore_pago_direto ? brl(b.pro_labore_pago_direto) : "—"}</td>
                            <td className="px-2 py-1 text-right">{b.linhas_divergentes ? <span className="text-orange-700">{brl(b.divergencia)} ({b.linhas_divergentes})</span> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Estornos de endosso</h2>
          <p className="text-xs text-gray-500">
            Linha negativa no extrato = estorno de comissão de um endosso com restituição (cancelamento a pedido, cancelamento de item, restituição). Cada linha é casada com o endosso da apólice pelo nº do endosso, prêmio ou comissão.
            {estornos[0] ? ` Atualizado em ${new Date(estornos[0].gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : ""}
          </p>
          {[
            { titulo: "Estorno no extrato sem endosso no ERP", dica: "a seguradora descontou, mas o endosso não está cadastrado (ou não foi ligado à apólice)", linhas: estornoSemEndosso },
            { titulo: "Endosso sem estorno no extrato", dica: "endosso com comissão negativa há mais de 30 dias, de seguradora com extratos carregados, e o desconto ainda não apareceu", linhas: endossoSemEstorno },
          ].map((g) => (
            <details key={g.titulo} className="rounded-lg border border-gray-100" open={g.linhas.length > 0 && g.linhas.length <= 15}>
              <summary className="cursor-pointer px-3 py-2 text-sm">
                <span className="font-medium text-o2-navy">{g.titulo}</span> · {g.linhas.length} · {formatarReais(g.linhas.reduce((t, l) => t + Number(l.valor), 0))}
                <span className="ml-2 text-xs text-gray-500">{g.dica}</span>
              </summary>
              {g.linhas.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <tr><th className="px-3 py-1">Seguradora</th><th className="px-3 py-1">Código O2</th><th className="px-3 py-1">Apólice / endosso</th><th className="px-3 py-1">Cliente</th><th className="px-3 py-1">Data</th><th className="px-3 py-1 text-right">Comissão</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.linhas.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1">{l.seguradora ?? "—"}</td>
                        <td className="px-3 py-1">{l.documento_id ? <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">{l.codigo_o2}</Link> : "—"}</td>
                        <td className="px-3 py-1">{l.apolice ?? "—"}{l.endosso && l.endosso !== "0" ? ` / ${l.endosso}` : ""}</td>
                        <td className="px-3 py-1">{l.cliente ?? "—"}</td>
                        <td className="px-3 py-1">{l.data_ref ? new Date(l.data_ref + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="px-3 py-1 text-right text-red-700">{formatarReais(Number(l.valor))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </details>
          ))}
          <details className="rounded-lg border border-gray-100">
            <summary className="cursor-pointer px-3 py-2 text-sm">
              <span className="font-medium text-o2-navy">Endossos sem apólice ligada</span> · {semMae.length}
              <span className="ml-2 text-xs text-gray-500">a ligação automática (seguradora + nº da apólice) não achou uma apólice única; abra o endosso e informe o Código O2 da apólice</span>
            </summary>
            {semMae.length > 0 && (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <tr><th className="px-3 py-1">Endosso</th><th className="px-3 py-1">Tipo</th><th className="px-3 py-1">Seguradora</th><th className="px-3 py-1">Nº apólice informado</th><th className="px-3 py-1">Cliente</th><th className="px-3 py-1">Início</th><th className="px-3 py-1 text-right">Prêmio</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {semMae.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-1"><Link href={`/erp/documentos/${e.id}`} className="text-o2-navy hover:underline">Código O2 {e.nosso_numero}</Link></td>
                      <td className="px-3 py-1">{e.tipo}</td>
                      <td className="px-3 py-1">{e.seguradora?.nome ?? "—"}</td>
                      <td className="px-3 py-1">{e.numero_apolice && e.numero_apolice !== "0" ? e.numero_apolice : "—"}</td>
                      <td className="px-3 py-1">{e.cliente?.nome ?? "—"}</td>
                      <td className="px-3 py-1">{e.vigencia_inicio ? new Date(e.vigencia_inicio + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="px-3 py-1 text-right">{formatarReais(Number(e.premio_liquido))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Extratos de comissão das seguradoras</h2>
          <p className="text-xs text-gray-500">
            Lidos de hora em hora de duas fontes: o e-mail (Pottencial mensal, Too semanal, Tokio só o total do mês) e a pasta oficial do Drive “- RELATÓRIO COMISSÃO SEGURADORAS”, onde a equipe salva os extratos baixados dos sites das seguradoras (seguradora → ano → mês, arquivo com a data de recebimento).
            Cada linha é casada com o documento e a parcela do ERP e conferida contra o previsto; a baixa é aprovada em <Link href="/erp/baixas" className="underline">Baixa de comissão assistida</Link>.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href="/erp/baixas" className="rounded-lg bg-o2-navy px-3 py-1 text-white">{pend.length} extrato(s) pendente(s) de baixa →</Link>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">Cheia: <b>{somaPend("n_cheia")}</b></span>
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-teal-800">Pró-labore conferido: <b>{somaPend("n_pro_labore")}</b></span>
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-800">Estorno: <b>{somaPend("n_estorno")}</b></span>
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-800">Divergente: <b>{somaPend("n_divergente")}</b></span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">Não encontrada: <b>{somaPend("n_nao_encontrada")}</b></span>
          </div>
          {extratos.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhum extrato carregado ainda.</p>
          ) : (
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-2 py-1">Seguradora</th>
                    <th className="px-2 py-1">Corretora</th>
                    <th className="px-2 py-1">Fonte</th>
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
                      <td className="px-2 py-1">{e.corretora ?? "—"}</td>
                      <td className="px-2 py-1">{e.origem === "drive" ? "pasta do Drive" : e.origem === "gmail" ? "e-mail" : e.origem}</td>
                      <td className="px-2 py-1">{e.leitura === "nao_lido" ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">não lido</span> : e.tipo === "resumo_mensal" ? "só total do mês" : "demonstrativo"}</td>
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
        </>)}
      </main>
    </>
  );
}
