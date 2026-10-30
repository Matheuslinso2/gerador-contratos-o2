import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import { IconReport } from "@/components/icons";
import { formatarData } from "@/lib/sinistros/regras";
import { aprovarBaixa, salvarTratativa } from "./actions";
import FiltrosErp from "../FiltrosErp";
import { lerFiltros, idsImobiliarias, CORRETORAS } from "@/lib/erp/filtros";
import { entradasNibo, compararDias, situacaoCaixa, motivosProvaveis, TOLERANCIA_CAIXA, type DiaCaixa, type ExtratoDia, type SituacaoCaixa } from "@/lib/erp/caixaNibo";
import { podeVerBaixas } from "@/lib/erp/acessoBaixas";
import { avaliarBaixaAutomatica, bancoDoExtrato } from "@/lib/erp/baixaAutomatica";
import PainelControleBloco from "./gestao/PainelControleBloco";
import ControleExtrato from "./gestao/ControleExtrato";

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
  id: string; seguradora_id: string; corretora_id: string | null; seguradora: string; seg_abrev: string; corretora: string | null; mes: string; competencia: string; tipo: string; origem: string;
  leitura: string; arquivo_path: string | null; arquivo_nome: string | null; data_recebimento: string | null; created_at: string; total_extrato: number | null; soma_linhas: number; linhas: number; conta_fecha: boolean;
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
  documento: { nosso_numero_corp: number | null; imobiliaria: { nome: string } | null } | null;
};

const CLASSE: Record<string, { texto: string; cor: string }> = {
  cheia: { texto: "Cheia", cor: "bg-green-100 text-green-800" },
  pro_labore_direto: { texto: "Pró-labore conferido", cor: "bg-teal-100 text-teal-800" },
  estorno: { texto: "Estorno", cor: "bg-purple-100 text-purple-800" },
  divergente: { texto: "Divergente", cor: "bg-orange-100 text-orange-800" },
  nao_encontrada: { texto: "Não encontrada", cor: "bg-red-100 text-red-700" },
};
const PARA_TRATAR = ["estorno", "divergente", "nao_encontrada"];

// Conferência de caixa (28/10): uma linha por corretora × seguradora × mês, com o banco (Nibo) ao lado do extrato.
type LinhaCaixa = {
  chave: string; mes: string; corretora: string; seg: string; segNome: string; m: Mensal | null;
  banco: number | null; esperado: number | null; previsto: number | null; porVencimento: number | null; sit: SituacaoCaixa; dias: DiaCaixa[]; motivos: string[]; inad?: InadInfo | null; conf?: ConfInfo | null;
};
const NOME_CURTO: Record<string, string> = {
  ALFA: "Alfa", ALLI: "Allianz", AZUL: "Azul", BRAD: "Bradesco", BRAS: "Brasilcap", HDI: "HDI", ICAT: "Icatu", KLIN: "Klini",
  MAPF: "Mapfre", PORT: "Porto Seguro", POTT: "Pottencial", SUHA: "Suhai", SULA: "Sulamérica", TOKI: "Tokio Marine", TOO: "Too", YELU: "Yelum", ZURI: "Zurich",
};
type InadInfo = { esperadas: number; comEvidencia: number; sem: number; valorEsperado: number; valorSem: number; conclusivo: boolean; porque: string };
type LinhaInad = { documento_id: string | null; nosso_numero_corp: number | null; apolice: string | null; cliente: string | null; parcela_texto: string | null; venc_parcela: string; dias_atraso: number; valor: number | string };
type ConfInfo = { abertas: number; valor: number; regularizadas: number; semParcela: number };
type LinhaConf = { documento_id: string | null; nosso_numero_corp: number | null; apolice: string; cliente: string | null; parcela_n: number; vencimento_original: string; dias_atraso: number; valor: number | string | null; previsao_cancelamento: string | null; situacao: string };
type TotaisExtrato = {
  extrato_id: string; soma_identificada: number | string; soma_nao_parcela: number | string; soma_pendente_sem_parcela: number | string; qtd_identificada: number; qtd_nao_parcela: number;
  qtd_pendente: number; idade_max_pendente_dias: number | null; bloqueado_para_aprovar: boolean; diferenca: number | string; erp_identifica_corp_nao: number | string;
};
type BaixaErpExtrato = {
  extrato_id: string; linhas: number; erp_qtd: number; erp_valor: number | string; corp_qtd: number; corp_valor: number | string; so_erp_qtd: number; so_erp_valor: number | string;
  so_corp_qtd: number; so_corp_valor: number | string; nenhum_qtd: number; nenhum_valor: number | string; sem_parcela_qtd: number; fora_tolerancia_qtd: number; estorno_qtd: number;
};
type EstadoLinha = { linha_id: string; estado: string; idade_dias: number | null; fora_tipo: string | null; candidato_imobiliaria: string | null; candidato_cliente: string | null; ja_no_corp: boolean | null };
type LinhaPendente = {
  linha_id: string; extrato_id: string; n: number; seguradora_abrev: string; corretora: string; pago_em: string | null; valor_comissao: number | string; apolice: string | null;
  idade_dias: number | null; candidato_imobiliaria: string | null; candidato_cliente: string | null; tentativas_identificacao: number | null;
};
const ESTADO_LINHA: Record<string, { t: string; cor: string }> = {
  identificada: { t: "parcela identificada", cor: "bg-green-100 text-green-800" },
  nao_parcela_confirmada: { t: "não é parcela (confirmado)", cor: "bg-blue-100 text-blue-800" },
  pendente_identificacao: { t: "pendente de identificação", cor: "bg-red-100 text-red-700" },
};
type PontoDia = { dia: number; regra: number; exper: number; recebido: number };
type LinhaTopo = { seg: string; nome: string; prevista: number; regra: number; extratos: number; baixadas: number; nibo: number };
const COLUNAS_CAIXA = "grid grid-cols-[minmax(150px,1.5fr)_64px_repeat(5,minmax(100px,1fr))_minmax(150px,1.2fr)] items-center gap-x-2";

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const somaMes = (mes: string, delta: number) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
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

export default async function ConteudoBaixas({ searchParams, modo }: { searchParams: Promise<Record<string, string | undefined>>; modo: "conferencia" | "gestao" }) {
  const sp = await searchParams;
  const { erro, sucesso, aprovado, tratar, extrato: extratoAberto } = sp;
  const filtros = lerFiltros(sp);
  // Visão padrão (Matheus 28/10): MÊS ATUAL e UMA empresa (CNPJ) por vez; navega pelos meses e troca de empresa.
  // Se vier um período de datas na URL (links antigos), ele vale no lugar do mês.
  const corretoraSel = filtros.corretora && CORRETORAS.includes(filtros.corretora) ? filtros.corretora : CORRETORAS[0];
  // Na Gestão das baixas as duas empresas aparecem juntas, em blocos por seguradora; o filtro de corretora é opcional.
  const empresaFiltro: string | null = modo === "gestao" ? (filtros.corretora && CORRETORAS.includes(filtros.corretora) ? filtros.corretora : null) : corretoraSel;
  const base = modo === "gestao" ? "/erp/baixas/gestao" : "/erp/baixas";
  const mesAtual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const usaPeriodo = Boolean(filtros.de || filtros.ate);
  const mesSel = filtros.mes ?? mesAtual;
  const valoresTela = { ...filtros, corretora: empresaFiltro ?? "", mes: usaPeriodo ? filtros.mes : mesSel };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!podeVerBaixas(user?.email)) redirect("/erp");

  // Premissa de velocidade do ERP: resumos vêm das views por extrato (agregado por índice em extrato_id); as linhas só
  // do extrato aberto (?extrato=), as "para tratar" em aberto e as que casam com a busca/imobiliária/classificação.
  // Filtros padronizados (premissa 5): seguradora, corretora e período (data de recebimento) recortam os extratos;
  // busca (apólice / Nosso Nº / cliente), imobiliária e classificação recortam as LINHAS.
  const SEL_LINHA = "id, extrato_id, n, tipo, apolice, parcela, cliente, premio, valor_comissao, pct_doc, pct_recebido, valor_esperado, pct_pro_labore, valor_falta, conferencia, motivo_auto, ja_baixada_corp, documento_id, tratar_motivo, tratar_resolvido_em, tratar_por_email, documento:erp_documentos!erp_extrato_linhas_documento_id_fkey(nosso_numero_corp, imobiliaria:imobiliarias!erp_documentos_imobiliaria_principal_id_fkey(nome))";
  let qResumo = supabase.from("erp_baixa_assistida_resumo").select("*").order("mes", { ascending: false }).order("seguradora").order("created_at");
  let qMensal = supabase.from("erp_baixa_assistida_mensal").select("*").order("mes", { ascending: false }).order("seguradora").order("corretora");
  if (filtros.seguradora) { qResumo = qResumo.eq("seg_abrev", filtros.seguradora); qMensal = qMensal.eq("seg_abrev", filtros.seguradora); }
  if (empresaFiltro) { qResumo = qResumo.eq("corretora", empresaFiltro); qMensal = qMensal.eq("corretora", empresaFiltro); }
  if (!usaPeriodo) { qResumo = qResumo.eq("mes", `${mesSel}-01`); qMensal = qMensal.eq("mes", `${mesSel}-01`); }
  if (filtros.de) { qResumo = qResumo.gte("data_recebimento", filtros.de); qMensal = qMensal.gte("mes", filtros.de.slice(0, 7) + "-01"); }
  if (filtros.ate) { qResumo = qResumo.lte("data_recebimento", filtros.ate); qMensal = qMensal.lte("mes", filtros.ate.slice(0, 7) + "-01"); }
  if (filtros.situacao === "a_aprovar") qResumo = qResumo.is("baixa_aprovada_em", null);
  if (filtros.situacao === "aprovada") qResumo = qResumo.not("baixa_aprovada_em", "is", null);
  const [{ data: mensaisBrutos }, { data: extratosBrutos }] = await Promise.all([qMensal, qResumo]);
  const mensais = (mensaisBrutos ?? []) as Mensal[];
  let extratos = (extratosBrutos ?? []) as Extrato[];

  // Filtros de linha: busca, imobiliária, classificação.
  const classe = filtros.situacao && CLASSE[filtros.situacao] ? filtros.situacao : null;
  const filtroLinha = Boolean(filtros.q || filtros.imobiliaria || classe);
  let linhasFiltradas: LinhaExtrato[] = [];
  if (filtroLinha && extratos.length) {
    const imobIds = filtros.imobiliaria ? await idsImobiliarias(supabase, filtros.imobiliaria) : null;
    const sel = imobIds ? SEL_LINHA.replace("documento:erp_documentos!erp_extrato_linhas_documento_id_fkey(", "documento:erp_documentos!erp_extrato_linhas_documento_id_fkey!inner(") : SEL_LINHA;
    let q = supabase.from("erp_extrato_linhas").select(sel).in("extrato_id", extratos.map((e) => e.id));
    if (imobIds) q = q.in("documento.imobiliaria_principal_id", imobIds.length ? imobIds : ["00000000-0000-0000-0000-000000000000"]);
    if (classe) q = q.eq("conferencia", classe);
    if (filtros.q) {
      const t = filtros.q.replace(/[%_,()]/g, "");
      const dig = t.replace(/\D/g, "");
      const ors = [`apolice.ilike.%${t}%`, `cliente.ilike.%${t}%`];
      if (dig && dig.length <= 7) {
        const { data: docs } = await supabase.from("erp_documentos").select("id").eq("nosso_numero_corp", Number(dig)).limit(5);
        for (const d of (docs ?? []) as { id: string }[]) ors.push(`documento_id.eq.${d.id}`);
      }
      q = q.or(ors.join(","));
    }
    const { data } = await q.order("extrato_id").order("n").limit(300);
    linhasFiltradas = (data ?? []) as unknown as LinhaExtrato[];
    const comLinha = new Set(linhasFiltradas.map((l) => l.extrato_id));
    extratos = extratos.filter((e) => comLinha.has(e.id));
  }

  const extratoPorId = Object.fromEntries(extratos.map((e) => [e.id, e]));
  const meses = [...new Set(mensais.map((m) => m.mes))];

  // Conferência de caixa: o banco (Nibo, categoria 1.1) é o fiel da balança. Só leitura; nada é gravado no Nibo.
  const mesesOrd = usaPeriodo ? [...meses].map((m) => m.slice(0, 7)).sort() : [mesSel];
  let linhasCaixa: LinhaCaixa[] = [];
  const quadroTopo: Record<string, LinhaTopo[]> = {};
  const graficoTopo: Record<string, PontoDia[]> = {};
  let inadLinhas: LinhaInad[] = [];
  let erroListaInad: string | null = null;
  let confLinhas: LinhaConf[] = [];
  if (mesesOrd.length) {
    const [anoF, mesF] = mesesOrd[mesesOrd.length - 1].split("-").map(Number);
    const desdeCaixa = `${mesesOrd[0]}-01`;
    const fimCaixa = new Date(Date.UTC(anoF, mesF, 0)).toISOString().slice(0, 10); // último dia do último mês
    const ateCaixa = new Date(Date.UTC(anoF, mesF, 4)).toISOString().slice(0, 10); // + alguns dias: fim de semana cai na segunda
    const qDias = supabase.from("erp_baixa_assistida_resumo")
      .select("seg_abrev, corretora, data_recebimento, total_extrato, soma_linhas, liquido_sem_desconto, linhas")
      .neq("tipo", "resumo_mensal").gte("data_recebimento", desdeCaixa).lte("data_recebimento", ateCaixa).limit(5000);
    const [{ data: diasBrutos }, entradas, { data: segsBrutas }, { data: previsaoBruta }, { data: nfsBrutas }, { data: baixadasBrutas }, { data: previstoDiaBruto }, { data: regraBruta }, { data: inadBruta }, { data: ligacaoBruta }, { data: inadLinhasBruta, error: erroInadLinhas }, { data: confBruta }, { data: confLinhasBruta }] = await Promise.all([
      qDias, entradasNibo(supabase, desdeCaixa, ateCaixa), supabase.from("erp_seguradoras").select("abreviacao, nome"),
      supabase.rpc("erp_previsao_caixa_mensal", { p_de: desdeCaixa, p_ate: fimCaixa }),
      supabase.from("erp_extratos_seguradora").select("nf_numero, nf_emitida_em, seguradora:erp_seguradoras!inner(abreviacao)").in("seguradora.abreviacao", ["POTT", "TOO"]).gte("competencia", desdeCaixa).lte("competencia", fimCaixa),
      supabase.rpc("erp_baixadas_corp_mensal", { p_de: desdeCaixa, p_ate: fimCaixa }),
      supabase.rpc("erp_previsao_diaria", { p_de: desdeCaixa, p_ate: ateCaixa }),
      supabase.rpc("erp_previsao_caixa_regra_mensal", { p_de: desdeCaixa, p_ate: fimCaixa }),
      supabase.rpc("erp_inadimplencia_provavel", { p_de: desdeCaixa, p_ate: fimCaixa }),
      supabase.rpc("erp_extratos_ligacao", { p_de: desdeCaixa, p_ate: new Date(Date.UTC(anoF, mesF, 30)).toISOString().slice(0, 10) }),
      sp.inad ? supabase.rpc("erp_inadimplencia_provavel_linhas", { p_corretora: sp.inadEmp ?? empresaFiltro ?? CORRETORAS[0], p_seg: sp.inad, p_de: desdeCaixa, p_ate: fimCaixa }) : Promise.resolve({ data: [], error: null }),
      supabase.rpc("erp_inadimplencia_confirmada", { p_de: desdeCaixa, p_ate: fimCaixa }),
      sp.inad ? supabase.rpc("erp_inadimplencia_confirmada_linhas", { p_corretora: sp.inadEmp ?? empresaFiltro ?? CORRETORAS[0], p_seg: sp.inad, p_de: desdeCaixa, p_ate: fimCaixa }) : Promise.resolve({ data: [] }),
    ]);
    confLinhas = (confLinhasBruta ?? []) as LinhaConf[];
    inadLinhas = (inadLinhasBruta ?? []) as LinhaInad[];
    erroListaInad = erroInadLinhas?.message ?? null;
    // nota fiscal registrada (Pottencial e Too só pagam depois dela) e data do último extrato lido de cada seguradora
    const nfPorSeg = new Set<string>();
    for (const x of (nfsBrutas ?? []) as unknown as { nf_numero: string | null; nf_emitida_em: string | null; seguradora: { abreviacao: string } | { abreviacao: string }[] | null }[]) {
      const ab = Array.isArray(x.seguradora) ? x.seguradora[0]?.abreviacao : x.seguradora?.abreviacao;
      if (ab && (x.nf_numero || x.nf_emitida_em)) nfPorSeg.add(ab);
    }
    // comissão que DEVERIA CAIR no mês conforme a experiência de cada seguradora (vencimento + prazo mediano dos últimos 16 meses)
    const previsao = new Map<string, { esperado: number; porVencimento: number }>();
    for (const p of (previsaoBruta ?? []) as { corretora: string; seg_abrev: string; mes: string; previsto_liquido: number | string; venc_liquido: number | string }[]) {
      if ((empresaFiltro && p.corretora !== empresaFiltro) || (filtros.seguradora && p.seg_abrev !== filtros.seguradora)) continue;
      previsao.set(`${p.corretora}|${p.seg_abrev}|${p.mes}`, { esperado: Number(p.previsto_liquido), porVencimento: Number(p.venc_liquido) });
    }
    const extratosDia: ExtratoDia[] = ((diasBrutos ?? []) as Record<string, unknown>[]).map((e) => {
      // Leitura por IA de alguns PDFs (ex.: Icatu) pegou o total do prêmio no lugar da comissão (total > 5× a soma das linhas):
      // nesse caso vale a soma das linhas, na mesma proporção de imposto.
      const total = Number(e.total_extrato ?? 0), soma = Number(e.soma_linhas ?? 0), liq = Number(e.liquido_sem_desconto ?? 0);
      const leituraErrada = soma > 0 && total > soma * 5;
      return {
        seg: String(e.seg_abrev), corretora: (e.corretora as string | null) ?? null, dia: String(e.data_recebimento),
        liquido: leituraErrada ? liq * (soma / total) : liq, bruto: leituraErrada ? soma : total || soma, linhas: Number(e.linhas ?? 0),
      };
    });
    const porDia = compararDias(extratosDia, entradas);
    const nomeSeg = new Map(((segsBrutas ?? []) as { abreviacao: string; nome: string }[]).map((s) => [s.abreviacao, s.nome]));
    // ---- Quadro do topo (planilha CONTROLE MENSAL DE BAIXA DE COMISSÃO): uma tabela por empresa, uma linha por seguradora ----
    const mesTopo = mesesOrd[0];
    const baixadasMap = new Map<string, number>();
    for (const b of (baixadasBrutas ?? []) as { corretora: string; seg_abrev: string; mes: string; liquido: number | string }[]) baixadasMap.set(`${b.corretora}|${b.seg_abrev}|${b.mes}`, Number(b.liquido));
    const regraTodas = new Map<string, number>();
    for (const p of (regraBruta ?? []) as { corretora: string; seg_abrev: string; mes: string; previsto_liquido: number | string }[]) regraTodas.set(`${p.corretora}|${p.seg_abrev}|${p.mes}`, Number(p.previsto_liquido));
    const prevTodas = new Map<string, number>();
    for (const p of (previsaoBruta ?? []) as { corretora: string; seg_abrev: string; mes: string; previsto_liquido: number | string }[]) prevTodas.set(`${p.corretora}|${p.seg_abrev}|${p.mes}`, Number(p.previsto_liquido));
    const rd = (v: number) => Math.round(v * 100) / 100;
    for (const corr of CORRETORAS) {
      const segsEmp = new Set<string>();
      for (const k of [...porDia.keys(), ...prevTodas.keys(), ...regraTodas.keys(), ...baixadasMap.keys()]) {
        const [c, sg, mm] = k.split("|");
        if (c === corr && mm === mesTopo) segsEmp.add(sg);
      }
      const linhas: LinhaTopo[] = [];
      for (const sg of segsEmp) {
        const k = `${corr}|${sg}|${mesTopo}`;
        const dias = porDia.get(k) ?? [];
        const l: LinhaTopo = {
          seg: sg, nome: NOME_CURTO[sg] ?? nomeSeg.get(sg) ?? (sg === "OUTRAS" ? "Outras" : sg),
          prevista: rd(prevTodas.get(k) ?? 0), regra: rd(regraTodas.get(k) ?? 0), extratos: rd(dias.reduce((t, d) => t + d.extrato, 0)),
          baixadas: rd(baixadasMap.get(k) ?? 0), nibo: rd(dias.reduce((t, d) => t + d.banco, 0)),
        };
        if ([l.prevista, l.regra, l.extratos, l.baixadas, l.nibo].some((v) => Math.abs(v) >= 0.005)) linhas.push(l);
      }
      quadroTopo[corr] = linhas.sort((a, b) => a.nome.localeCompare(b.nome));
    }
    // ---- Gráfico diário por empresa: previsto do dia (parcelas que vencem no dia) × recebido no dia (Nibo), todas as seguradoras somadas ----
    const [aTopo, mTopo] = mesTopo.split("-").map(Number);
    const diasDoMes = new Date(Date.UTC(aTopo, mTopo, 0)).getUTCDate();
    for (const corr of CORRETORAS) {
      const pontos: PontoDia[] = Array.from({ length: diasDoMes }, (_, i) => ({ dia: i + 1, regra: 0, exper: 0, recebido: 0 }));
      for (const p of (previstoDiaBruto ?? []) as { corretora: string; dia: string; regra_liquido: number | string; experiencia_liquido: number | string }[]) {
        if (p.corretora === corr && p.dia.startsWith(mesTopo)) { const i = Number(p.dia.slice(8, 10)) - 1; pontos[i].regra += Number(p.regra_liquido); pontos[i].exper += Number(p.experiencia_liquido); }
      }
      for (const n of entradas) {
        if (n.corretora === corr && n.dia.startsWith(mesTopo)) pontos[Number(n.dia.slice(8, 10)) - 1].recebido += n.valor;
      }
      graficoTopo[corr] = pontos.map((p) => ({ dia: p.dia, regra: Math.round(p.regra * 100) / 100, exper: Math.round(p.exper * 100) / 100, recebido: Math.round(p.recebido * 100) / 100 }));
    }
    const bancoMes = new Map<string, number>();
    for (const n of entradas) {
      if (filtros.seguradora && n.seg !== filtros.seguradora) continue;
      if (empresaFiltro && n.corretora !== empresaFiltro) continue;
      const k = `${n.corretora}|${n.seg}|${n.dia.slice(0, 7)}`;
      bancoMes.set(k, (bancoMes.get(k) ?? 0) + n.valor);
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const ultimoExtrato = new Map<string, string>();
    for (const e of extratosDia) if (!ultimoExtrato.has(e.seg) || e.dia > ultimoExtrato.get(e.seg)!) ultimoExtrato.set(e.seg, e.dia);
    const motivosDe = (seg: string, esperado: number | null, banco: number | null, previsto: number | null, m: Mensal | null, dias: DiaCaixa[]) =>
      motivosProvaveis({
        seg, mesAtual: !usaPeriodo && mesSel === mesAtual, esperado, banco, previsto,
        desconto: m ? Number(m.desconto) : 0, proLabore: m ? Number(m.pro_labore_pago_direto) : 0, nEstorno: m ? Number(m.n_estorno) : 0,
        dias, ultimoExtrato: ultimoExtrato.get(seg) ?? null, nfRegistrada: seg === "POTT" || seg === "TOO" ? nfPorSeg.has(seg) : null,
      });
    const vistos = new Set<string>();
    for (const m of mensais) {
      const k = `${m.corretora}|${m.seg_abrev}|${m.mes.slice(0, 7)}`;
      vistos.add(k);
      const banco = bancoMes.has(k) ? r2(bancoMes.get(k)!) : null;
      // "Pagou" = soma dos extratos por dia de pagamento, contando uma vez só os extratos repetidos (o mesmo total pode vir
      // do e-mail e do portal); sem datas de pagamento (só total do mês), cai no cálculo do resumo mensal.
      const dias = porDia.get(k) ?? [];
      const esperado = dias.some((d) => d.extrato) ? r2(dias.reduce((s, d) => s + d.extrato, 0)) : r2(Number(m.liquido_esperado) + Number(m.desconto));
      const prev = previsao.get(k);
      linhasCaixa.push({ chave: k, mes: m.mes, corretora: m.corretora ?? "—", seg: m.seg_abrev, segNome: m.seguradora, m, banco, esperado, previsto: prev ? r2(prev.esperado) : null, porVencimento: prev ? r2(prev.porVencimento) : null, sit: situacaoCaixa(esperado, banco, prev?.esperado ?? null), dias, motivos: motivosDe(m.seg_abrev, esperado, banco, prev ? r2(prev.esperado) : null, m, dias) });
    }
    // dinheiro que entrou no banco de uma seguradora sem nenhum extrato lido no ERP
    for (const [k, v] of bancoMes) {
      const [corretora, seg, mes] = k.split("|");
      if (vistos.has(k) || !mesesOrd.includes(mes)) continue;
      vistos.add(k);
      const prev = previsao.get(k);
      linhasCaixa.push({ chave: k, mes: `${mes}-01`, corretora, seg, segNome: nomeSeg.get(seg) ?? (seg === "OUTRAS" ? "Outras (sem seguradora reconhecida)" : seg), m: null, banco: r2(v), esperado: null, previsto: prev ? r2(prev.esperado) : null, porVencimento: prev ? r2(prev.porVencimento) : null, sit: situacaoCaixa(null, r2(v), prev?.esperado ?? null), dias: porDia.get(k) ?? [], motivos: motivosDe(seg, null, r2(v), prev ? r2(prev.esperado) : null, null, porDia.get(k) ?? []) });
    }
    // deveria cair mas ainda não há extrato nem entrada no banco (só vale a pena mostrar acima de R$ 50)
    for (const [k, p] of previsao) {
      const [corretora, seg, mes] = k.split("|");
      if (vistos.has(k) || !mesesOrd.includes(mes) || p.esperado < 50) continue;
      linhasCaixa.push({ chave: k, mes: `${mes}-01`, corretora, seg, segNome: nomeSeg.get(seg) ?? seg, m: null, banco: null, esperado: null, previsto: r2(p.esperado), porVencimento: r2(p.porVencimento), sit: situacaoCaixa(null, null, p.esperado), dias: [], motivos: motivosDe(seg, null, null, r2(p.esperado), null, []) });
    }
    linhasCaixa = linhasCaixa.sort((a, b) => b.mes.localeCompare(a.mes) || a.segNome.localeCompare(b.segNome));
    // Provável inadimplência (Matheus 29/10): a linha do cliente no extrato prova que ele pagou; comissão esperada que não aparece em nenhum
    // extrato nem está baixada = a seguradora provavelmente não recebeu. Só se conclui com o extrato ligado às parcelas e conferido com o banco.
    const inadPorSeg = new Map<string, { esperadas: number; com_evidencia: number; sem_evidencia: number; valor_esperado: number; valor_sem_evidencia: number }>();
    for (const x of (inadBruta ?? []) as { corretora: string; seg_abrev: string; esperadas: number; com_evidencia: number; sem_evidencia: number; valor_esperado: number | string; valor_sem_evidencia: number | string }[]) {
      inadPorSeg.set(`${x.corretora}|${x.seg_abrev}`, { esperadas: Number(x.esperadas), com_evidencia: Number(x.com_evidencia), sem_evidencia: Number(x.sem_evidencia), valor_esperado: Number(x.valor_esperado), valor_sem_evidencia: Number(x.valor_sem_evidencia) });
    }
    const ligPorSeg = new Map<string, { linhas: number; ligadas: number }>();
    for (const x of (ligacaoBruta ?? []) as { corretora: string | null; seg_abrev: string; linhas: number; ligadas: number }[]) {
      ligPorSeg.set(`${x.corretora}|${x.seg_abrev}`, { linhas: Number(x.linhas), ligadas: Number(x.ligadas) });
    }
    // Inadimplência CONFIRMADA pela própria seguradora (relatório/e-mail de cobrança): vale mais que a provável.
    const confPorSeg = new Map<string, ConfInfo>();
    for (const x of (confBruta ?? []) as { corretora: string; seg_abrev: string; abertas: number; valor_abertas: number | string; regularizadas: number; sem_parcela: number }[]) {
      confPorSeg.set(`${x.corretora}|${x.seg_abrev}`, { abertas: Number(x.abertas), valor: Number(x.valor_abertas), regularizadas: Number(x.regularizadas), semParcela: Number(x.sem_parcela) });
    }
    for (const c of linhasCaixa) c.conf = confPorSeg.get(`${c.corretora}|${c.seg}`) ?? null;
    for (const c of linhasCaixa) {
      const i = inadPorSeg.get(`${c.corretora}|${c.seg}`);
      if (!i || i.esperadas === 0) { c.inad = null; continue; }
      const lig = ligPorSeg.get(`${c.corretora}|${c.seg}`);
      const pctLig = lig && lig.linhas ? lig.ligadas / lig.linhas : 0;
      let porque = "";
      if (!c.m && !(c.esperado ?? 0)) porque = "o ERP não tem extrato desta seguradora neste mês";
      else if (!lig || lig.linhas < 20 || pctLig < 0.9) porque = `o extrato desta seguradora ainda não está ligado às parcelas (${Math.round(pctLig * 100)}% das linhas)`;
      else if (c.sit.codigo !== "bate") porque = "o extrato não confere com o banco neste mês (confira a diferença acima)";
      c.inad = { esperadas: i.esperadas, comEvidencia: i.com_evidencia, sem: i.sem_evidencia, valorEsperado: i.valor_esperado, valorSem: i.valor_sem_evidencia, conclusivo: porque === "", porque };
    }
  }
  // Gestão: estado das linhas e totais por extrato (views só de leitura da baixa assistida; sempre filtradas por lista de extratos, por desempenho)
  const totaisPor = new Map<string, TotaisExtrato>();
  const estadosAberto = new Map<string, EstadoLinha>();
  const baixaErpPor = new Map<string, BaixaErpExtrato>();
  let pendentesLinhas: LinhaPendente[] = [];
  const outrasEntradas = new Map<string, number>();
  if (modo === "gestao" && extratos.length) {
    const lotes = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
    const rt = await Promise.all(lotes(extratos.map((e) => e.id), 60).map((l) => supabase.from("erp_baixa_extrato_totais").select("*").in("extrato_id", l)));
    for (const r of rt) for (const t of (r.data ?? []) as TotaisExtrato[]) totaisPor.set(t.extrato_id, t);
    // baixa PRÓPRIA do ERP (trilha de teste, paralela ao Corp; não entra nos totais oficiais): por extrato, ERP × Corp
    const rb = await Promise.all(lotes(extratos.map((e) => e.id), 60).map((l) => supabase.from("erp_baixa_erp_extrato_resumo").select("*").in("extrato_id", l)));
    for (const r of rb) for (const b of (r.data ?? []) as BaixaErpExtrato[]) baixaErpPor.set(b.extrato_id, b);
    const comPend = [...totaisPor.values()].filter((t) => Number(t.qtd_pendente) > 0).map((t) => t.extrato_id);
    const lp = await Promise.all(lotes(comPend, 40).map((l) =>
      supabase.from("erp_baixa_linha_estado").select("linha_id, extrato_id, n, seguradora_abrev, corretora, pago_em, valor_comissao, apolice, idade_dias, candidato_imobiliaria, candidato_cliente, tentativas_identificacao").in("extrato_id", l).eq("estado", "pendente_identificacao").limit(600)));
    pendentesLinhas = lp.flatMap((r) => (r.data ?? []) as LinhaPendente[]).sort((a, b) => (b.idade_dias ?? 0) - (a.idade_dias ?? 0));
    if (extratoAberto && extratoPorId[extratoAberto]) {
      const { data: es } = await supabase.from("erp_baixa_linha_estado").select("linha_id, estado, idade_dias, fora_tipo, candidato_imobiliaria, candidato_cliente, ja_no_corp").eq("extrato_id", extratoAberto);
      for (const l of (es ?? []) as EstadoLinha[]) estadosAberto.set(l.linha_id, l);
    }
    // entradas do Nibo no mês que NÃO são receita de seguros (empréstimo, estorno, transferência…): ficam fora de todos os totais
    const [aN, mN] = mesSel.split("-").map(Number);
    const { data: ne } = await supabase.from("erp_nibo_lancamentos").select("categoria, valor").eq("tipo", "recebimento").gte("data", `${mesSel}-01`).lte("data", new Date(Date.UTC(aN, mN, 0)).toISOString().slice(0, 10)).neq("categoria", "1.1 - RECEITA DE SEGUROS").limit(2000);
    for (const n of (ne ?? []) as { categoria: string | null; valor: number | string }[]) outrasEntradas.set(n.categoria ?? "sem categoria", (outrasEntradas.get(n.categoria ?? "sem categoria") ?? 0) + Number(n.valor));
  }
  const pendentes = extratos.filter((e) => !e.baixa_aprovada_em && e.tipo !== "resumo_mensal");
  const aprovados = extratos.filter((e) => e.baixa_aprovada_em);
  const idsAprovados = aprovados.map((e) => e.id);

  const [{ data: linhasAbertasBrutas, error: erroLinhasAbertas }, { data: tratarBrutas }, { count: tratadas }] = await Promise.all([
    extratoAberto && extratoPorId[extratoAberto]
      ? supabase.from("erp_extrato_linhas").select(SEL_LINHA).eq("extrato_id", extratoAberto).order("n").limit(2000)
      : Promise.resolve({ data: [], error: null }),
    idsAprovados.length
      ? supabase.from("erp_extrato_linhas").select(SEL_LINHA).in("extrato_id", idsAprovados).in("conferencia", PARA_TRATAR).is("tratar_resolvido_em", null).order("extrato_id").order("n").limit(500)
      : Promise.resolve({ data: [] }),
    idsAprovados.length
      ? supabase.from("erp_extrato_linhas").select("id", { count: "exact", head: true }).in("extrato_id", idsAprovados).in("conferencia", PARA_TRATAR).not("tratar_resolvido_em", "is", null)
      : Promise.resolve({ count: 0 }),
  ]);
  const linhasAbertas = (linhasAbertasBrutas ?? []) as unknown as LinhaExtrato[];
  if (erroLinhasAbertas) console.error("linhas do extrato aberto:", erroLinhasAbertas.message);
  const paraTratar = (tratarBrutas ?? []) as unknown as LinhaExtrato[];
  const linhasParaCorp = aprovados.reduce((t, e) => t + Number(e.linhas) - Number(e.n_nao_encontrada), 0);
  const jaBaixadasCorp = aprovados.reduce((t, e) => t + Number(e.ja_baixadas_corp), 0);
  const totais = {
    pagou: Math.round(linhasCaixa.reduce((s, c) => s + (c.esperado ?? 0), 0) * 100) / 100,
    previsto: Math.round(linhasCaixa.reduce((s, c) => s + (c.previsto ?? 0), 0) * 100) / 100,
    banco: Math.round(linhasCaixa.reduce((s, c) => s + (c.banco ?? 0), 0) * 100) / 100,
    abaixar: Math.round(linhasCaixa.reduce((s, c) => s + (c.m && c.m.so_total !== c.m.extratos ? Number(c.m.valor_a_baixar) : 0), 0) * 100) / 100,
  };
  // Links da própria tela mantêm empresa, mês e filtros; `extrato` (linhas abertas) só vale na hora.
  const hrefTela = (mudar: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const todos: Record<string, string | undefined> = { ...sp, corretora: modo === "gestao" ? empresaFiltro ?? undefined : corretoraSel, mes: usaPeriodo ? sp.mes : mesSel, extrato: undefined, ...mudar };
    for (const [k, v] of Object.entries(todos)) if (v && !["erro", "sucesso", "aprovado", "tratar"].includes(k)) p.set(k, v);
    const s = p.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const baseCard = hrefTela({});
  const diasDe = (e: Extrato) => linhasCaixa.find((x) => x.corretora === e.corretora && x.seg === e.seg_abrev)?.dias;
  const resumoGestao = {
    manual: extratos.filter((e) => !e.baixa_aprovada_em && e.tipo !== "resumo_mensal" && !avaliarBaixaAutomatica(e, bancoDoExtrato(diasDe(e), e.data_recebimento).situacao, Number(totaisPor.get(e.id)?.qtd_pendente ?? 0)).seria).length,
    auto: extratos.filter((e) => avaliarBaixaAutomatica(e, bancoDoExtrato(diasDe(e), e.data_recebimento).situacao, Number(totaisPor.get(e.id)?.qtd_pendente ?? 0)).seria).length,
    aTratar: extratos.filter((e) => !e.baixa_aprovada_em && Number(e.tratar_em_aberto) > 0).length,
    bancoSemExtrato: linhasCaixa.reduce((t, c) => t + c.dias.filter((d) => d.extrato === 0 && d.banco > 0.005).length, 0),
  };
  const resumoIdent = {
    qtd: [...totaisPor.values()].reduce((t, x) => t + Number(x.qtd_pendente), 0),
    valor: Math.round([...totaisPor.values()].reduce((t, x) => t + Number(x.soma_pendente_sem_parcela), 0) * 100) / 100,
  };
  let saldoAbertoTotal = 0;
  if (modo === "gestao") {
    const { data: sd } = await supabase.from("erp_saldo_cobrar_seguradora").select("valor").eq("situacao", "aberto");
    saldoAbertoTotal = Math.round(((sd ?? []) as { valor: number | string }[]).reduce((t, x) => t + Number(x.valor), 0) * 100) / 100;
  }
  const card = (e: Extrato) => <ExtratoCard key={e.id} e={e} aberto={e.id === extratoAberto} linhas={e.id === extratoAberto ? linhasAbertas : []} base={baseCard} tot={totaisPor.get(e.id)} estados={e.id === extratoAberto ? estadosAberto : undefined} />;
  const SITUACOES: Record<string, string> = {
    a_aprovar: "Extrato a aprovar", aprovada: "Extrato com baixa aprovada",
    cheia: "Linha: cheia", pro_labore_direto: "Linha: pró-labore conferido", estorno: "Linha: estorno", divergente: "Linha: divergente", nao_encontrada: "Linha: não encontrada",
  };

  return (
    <>
      <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-6 p-6">
        <PageHeader
          icon={<IconReport />}
          titulo={modo === "gestao" ? "ERP O2 — Gestão das baixas de comissão" : "ERP O2 — Conferência de baixa de comissão"}
          subtitulo={modo === "gestao" ? "Um bloco por seguradora de cada empresa: o que a seguradora pagou, o que bateu com o previsto e com o banco, os extratos para aprovar a baixa, o histórico e o saldo a cobrar." : "Controle do mês por empresa e seguradora. O detalhe, os extratos e a aprovação da baixa ficam na aba lateral Gestão das baixas."}
        />


        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Não deu certo: {erro === "dados" ? "dados incompletos" : erro}</p>}
        {aprovado != null && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
            Baixa aprovada: {aprovado} recebimento(s) gravado(s) no ERP{Number(tratar) > 0 ? `; ${tratar} linha(s) foram para “Para tratar”` : ""}.
          </p>
        )}
        {sucesso && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">Salvo.</p>}

        {modo === "conferencia" && (
          <>
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-o2-navy">Controle mensal de baixa de comissão - Corp - ERP O2</h2>
            {!usaPeriodo ? (
              <div className="flex items-center gap-2 text-sm" aria-label="Mês">
                <Link href={hrefTela({ mes: somaMes(mesSel, -1) })} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-50" title="mês anterior">◀</Link>
                <span className="min-w-[88px] text-center font-semibold text-o2-navy">{mesTexto(`${mesSel}-01`)}</span>
                <Link href={hrefTela({ mes: somaMes(mesSel, 1) })} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-50" title="próximo mês">▶</Link>
                {mesSel !== mesAtual && <Link href={hrefTela({ mes: undefined })} className="text-xs text-o2-navy underline">voltar ao mês atual</Link>}
              </div>
            ) : (
              <Link href={hrefTela({ de: undefined, ate: undefined, mes: undefined })} className="text-xs text-o2-navy underline">sair do período por datas e voltar ao mês atual</Link>
            )}
          </div>
          <div className="grid gap-4 2xl:grid-cols-2">
            <TabelaControle titulo="O2 Corretora de Seguros : 20001784000180" linhas={quadroTopo["O2 Corretora"] ?? []} />
            <TabelaControle titulo="o2 Capitalização e Seguros" linhas={quadroTopo["O2 Capitalização"] ?? []} />
          </div>
          <TabelaControle titulo="Consolidado · O2 Corretora + O2 Capitalização (uma linha por seguradora)" linhas={consolidarQuadros(quadroTopo["O2 Corretora"] ?? [], quadroTopo["O2 Capitalização"] ?? [])} />
          <p className="text-[11px] leading-relaxed text-gray-500">
            Valores líquidos do imposto retido, como entram na conta. <b>Prevista (regra)</b>: o que deveria cair no mês pela regra de cada seguradora (boleto, fatura ou nota fiscal + o prazo próprio dela), sem atraso nem inadimplência. <b>Prevista (experiência)</b>: vencimento da parcela + o prazo que a seguradora costuma levar, pelo histórico.
            <b> Extratos de comissão</b>: o que a seguradora pagou segundo os extratos lidos. <b>Baixadas</b>: o que já foi baixado no Corp no mês (data da quitação). <b>Nibo</b>: o que entrou na conta (receita de seguros).
            <b> Diferença extratos × baixadas</b> = Extratos − Baixadas: o que a seguradora pagou e ainda não foi baixado (negativo: baixado a mais). <b>Diferença extratos × Nibo</b> = Extratos − Nibo: o que a seguradora diz que pagou e não entrou na conta (negativo: entrou mais do que os extratos explicam). Até R$ {TOLERANCIA_CAIXA} é considerado igual.
          </p>
        </section>

        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-o2-navy">Comportamento diário de comissões - previsão de receitas versus recebido por vencimento de parcelas</h2>
          <GraficoDiario titulo="Consolidado · O2 Corretora + O2 Capitalização" pontos={consolidarDias(graficoTopo["O2 Corretora"] ?? [], graficoTopo["O2 Capitalização"] ?? [])} />
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-o2-navy">Ver o comportamento diário de cada empresa separadamente</summary>
            <div className="space-y-4 p-3">
              <GraficoDiario titulo="O2 Corretora de Seguros : 20001784000180" pontos={graficoTopo["O2 Corretora"] ?? []} />
              <GraficoDiario titulo="o2 Capitalização e Seguros" pontos={graficoTopo["O2 Capitalização"] ?? []} />
            </div>
          </details>
          <p className="text-[11px] leading-relaxed text-gray-500">
            <b>Prevista (regra)</b>: comissão que deveria cair naquele dia pela regra da seguradora (boleto, fatura ou nota fiscal + o prazo próprio dela), sem atraso nem inadimplência. <b>Prevista (experiência)</b>: vencimento da parcela + o prazo que a seguradora costuma levar. Todas as seguradoras e produtos, líquido do imposto retido. <b>Recebido no dia</b>: o que entrou na conta naquele dia (Nibo, receita de seguros).
            O previsto marca o vencimento; as seguradoras costumam pagar alguns dias depois, por isso os picos não coincidem. A escala é por faixas de valor.
          </p>
        </section>

        <p className="text-xs text-gray-600">
          <Link href="/erp/conferencia" className="underline">← Conferência</Link>. Os extratos chegam de hora em hora pelo e-mail e pela pasta oficial do Drive “- RELATÓRIO COMISSÃO SEGURADORAS” (seguradora → ano → mês).
          Nada é lançado no Corp por aqui: a lista pronta sai em planilha para o financeiro (baixa pelo valor bruto, previsão de repasse dia 15 do mês seguinte).
        </p>

          </>
        )}

                {modo === "gestao" ? (
          <div id="detalhe" className="space-y-6">

        <FiltrosErp
          caminho={base}
          campos={["busca", "seguradora", "corretora", "imobiliaria", "mes", "situacao"]}
          valores={valoresTela}
          placeholderBusca="Apólice, Nosso Nº (Corp) ou cliente…"
          situacoes={SITUACOES}
          resumo={
            <>
              {extratos.length} extrato(s) · {pendentes.length} a aprovar · {aprovados.length} aprovado(s)
              {filtroLinha ? ` · ${linhasFiltradas.length}${linhasFiltradas.length === 300 ? "+" : ""} linha(s) encontrada(s)` : ""}
              {filtros.imobiliaria ? " · imobiliária procurada na base única pelo nome" : ""}
            </>
          }
        />

        {erroLinhasAbertas && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Não consegui carregar as linhas do extrato: {erroLinhasAbertas.message}</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Cartao rotulo="Para identificar" valor={`${resumoIdent.qtd} · ${brl(resumoIdent.valor)}`} cor={resumoIdent.qtd ? "text-red-700" : "text-gray-700"} sub="recebido, ainda sem parcela (pendente de identificação)" />
          <Cartao rotulo="A baixar à mão" valor={resumoGestao.manual} cor={resumoGestao.manual ? "text-red-700" : "text-gray-700"} sub="extratos que dependem de ação humana" />
          <Cartao rotulo="Seriam automáticos" valor={resumoGestao.auto} cor="text-green-700" sub="no padrão (baixa automática desligada, em teste)" />
          <Cartao rotulo="Com linhas a tratar" valor={resumoGestao.aTratar} cor={resumoGestao.aTratar ? "text-orange-700" : "text-gray-700"} sub="estorno, divergente ou não encontrada" />
          <Cartao rotulo="Banco sem extrato" valor={resumoGestao.bancoSemExtrato} cor={resumoGestao.bancoSemExtrato ? "text-red-700" : "text-gray-700"} sub="dias com entrada no Nibo e sem extrato lido" />
          <Cartao rotulo="Saldo a cobrar" valor={brl(saldoAbertoTotal)} cor={saldoAbertoTotal ? "text-o2-navy" : "text-gray-700"} sub="que as seguradoras ainda devem" />
        </div>

        {modo === "gestao" && pendentesLinhas.length > 0 && (
          <section className="space-y-2 rounded-xl border border-red-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">Para identificar: recebido, ainda sem parcela</h2>
              <span />
            </div>
            <p className="text-xs text-gray-600">Toda linha de extrato é parcela até se provar o contrário. Enquanto não for identificada (ou confirmada como não-parcela), o valor conta como recebido, ainda sem parcela.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="px-2 py-1">Empresa</th><th className="px-2 py-1">Seguradora</th><th className="px-2 py-1 text-right">Linhas</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-right">Mais antiga (dias)</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(pendentesLinhas.reduce<Record<string, { corretora: string; seg: string; qtd: number; valor: number; idade: number }>>((acc, l) => {
                    const k = `${l.corretora}|${l.seguradora_abrev}`;
                    const x = acc[k] ?? { corretora: l.corretora, seg: l.seguradora_abrev, qtd: 0, valor: 0, idade: 0 };
                    x.qtd += 1; x.valor += Number(l.valor_comissao); x.idade = Math.max(x.idade, l.idade_dias ?? 0);
                    acc[k] = x; return acc;
                  }, {})).sort((a, b) => b[1].idade - a[1].idade).map(([k, x]) => (
                    <tr key={k}><td className="px-2 py-1">{x.corretora}</td><td className="px-2 py-1 font-medium">{NOME_CURTO[x.seg] ?? x.seg}</td><td className="px-2 py-1 text-right">{x.qtd}</td><td className="px-2 py-1 text-right">{brl(Math.round(x.valor * 100) / 100)}</td><td className="px-2 py-1 text-right">{x.idade}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-o2-navy underline">ver as {Math.min(pendentesLinhas.length, 40)} linhas mais antigas</summary>
              <div className="mt-2 max-h-[320px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="px-2 py-1">Crédito</th><th className="px-2 py-1">Empresa · seguradora</th><th className="px-2 py-1">Extrato</th><th className="px-2 py-1">Nº da apólice</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-right">Dias</th><th className="px-2 py-1">Candidato</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {pendentesLinhas.slice(0, 40).map((l) => (
                      <tr key={l.linha_id}>
                        <td className="whitespace-nowrap px-2 py-1">{formatarData(l.pago_em)}</td>
                        <td className="px-2 py-1">{l.corretora} · {NOME_CURTO[l.seguradora_abrev] ?? l.seguradora_abrev}</td>
                        <td className="px-2 py-1"><Link href={`${hrefTela({ extrato: l.extrato_id })}#extrato-${l.extrato_id}`} className="text-o2-navy hover:underline">linha {l.n}</Link></td>
                        <td className="px-2 py-1">{l.apolice ?? "—"}</td>
                        <td className="px-2 py-1 text-right">{brl(Number(l.valor_comissao))}</td>
                        <td className="px-2 py-1 text-right">{l.idade_dias ?? "—"}</td>
                        <td className="px-2 py-1 text-gray-600">{l.candidato_imobiliaria || l.candidato_cliente ? [l.candidato_imobiliaria, l.candidato_cliente].filter(Boolean).join(" · ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}

        {modo === "gestao" && outrasEntradas.size > 0 && (
          <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            <b>Entradas do Nibo neste mês que não são receita de seguros</b> (não entram em nenhum total desta tela): {[...outrasEntradas.entries()].map(([cat, v]) => `${cat} ${brl(Math.round(v * 100) / 100)}`).join(" · ")}.
            Transferência entre as duas empresas também fica de fora.
          </p>
        )}

        {filtroLinha && (
          <section className="space-y-2 rounded-xl border border-o2-navy bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Linhas encontradas ({linhasFiltradas.length}{linhasFiltradas.length === 300 ? "+" : ""})</h2>
            {linhasFiltradas.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhuma linha de extrato com esse filtro.</p>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-2 py-1">Extrato</th>
                      <th className="px-2 py-1">Classificação</th>
                      <th className="px-2 py-1">Nosso nº do Corp</th>
                      <th className="px-2 py-1">Nº da apólice</th>
                      <th className="px-2 py-1">Parc.</th>
                      <th className="px-2 py-1">Cliente</th>
                      <th className="px-2 py-1">Imobiliária</th>
                      <th className="px-2 py-1 text-right">Recebido</th>
                      <th className="px-2 py-1 text-right">Esperado</th>
                      <th className="px-2 py-1">Obs.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {linhasFiltradas.map((l) => {
                      const e = extratoPorId[l.extrato_id];
                      return (
                        <tr key={l.id}>
                          <td className="px-2 py-1">
                            <Link href={`${hrefTela({ extrato: l.extrato_id })}#extrato-${l.extrato_id}`} className="text-o2-navy hover:underline">
                              {e?.seg_abrev} · {e ? formatarData(e.data_recebimento ?? e.competencia) : ""}
                            </Link>
                          </td>
                          <td className="px-2 py-1"><span className={`rounded-full px-2 py-0.5 ${CLASSE[l.conferencia ?? ""]?.cor ?? "bg-gray-100"}`}>{CLASSE[l.conferencia ?? ""]?.texto ?? "—"}</span></td>
                          <td className="px-2 py-1">{l.documento_id ? <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">{l.documento?.nosso_numero_corp ?? "ver"}</Link> : "—"}</td>
                          <td className="px-2 py-1">{l.apolice}</td>
                          <td className="px-2 py-1">{l.parcela ?? "—"}</td>
                          <td className="max-w-[180px] truncate px-2 py-1" title={l.cliente ?? ""}>{l.cliente}</td>
                          <td className="max-w-[160px] truncate px-2 py-1">{l.documento?.imobiliaria?.nome ?? "—"}</td>
                          <td className="px-2 py-1 text-right">{brl(l.valor_comissao)}</td>
                          <td className="px-2 py-1 text-right">{brl(l.valor_esperado)}</td>
                          <td className="max-w-[260px] px-2 py-1 text-gray-500">{l.motivo_auto ?? (l.conferencia === "pro_labore_direto" ? `pró-labore ${pct(l.pct_pro_labore)} pago direto à imob` : "")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {CORRETORAS.filter((emp) => !empresaFiltro || emp === empresaFiltro).map((emp) => {
          const rows = linhasCaixa.filter((c) => c.corretora === emp);
          if (rows.length === 0) return null;
          const r2x = (v: number) => Math.round(v * 100) / 100;
          const tot = {
            pagou: r2x(rows.reduce((t, c) => t + (c.esperado ?? 0), 0)), previsto: r2x(rows.reduce((t, c) => t + (c.previsto ?? 0), 0)), banco: r2x(rows.reduce((t, c) => t + (c.banco ?? 0), 0)),
            abaixar: r2x(rows.reduce((t, c) => t + (c.m && c.m.so_total !== c.m.extratos ? Number(c.m.valor_a_baixar) : 0), 0)),
          };
          return (
        <section key={emp} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="rounded-lg bg-o2-navy px-3 py-2 text-sm font-bold text-white">{emp === "O2 Corretora" ? "O2 Corretora de Seguros : 20001784000180" : "O2 Capitalização e Seguros : 54493758000138"}</h2>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Resumo do mês por seguradora · {emp}</h3>
          <p className="text-xs text-gray-500">
            <b>Pagou</b> = extrato da seguradora (bruto − imposto retido, antes do desconto dela, como o Nibo lança o empréstimo da Porto). <b>Deveria cair</b> = comissão das parcelas que, pela experiência de cada seguradora
            (vencimento + o prazo que ela costuma levar), deveria entrar no mês. <b>Recebemos</b> = o que entrou na conta (Nibo, receita de seguros; o banco é a referência). Fim de semana conta na segunda-feira.
            Clique numa linha para ver os dias e os detalhes; até R$ {TOLERANCIA_CAIXA.toLocaleString("pt-BR")} de diferença é considerado igual.
          </p>
          <div className="overflow-x-auto">
            <div className="min-w-[980px] space-y-1">
              <div className={`${COLUNAS_CAIXA} px-2 py-1 text-[11px] uppercase tracking-wide text-gray-500`}>
                <span>Seguradora</span><span>Extratos</span>
                <span className="text-right">Pagou (extrato)</span><span className="text-right" title="Comissão que deveria cair no mês conforme a experiência de cada seguradora: vencimento da parcela + o prazo que ela costuma levar">Deveria cair (experiência)</span>
                <span className="text-right">Recebemos (Nibo)</span><span className="text-right">Diferença</span><span className="text-right">A baixar</span><span>Situação</span>
              </div>
              {rows.length > 0 && (
                <div className={`${COLUNAS_CAIXA} rounded-lg bg-o2-navy/5 px-2 py-1.5 text-xs font-semibold text-o2-navy`}>
                  <span>Total · {emp} · {mesTexto(`${usaPeriodo ? mesesOrd[0] : mesSel}-01`)}</span><span />
                  <span className="text-right">{brl(tot.pagou)}</span><span className="text-right">{brl(tot.previsto)}</span><span className="text-right">{brl(tot.banco)}</span>
                  <span className="text-right">{brl(Math.round((tot.banco - tot.pagou) * 100) / 100)}</span><span className="text-right">{brl(tot.abaixar)}</span><span />
                </div>
              )}
              {rows.map((c) => {
                const dif = c.banco != null || c.esperado != null ? Math.round(((c.banco ?? 0) - (c.esperado ?? 0)) * 100) / 100 : null;
                const ruins = c.dias.filter((d) => Math.abs(d.dif) > TOLERANCIA_CAIXA);
                const soTotal = c.m != null && c.m.so_total === c.m.extratos;
                return (
                  <details key={c.chave} open={sp.inad === c.seg && (!sp.inadEmp || sp.inadEmp === c.corretora) && (!sp.inadEmp || sp.inadEmp === c.corretora)} className="group rounded-lg border border-gray-200 bg-white open:border-o2-navy">
                    <summary className={`${COLUNAS_CAIXA} cursor-pointer list-none px-2 py-1.5 text-xs hover:bg-gray-50`}>
                      <span className="min-w-0">
                        <span className="block font-medium">{c.segNome}</span>
                        {c.motivos[0] && c.sit.codigo !== "bate" && <span className="block truncate text-[11px] font-normal text-gray-500" title={c.motivos.join(" ")}>{c.motivos[0]}</span>}
                      </span>
                      <span className="text-gray-600" title="extratos com baixa aprovada / extratos do mês">{c.m ? `${c.m.aprovados}/${c.m.extratos - c.m.so_total}` : "—"}</span>
                      <span className="text-right">{c.esperado != null ? brl(c.esperado) : "—"}</span>
                      <span className="text-right text-gray-700">{c.previsto != null ? brl(c.previsto) : "—"}</span>
                      <span className="text-right font-semibold">{c.banco != null ? brl(c.banco) : <span className="font-normal text-gray-400">—</span>}</span>
                      <span className={`text-right ${dif != null && Math.abs(dif) > TOLERANCIA_CAIXA ? "font-semibold text-red-700" : "text-gray-500"}`}>{dif != null ? brl(dif) : "—"}</span>
                      <span className="text-right">{c.m && !soTotal ? brl(c.m.valor_a_baixar) : "—"}</span>
                      <span className="flex items-center gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${c.sit.cor}`}>{c.sit.texto}</span>
                        <span className="text-gray-400 group-open:rotate-90">▸</span>
                      </span>
                    </summary>
                    {c.motivos.length > 0 && (
                      <div className="border-t border-gray-100 bg-amber-50/50 px-3 py-2 text-xs">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Motivo provável (hipótese para investigar)</h3>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-gray-700">{c.motivos.map((t, i) => <li key={i}>{t}</li>)}</ul>
                      </div>
                    )}
                    {c.conf && (
                      <div className="space-y-1 border-t border-gray-100 px-3 py-2 text-xs">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Inadimplência avisada pela seguradora</h3>
                        <p className="text-gray-700">
                          <b>{c.conf.abertas}</b> parcela(s) em aberto (<b>{brl(c.conf.valor)}</b> de prêmio) nos relatórios/e-mails de cobrança desta seguradora
                          {c.conf.regularizadas > 0 && <>; {c.conf.regularizadas} já regularizada(s) (apareceram depois em extrato)</>}.
                          {c.conf.semParcela > 0 && <> {c.conf.semParcela} ainda não foram ligadas a uma parcela do ERP.</>} Sem comissão nem repasse dessas parcelas até o cliente pagar.
                        </p>
                        {c.conf.abertas > 0 && <Link href={`${hrefTela({ inad: c.seg, inadEmp: c.corretora, detalhe: "1" })}#conf-${c.seg}`} className="text-o2-navy underline">ver as parcelas avisadas</Link>}
                        {sp.inad === c.seg && (!sp.inadEmp || sp.inadEmp === c.corretora) && confLinhas.length > 0 && (
                          <div id={`conf-${c.seg}`} className="max-h-[320px] overflow-auto rounded border border-gray-200">
                            <table className="w-full text-[11px]">
                              <thead className="sticky top-0 bg-gray-50 text-left uppercase tracking-wide text-gray-500">
                                <tr><th className="px-2 py-1">Nosso nº do Corp</th><th className="px-2 py-1">Nº da apólice</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Parcela</th><th className="px-2 py-1">Vencimento</th><th className="px-2 py-1 text-right">Dias</th><th className="px-2 py-1 text-right">Prêmio</th><th className="px-2 py-1">Cancela em</th><th className="px-2 py-1">Situação</th></tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {confLinhas.map((l, i) => (
                                  <tr key={i}>
                                    <td className="px-2 py-1">{l.documento_id ? <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">{l.nosso_numero_corp ?? "ver"}</Link> : "—"}</td>
                                    <td className="px-2 py-1">{l.apolice}</td>
                                    <td className="max-w-[220px] truncate px-2 py-1" title={l.cliente ?? ""}>{l.cliente}</td>
                                    <td className="px-2 py-1">{l.parcela_n || "—"}</td>
                                    <td className="px-2 py-1">{formatarData(l.vencimento_original)}</td>
                                    <td className="px-2 py-1 text-right">{l.dias_atraso}</td>
                                    <td className="px-2 py-1 text-right">{l.valor === null ? "—" : brl(Number(l.valor))}</td>
                                    <td className="px-2 py-1">{l.previsao_cancelamento ? formatarData(l.previsao_cancelamento) : "—"}</td>
                                    <td className="px-2 py-1">{l.situacao === "aberta" ? "em aberto" : "regularizada"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                    {c.inad && (
                      <div className="space-y-1 border-t border-gray-100 px-3 py-2 text-xs">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Provável inadimplência (pelo extrato)</h3>
                        {c.inad.conclusivo ? (
                          <>
                            <p className="text-gray-700">
                              {c.inad.sem === 0
                                ? <>Das <b>{c.inad.esperadas}</b> parcelas que deveriam ter pago comissão (cuja data prevista pela regra da seguradora já passou, inclusive as de comissão já esgotada), <b>todas</b> aparecem em extrato ou estão baixadas.</>
                                : <><b>{c.inad.sem}</b> de {c.inad.esperadas} parcelas esperadas (<b>{brl(c.inad.valorSem)}</b> de {brl(c.inad.valorEsperado)}) não aparecem em nenhum extrato nem estão baixadas: o cliente provavelmente não pagou, e a seguradora também não recebeu.</>}
                            </p>
                            {c.inad.sem > 0 && (
                              <Link href={`${hrefTela({ inad: c.seg, inadEmp: c.corretora, detalhe: "1" })}#inad-${c.seg}`} className="text-o2-navy underline">ver as {c.inad.sem} parcelas</Link>
                            )}
                          </>
                        ) : (
                          <p className="text-gray-600">Sem conclusão: {c.inad.porque}. Sem o extrato conferido com o banco não dá para saber quem não pagou.</p>
                        )}
                        {sp.inad === c.seg && (!sp.inadEmp || sp.inadEmp === c.corretora) && erroListaInad && <p className="text-red-700">Não consegui carregar a lista: {erroListaInad}</p>}
                        {c.inad.conclusivo && sp.inad === c.seg && (!sp.inadEmp || sp.inadEmp === c.corretora) && inadLinhas.length > 0 && (
                          <div id={`inad-${c.seg}`} className="max-h-[320px] overflow-auto rounded border border-gray-200">
                            <table className="w-full text-[11px]">
                              <thead className="sticky top-0 bg-gray-50 text-left uppercase tracking-wide text-gray-500">
                                <tr><th className="px-2 py-1">Nosso nº do Corp</th><th className="px-2 py-1">Nº da apólice</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Parcela</th><th className="px-2 py-1">Vencimento</th><th className="px-2 py-1 text-right">Dias</th><th className="px-2 py-1 text-right">Comissão</th></tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {inadLinhas.map((l, i) => (
                                  <tr key={i}>
                                    <td className="px-2 py-1">{l.documento_id ? <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">{l.nosso_numero_corp ?? "ver"}</Link> : "—"}</td>
                                    <td className="px-2 py-1">{l.apolice}</td>
                                    <td className="max-w-[220px] truncate px-2 py-1" title={l.cliente ?? ""}>{l.cliente}</td>
                                    <td className="px-2 py-1">{l.parcela_texto ?? "—"}</td>
                                    <td className="px-2 py-1">{formatarData(l.venc_parcela)}</td>
                                    <td className="px-2 py-1 text-right">{l.dias_atraso}</td>
                                    <td className="px-2 py-1 text-right">{brl(Number(l.valor))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="grid gap-4 border-t border-gray-100 p-3 text-xs md:grid-cols-[minmax(220px,1fr)_2fr]">
                      <div className="space-y-1">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Do extrato</h3>
                        {c.m ? (
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                            <dt className="text-gray-500">Bruto</dt><dd className="text-right">{brl(c.m.bruto)}</dd>
                            <dt className="text-gray-500">Imposto retido</dt><dd className="text-right">{brl(c.m.imposto)} <span className="text-gray-400">({pct(c.m.imposto_pct)})</span></dd>
                            <dt className="text-gray-500">Desconto da seguradora</dt><dd className="text-right">{Number(c.m.desconto) ? brl(c.m.desconto) : "—"}</dd>
                            <dt className="text-gray-500">Líquido depois do desconto</dt><dd className="text-right font-semibold">{brl(c.m.liquido_esperado)}</dd>
                            <dt className="text-gray-500">Extratos</dt><dd className="text-right">{c.m.aprovados}/{c.m.extratos - c.m.so_total} aprovados{c.m.so_total > 0 ? " · só total do mês" : ""}</dd>
                            <dt className="text-gray-500">Soma × extrato</dt><dd className="text-right">{soTotal ? <span className="text-gray-400">só total</span> : c.m.conta_fecha ? <span className="text-green-700">✓ fecha</span> : <span className="font-semibold text-red-700">não fecha</span>}</dd>
                          </dl>
                        ) : (
                          <p className="text-gray-600">Entrou dinheiro no banco, mas o ERP não tem extrato desta seguradora neste mês. Falta salvar o extrato na pasta do Drive ou o ERP ainda não o lê.</p>
                        )}
                        {c.previsto != null && (
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-gray-100 pt-1">
                            <dt className="text-gray-500">Deveria cair (experiência)</dt><dd className="text-right font-semibold">{brl(c.previsto)}</dd>
                            <dt className="text-gray-500">Parcelas que vencem no mês</dt><dd className="text-right">{brl(c.porVencimento)}</dd>
                          </dl>
                        )}
                        {c.previsto != null && ["TOKI", "YELU"].includes(c.seg) && (
                          <p className="rounded bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800">Nesta seguradora o previsto costuma ficar acima do caixa: parte da comissão vai direto à imobiliária (pró-labore) e ainda não está descontada do previsto.</p>
                        )}
                        {c.m && <div className="pt-1"><Chips e={c.m} /></div>}
                        {c.m && <p className="pt-1 text-[11px] text-gray-500"><a href={`#extratos-pendentes`} className="underline">ver os extratos e as linhas</a> (mais abaixo, em “Extratos pendentes” e “Baixas aprovadas”).</p>}
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Banco × extrato, dia a dia{c.dias.length ? ` · ${c.dias.length - ruins.length} de ${c.dias.length} dia(s) batem` : ""}
                        </h3>
                        {ruins.length === 0 ? (
                          <p className="text-green-700">{c.dias.length ? "Todos os dias batem." : "Sem pagamentos no período."}</p>
                        ) : (
                          <table className="w-full">
                            <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                              <tr><th className="px-1 py-0.5">Dia</th><th className="px-1 py-0.5 text-right">Banco</th><th className="px-1 py-0.5 text-right">Extrato</th><th className="px-1 py-0.5 text-right">Diferença</th><th className="px-1 py-0.5">Leitura</th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {ruins.map((d) => (
                                <tr key={d.dia}>
                                  <td className="px-1 py-0.5">{formatarData(d.dia)}</td>
                                  <td className="px-1 py-0.5 text-right">{d.banco ? brl(d.banco) : "—"}</td>
                                  <td className="px-1 py-0.5 text-right">{d.extrato ? brl(d.extrato) : "—"}</td>
                                  <td className="px-1 py-0.5 text-right font-semibold text-red-700">{brl(d.dif)}</td>
                                  <td className="px-1 py-0.5 text-gray-600">{d.extrato === 0 && d.banco > 0 ? "entrou no banco, sem extrato lido" : d.banco === 0 && d.extrato > 0 ? "extrato sem entrada no banco" : "valores diferentes"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {c.dias.length > ruins.length && ruins.length > 0 && (
                          <details className="pt-1">
                            <summary className="cursor-pointer text-[11px] text-o2-navy underline">ver também os {c.dias.length - ruins.length} dia(s) que batem</summary>
                            <table className="mt-1 w-full">
                              <tbody className="divide-y divide-gray-100">
                                {c.dias.filter((d) => Math.abs(d.dif) <= TOLERANCIA_CAIXA).map((d) => (
                                  <tr key={d.dia} className="text-gray-600">
                                    <td className="px-1 py-0.5">{formatarData(d.dia)}</td>
                                    <td className="px-1 py-0.5 text-right">{brl(d.banco)}</td>
                                    <td className="px-1 py-0.5 text-right">{brl(d.extrato)}</td>
                                    <td className="px-1 py-0.5 text-right">{brl(d.dif)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        )}
                      </div>
                    </div>
                    {modo === "gestao" && (
                      <>
                        {(() => {
                          const doBloco = extratos.filter((e) => e.corretora === c.corretora && e.seg_abrev === c.seg).map((e) => ({ e, t: totaisPor.get(e.id) })).filter((x): x is { e: Extrato; t: TotaisExtrato } => Boolean(x.t));
                          if (doBloco.length === 0) return null;
                          const fator = (x: { e: Extrato }) => 1 - Number(x.e.imposto_pct) / 100;
                          const soma = (f2: (t: TotaisExtrato) => number | string) => Math.round(doBloco.reduce((t, x) => t + Number(f2(x.t)) * fator(x), 0) * 100) / 100;
                          const ident = soma((t) => t.soma_identificada), naoParc = soma((t) => t.soma_nao_parcela), pend = soma((t) => t.soma_pendente_sem_parcela), erpNaoCorp = soma((t) => t.erp_identifica_corp_nao);
                          const erpLiq = Math.round((ident + naoParc + pend) * 100) / 100;
                          const nParc = doBloco.reduce((t, x) => t + Number(x.t.qtd_identificada), 0);
                          const tol = TOLERANCIA_CAIXA * Math.max(1, nParc);
                          const difB = c.banco == null ? null : Math.round((c.banco - erpLiq) * 100) / 100;
                          const fecha = difB != null && Math.abs(difB) <= tol;
                          return (
                            <div className="space-y-1 border-t border-gray-100 bg-gray-50/60 px-3 py-2 text-xs text-gray-700">
                              <p>
                                <b>ERP (líquido do imposto)</b>: parcelas identificadas <b>{brl(ident)}</b> + não é parcela <b>{brl(naoParc)}</b> + recebido sem parcela <b>{brl(pend)}</b> = <b>{brl(erpLiq)}</b>
                                {" · "}banco (Nibo) <b>{brl(c.banco)}</b>{" · "}
                                {difB == null ? <span className="text-red-700">sem entrada no banco</span> : fecha ? <span className="font-semibold text-green-700">fecha com o banco (tolerância {brl(tol)})</span> : <span className="font-semibold text-red-700">não fecha: {difB > 0 ? "banco a mais" : "banco a menos"} {brl(Math.abs(difB))} (tolerância {brl(tol)})</span>}
                              </p>
                              {(() => {
                                const be = extratos.filter((e) => e.corretora === c.corretora && e.seg_abrev === c.seg).map((e) => ({ e, b: baixaErpPor.get(e.id) })).filter((x): x is { e: Extrato; b: BaixaErpExtrato } => Boolean(x.b));
                                if (be.length === 0) return null;
                                const sm = (f2: (b: BaixaErpExtrato) => number | string) => Math.round(be.reduce((t, x) => t + Number(f2(x.b)) * (1 - Number(x.e.imposto_pct) / 100), 0) * 100) / 100;
                                const n = (f2: (b: BaixaErpExtrato) => number) => be.reduce((t, x) => t + f2(x.b), 0);
                                return (
                                  <p className="text-gray-700">
                                    <b>Baixa própria do ERP (teste, não entra nos totais oficiais)</b>: ERP baixou <b>{brl(sm((b) => b.erp_valor))}</b> ({n((b) => b.erp_qtd)} linhas) · Corp baixou <b>{brl(sm((b) => b.corp_valor))}</b> ({n((b) => b.corp_qtd)}) · só o ERP {n((b) => b.so_erp_qtd)} ({brl(sm((b) => b.so_erp_valor))}) · só o Corp {n((b) => b.so_corp_qtd)} ({brl(sm((b) => b.so_corp_valor))}) · sem baixa em nenhum {n((b) => b.nenhum_qtd)} ({brl(sm((b) => b.nenhum_valor))}) · banco {brl(c.banco)}. Valores líquidos do imposto; o Corp registra a comissão cheia, inclusive o pró-labore pago direto.
                                  </p>
                                );
                              })()}
                              {erpNaoCorp > 0 && <p className="text-blue-800">O ERP identifica {brl(erpNaoCorp)} que o Corp não reconhece (ainda não aparece como recebido no Corp).</p>}
                            </div>
                          );
                        })()}
                        <Suspense fallback={<p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">carregando histórico e anotações…</p>}>
                          <PainelControleBloco seg={c.seg} corretora={c.corretora} mes={mesSel} ancora={`bloco-${c.chave.replace(/\W/g, "")}`} />
                        </Suspense>
                        <div className="space-y-2 border-t border-gray-100 p-3">
                          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Extratos desta seguradora no mês — conferir linhas e aprovar a baixa</h4>
                          {extratos.filter((e) => e.corretora === c.corretora && e.seg_abrev === c.seg).sort((a, b) => Number(Boolean(a.baixa_aprovada_em)) - Number(Boolean(b.baixa_aprovada_em))).map((e) => {
                            const { situacao: banco, dia: bancoDia } = bancoDoExtrato(c.dias, e.data_recebimento);
                            const auto = avaliarBaixaAutomatica(e, banco, Number(totaisPor.get(e.id)?.qtd_pendente ?? 0));
                            return (
                              <div key={e.id}>
                                <ControleExtrato extratoId={e.id} seguradora_id={e.seguradora_id} corretora_id={e.corretora_id ?? ""} mes={mesSel} ancora={`extrato-${e.id}`} banco={banco} bancoDia={bancoDia} aprovada={Boolean(e.baixa_aprovada_em)} seria={auto.seria} faltas={auto.faltas} tot={totaisPor.get(e.id) ? { qtdPendente: Number(totaisPor.get(e.id)!.qtd_pendente), somaPendente: Number(totaisPor.get(e.id)!.soma_pendente_sem_parcela), idadeMax: totaisPor.get(e.id)!.idade_max_pendente_dias, erpNaoCorp: Number(totaisPor.get(e.id)!.erp_identifica_corp_nao) } : undefined} baixaErp={baixaErpPor.get(e.id)} totalExtrato={Number(e.total_extrato ?? 0)} />
                                {card(e)}
                              </div>
                            );
                          })}
                          {extratos.filter((e) => e.corretora === c.corretora && e.seg_abrev === c.seg).length === 0 && <p className="text-xs text-gray-500">Nenhum extrato lido neste mês para esta seguradora.</p>}
                        </div>
                      </>
                    )}
                  </details>
                );
              })}
            </div>
          </div>
        </section>
          );
        })}


        <details id="para-tratar" className="rounded-xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-o2-navy">Para tratar ({paraTratar.length}{paraTratar.length === 500 ? "+" : ""})</summary>
          <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500">
            Linhas de extratos já aprovados que não viraram baixa (estorno, divergente, não encontrada). Escreva o motivo/o que foi feito e marque “resolvida”. {tratadas ?? 0} já resolvida(s).
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
                    <th className="px-2 py-1">Nosso nº do Corp</th>
                    <th className="px-2 py-1">Nº da apólice</th>
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
                          <RascunhoAutomatico sufixo={l.id} />
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
          </div>
        </details>

        <details className="rounded-xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-o2-navy">Lista pronta para o Corp</summary>
          <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500">
            Tudo o que o InCorp do Corp aceita dos extratos aprovados (apólices e endossos/estornos; divergentes vão marcados para conferir), na ordem Seguradora → Nosso Nº → Parcela, com valor bruto,
            data de recebimento e previsão de repasse (dia 15 do mês seguinte). Ficam de fora só as “não encontradas” (= linhas amarelas do InCorp, pendência de cadastro/emissão).
            Tokio, Porto, Pottencial e Too: lançar pelo InCorp com o arquivo original e usar a lista para conferir; as demais seguradoras, à mão. Abre no Excel. {linhasParaCorp} linha(s) aprovada(s), {jaBaixadasCorp} já baixada(s) no Corp.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <a href="/erp/baixas/lista-corp" className="rounded-lg bg-o2-navy px-3 py-1.5 text-white">Baixar lista completa (CSV)</a>
            <a href="/erp/baixas/lista-corp?pendentes_corp=1" className="rounded-lg border border-o2-navy px-3 py-1.5 text-o2-navy">Só o que ainda não está baixado no Corp</a>
            {meses.map((m) => (
              <a key={m} href={`/erp/baixas/lista-corp?mes=${m.slice(0, 7)}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700">{mesTexto(m)}</a>
            ))}
          </div>
          </div>
        </details>


        <details className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-o2-navy">Como cada linha é classificada</summary>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.cheia.cor}`}>Cheia</span> recebido = prêmio × % de comissão do documento.</li>
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.pro_labore_direto.cor}`}>Pró-labore conferido</span> faltou exatamente o pró-labore que a seguradora paga direto à imobiliária.</li>
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.estorno.cor}`}>Estorno</span> valor negativo (endosso de cancelamento/restituição).</li>
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.divergente.cor}`}>Divergente</span> % pago diferente do documento, ou endosso.</li>
            <li><span className={`rounded-full px-2 py-0.5 ${CLASSE.nao_encontrada.cor}`}>Não encontrada</span> apólice/parcela que o ERP não conhece.</li>
            <li>Ao aprovar, só <b>cheia</b> e <b>pró-labore conferido</b> viram recebimento no ERP; o resto vai para “Para tratar”. Para o Corp vale o extrato inteiro menos as não encontradas.</li>
          </ul>
        </details>
          </div>
        ) : (
          <Link href="/erp/baixas/gestao" className="block rounded-xl border border-o2-navy/30 bg-white p-4 text-sm text-o2-navy hover:bg-gray-50">
            <b>Detalhe por seguradora, extratos, aprovação da baixa e lista do Corp</b> agora ficam na aba lateral <u>Gestão das baixas</u> →
          </Link>
        )}
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

function ExtratoCard({ e, linhas, aberto, base, tot, estados }: { e: Extrato; linhas: LinhaExtrato[]; aberto: boolean; base: string; tot?: TotaisExtrato; estados?: Map<string, EstadoLinha> }) {
  const temPendente = Number(tot?.qtd_pendente ?? 0) > 0; // informativo: o bloqueio de aprovar está desligado por enquanto
  return (
    <div id={`extrato-${e.id}`} className={`scroll-mt-4 rounded-lg border ${aberto ? "border-o2-navy" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
        <span className="font-semibold text-o2-navy">{e.seguradora}</span>
        <span>{e.corretora ?? "corretora ?"}</span>
        <span className="text-gray-500">{e.origem === "drive" ? "pasta do Drive" : "e-mail"} · {e.arquivo_nome ?? e.arquivo_path ?? "—"}</span>
        <Chips e={e} />
        <span>
          Soma {brl(e.soma_linhas)} × extrato {brl(e.total_extrato)}{" "}
          {e.conta_fecha ? <span className="text-green-700">✓ fecha</span> : <span className="font-semibold text-red-700">não fecha</span>}
        </span>
        <span>Imposto {brl(e.imposto)} · líquido {brl(e.liquido_sem_desconto)}</span>
        {e.n_cheia + e.n_pro_labore === 0 ? <span className="font-semibold text-red-700" title="Nenhuma linha deste extrato foi reconhecida como parcela do ERP: nada a baixar até identificar as linhas">nenhuma linha reconhecida como parcela</span> : <span className="font-semibold">A baixar {brl(e.valor_a_baixar)}</span>}
        {e.ja_baixadas_corp > 0 && <span className="text-gray-500">{e.ja_baixadas_corp} já baixada(s) no Corp</span>}
        <span className="text-gray-400">{e.entrou_banco_valor != null ? `banco: ${brl(e.entrou_banco_valor)}` : "banco: ver no resumo"}</span>
        <Link href={aberto ? `${base}#extrato-${e.id}` : `${base}${base.includes("?") ? "&" : "?"}extrato=${e.id}#extrato-${e.id}`} className="ml-auto text-o2-navy underline">{aberto ? "fechar" : "ver linhas"}</Link>
      </div>
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
            {temPendente && <span className="text-[11px] font-medium text-red-700">{tot?.qtd_pendente} linha(s) pendente(s) de identificação ({brl(Number(tot?.soma_pendente_sem_parcela ?? 0))}).</span>}
            <span className="text-[11px] text-gray-500">
              Grava {e.n_cheia + e.n_pro_labore} recebimento(s) ({brl(e.valor_a_baixar)}) no ERP e quita as parcelas; {e.n_estorno + e.n_divergente + e.n_nao_encontrada} linha(s) vão para “Para tratar”.
            </span>
          </form>
          </>
        )}
        {aberto && (
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Classificação</th>
                <th className="px-2 py-1">Estado</th>
                <th className="px-2 py-1">Nosso nº do Corp</th>
                <th className="px-2 py-1">Nº da apólice</th>
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
                  <td className="px-2 py-1">{(() => { const st = estados?.get(l.id); if (!st) return <span className="text-gray-300">—</span>; const x = ESTADO_LINHA[st.estado]; return <><span className={`rounded-full px-2 py-0.5 text-[11px] ${x?.cor ?? "bg-gray-100"}`}>{x?.t ?? st.estado}</span>{st.estado === "pendente_identificacao" && st.idade_dias != null && <div className="text-[10px] text-gray-500">{st.idade_dias} dia(s){st.candidato_imobiliaria ? ` · talvez ${st.candidato_imobiliaria}` : ""}</div>}{st.estado === "nao_parcela_confirmada" && st.fora_tipo && <div className="text-[10px] text-gray-500">{st.fora_tipo}</div>}</>; })()}</td>
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
        )}
      </div>
    </div>
  );
}

// Soma as duas empresas por seguradora (foco na seguradora, não no produto): mesmas colunas e mesma regra dos quadros por CNPJ.
// Soma, dia a dia, o previsto e o recebido (Nibo) das duas empresas numa série única.
function consolidarDias(a: PontoDia[], b: PontoDia[]): PontoDia[] {
  const m = new Map<number, PontoDia>();
  for (const p of [...a, ...b]) {
    const x = m.get(p.dia);
    if (x) { x.regra += p.regra; x.exper += p.exper; x.recebido += p.recebido; } else m.set(p.dia, { ...p });
  }
  return [...m.values()].sort((x, y) => x.dia - y.dia).map((p) => ({ dia: p.dia, regra: Math.round(p.regra * 100) / 100, exper: Math.round(p.exper * 100) / 100, recebido: Math.round(p.recebido * 100) / 100 }));
}

function consolidarQuadros(a: LinhaTopo[], b: LinhaTopo[]): LinhaTopo[] {
  const m = new Map<string, LinhaTopo>();
  for (const l of [...a, ...b]) {
    const x = m.get(l.seg);
    if (!x) { m.set(l.seg, { ...l }); continue; }
    x.prevista += l.prevista; x.regra += l.regra; x.extratos += l.extratos; x.baixadas += l.baixadas; x.nibo += l.nibo;
  }
  return [...m.values()].map((l) => ({ ...l, prevista: Math.round(l.prevista * 100) / 100, regra: Math.round(l.regra * 100) / 100, extratos: Math.round(l.extratos * 100) / 100, baixadas: Math.round(l.baixadas * 100) / 100, nibo: Math.round(l.nibo * 100) / 100 })).sort((x, y) => x.nome.localeCompare(y.nome));
}

function TabelaControle({ titulo, linhas }: { titulo: string; linhas: LinhaTopo[] }) {
  const soma = (f: (l: LinhaTopo) => number) => Math.round(linhas.reduce((t, l) => t + f(l), 0) * 100) / 100;
  const tot = { prevista: soma((l) => l.prevista), regra: soma((l) => l.regra), extratos: soma((l) => l.extratos), baixadas: soma((l) => l.baixadas), nibo: soma((l) => l.nibo) };
  const dExtBaixadas = (l: { extratos: number; baixadas: number }) => Math.round((l.extratos - l.baixadas) * 100) / 100;
  const dExtNibo = (l: { extratos: number; nibo: number }) => Math.round((l.extratos - l.nibo) * 100) / 100;
  const th = "whitespace-nowrap px-1 py-1.5 text-right font-semibold";
  const td = "whitespace-nowrap px-1 py-1 text-right tabular-nums";
  // números como numa planilha (sem o "R$" repetido; os valores são em reais)
  const n2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cel = (v: number) => (Math.abs(v) < 0.005 ? <span className="text-gray-300">—</span> : n2(v));
  const difCel = (v: number) => (
    <span className={Math.abs(v) > TOLERANCIA_CAIXA ? "font-semibold text-red-700" : "text-gray-500"}>{Math.abs(v) < 0.005 ? "—" : n2(v)}</span>
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-300">
      <table className="w-full text-[11px]">
        <caption className="bg-o2-navy px-3 py-2 text-left text-sm font-bold text-white">{titulo} <span className="text-[10px] font-normal opacity-80">(valores em R$)</span></caption>
        <thead className="bg-gray-100 text-[11px] uppercase tracking-wide text-gray-600">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Seguradora</th>
            <th className={th} title="Comissão que deveria cair no mês pela REGRA da seguradora (boleto/fatura/nota fiscal + o prazo próprio dela), sem atraso nem inadimplência. Seguradora sem regra usa a experiência.">Prevista<br />(regra)</th>
            <th className={th} title="Comissão que deveria cair no mês pela EXPERIÊNCIA: vencimento da parcela + o prazo que a seguradora costuma levar (histórico, que inclui atrasos)">Prevista<br />(experiência)</th>
            <th className={th} title="O que a seguradora pagou, segundo os extratos lidos pelo ERP">Extratos de<br />comissão</th>
            <th className={th} title="Já baixado no Corp no mês (data da quitação)">Baixadas</th>
            <th className={th} title="O que entrou na conta (Nibo, receita de seguros)">Nibo</th>
            <th className={th} title="Extratos de comissão − Baixadas: o que a seguradora pagou e ainda não foi baixado (negativo: baixado a mais)">Dif.<br />extratos × baixadas</th>
            <th className={th} title="Extratos de comissão − Nibo: o que a seguradora diz que pagou e não entrou na conta (negativo: entrou mais do que os extratos explicam)">Dif.<br />extratos × Nibo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {linhas.length === 0 && <tr><td colSpan={8} className="px-2 py-3 text-center text-gray-500">Nada neste mês.</td></tr>}
          {linhas.map((l) => (
            <tr key={l.seg}>
              <td className="whitespace-nowrap px-2 py-1 font-medium text-gray-800">{l.nome}</td>
              <td className={td}>{cel(l.regra)}</td>
              <td className={td}>{cel(l.prevista)}</td>
              <td className={td}>{cel(l.extratos)}</td>
              <td className={td}>{cel(l.baixadas)}</td>
              <td className={td}>{cel(l.nibo)}</td>
              <td className={td}>{difCel(dExtBaixadas(l))}</td>
              <td className={td}>{difCel(dExtNibo(l))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-100 font-bold text-o2-navy">
          <tr>
            <td className="px-2 py-1.5">TOTAIS</td>
            <td className={td}>{n2(tot.regra)}</td>
            <td className={td}>{n2(tot.prevista)}</td>
            <td className={td}>{n2(tot.extratos)}</td>
            <td className={td}>{n2(tot.baixadas)}</td>
            <td className={td}>{n2(tot.nibo)}</td>
            <td className={td}>{difCel(dExtBaixadas(tot))}</td>
            <td className={td}>{difCel(dExtNibo(tot))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Faixas de valor do eixo vertical (modelo do Matheus): 1 mil, 2 mil, 3 mil, 3–5, 5–10, ... 55–60 mil; acima disso a escala se estende
// só até o maior valor do mês (ex.: picos de vencimento perto de R$ 190 mil).
const FAIXAS_BASE = [0, 1000, 2000, 3000, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 55000, 60000];
const FAIXAS_EXTRA = [80000, 100000, 150000, 200000, 250000, 300000, 400000, 500000];
const rotuloFaixa = (lo: number, hi: number) => (lo === 0 ? "até 1 mil" : `${lo / 1000}–${hi / 1000} mil`);

function GraficoDiario({ titulo, pontos }: { titulo: string; pontos: PontoDia[] }) {
  const maior = Math.max(0, ...pontos.map((p) => Math.max(p.regra, p.exper, p.recebido)));
  const limites = [...FAIXAS_BASE];
  for (const e of FAIXAS_EXTRA) if (limites[limites.length - 1] < maior) limites.push(e);
  const nFaixas = limites.length - 1;
  const posicao = (v: number) => {
    if (v <= 0) return 0;
    for (let i = 0; i < nFaixas; i++) if (v < limites[i + 1]) return i + (v - limites[i]) / (limites[i + 1] - limites[i]);
    return nFaixas;
  };
  const W = 1100, esq = 86, dir = 8, topo = 8, base = 26, alturaFaixa = 22;
  const H = topo + nFaixas * alturaFaixa + base;
  const largura = W - esq - dir;
  const slot = largura / Math.max(pontos.length, 1);
  const barra = slot * 0.27;
  const yDe = (v: number) => topo + (nFaixas - posicao(v)) * alturaFaixa;
  const mil = (v: number) => (Math.abs(v) < 0.5 ? "–" : Math.round(v).toLocaleString("pt-BR"));
  const totalRegra = pontos.reduce((t, p) => t + p.regra, 0);
  const totalExper = pontos.reduce((t, p) => t + p.exper, 0);
  const totalRec = pontos.reduce((t, p) => t + p.recebido, 0);
  return (
    <div className="space-y-2 rounded-lg border border-gray-300 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-o2-navy">{titulo}</h3>
        <div className="flex items-center gap-4 text-xs text-gray-600">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-o2-navy" /> Prevista (regra)</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-sky-500" /> Prevista (experiência)</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-o2-coral" /> Recebido no dia</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Prevista pela regra, prevista pela experiência e recebida no dia — ${titulo}`}>
        {limites.slice(0, -1).map((lo, i) => {
          const y = topo + (nFaixas - i - 1) * alturaFaixa;
          return (
            <g key={lo}>
              <rect x={esq} y={y} width={largura} height={alturaFaixa} className={i % 2 ? "fill-gray-50" : "fill-white"} />
              <line x1={esq} x2={W - dir} y1={y + alturaFaixa} y2={y + alturaFaixa} className="stroke-gray-200" strokeWidth={1} />
              <text x={esq - 6} y={y + alturaFaixa / 2 + 3} textAnchor="end" fontSize={10} className="fill-gray-500">{rotuloFaixa(lo, limites[i + 1])}</text>
            </g>
          );
        })}
        {pontos.map((p, i) => {
          const x0 = esq + i * slot;
          const base0 = topo + nFaixas * alturaFaixa;
          return (
            <g key={p.dia}>
              {p.regra > 0 && (
                <rect x={x0 + slot * 0.06} y={yDe(p.regra)} width={barra} height={Math.max(base0 - yDe(p.regra), 1)} className="fill-o2-navy">
                  <title>{`Dia ${p.dia} · prevista pela regra ${brl(p.regra)}`}</title>
                </rect>
              )}
              {p.exper > 0 && (
                <rect x={x0 + slot * 0.35} y={yDe(p.exper)} width={barra} height={Math.max(base0 - yDe(p.exper), 1)} className="fill-sky-500">
                  <title>{`Dia ${p.dia} · prevista pela experiência ${brl(p.exper)}`}</title>
                </rect>
              )}
              {p.recebido > 0 && (
                <rect x={x0 + slot * 0.64} y={yDe(p.recebido)} width={barra} height={Math.max(base0 - yDe(p.recebido), 1)} className="fill-o2-coral">
                  <title>{`Dia ${p.dia} · recebido ${brl(p.recebido)}`}</title>
                </rect>
              )}
              <text x={x0 + slot / 2} y={H - 9} textAnchor="middle" fontSize={10} className="fill-gray-600">{p.dia}</text>
            </g>
          );
        })}
      </svg>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-[10px]">
          <thead className="text-gray-500">
            <tr>
              <th className="px-1 py-0.5 text-left font-semibold">Dia</th>
              {pontos.map((p) => <th key={p.dia} className="px-0.5 py-0.5 text-right font-semibold">{p.dia}</th>)}
              <th className="px-1 py-0.5 text-right font-bold text-o2-navy">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="whitespace-nowrap px-1 py-0.5 font-semibold text-o2-navy">Prevista (regra)</td>
              {pontos.map((p) => <td key={p.dia} className="px-0.5 py-0.5 text-right" title={brl(p.regra)}>{mil(p.regra)}</td>)}
              <td className="whitespace-nowrap px-1 py-0.5 text-right font-bold">{mil(totalRegra)}</td>
            </tr>
            <tr>
              <td className="whitespace-nowrap px-1 py-0.5 font-semibold text-sky-600">Prevista (experiência)</td>
              {pontos.map((p) => <td key={p.dia} className="px-0.5 py-0.5 text-right" title={brl(p.exper)}>{mil(p.exper)}</td>)}
              <td className="whitespace-nowrap px-1 py-0.5 text-right font-bold">{mil(totalExper)}</td>
            </tr>
            <tr>
              <td className="whitespace-nowrap px-1 py-0.5 font-semibold text-o2-coral">Recebido no dia</td>
              {pontos.map((p) => <td key={p.dia} className="px-0.5 py-0.5 text-right" title={brl(p.recebido)}>{mil(p.recebido)}</td>)}
              <td className="whitespace-nowrap px-1 py-0.5 text-right font-bold">{mil(totalRec)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, sub, cor }: { rotulo: string; valor: number | string; sub: string; cor: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{rotulo}</div>
      <div className={`text-xl font-bold ${cor}`}>{valor}</div>
      <div className="text-[11px] text-gray-500">{sub}</div>
    </div>
  );
}
