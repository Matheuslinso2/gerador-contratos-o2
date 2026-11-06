import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";
import { urlCard } from "@/lib/erp/renovacaoCards";
import { dadosDeCabecalhoPorId, tipoDoCabecalho } from "@/lib/erp/documentos";
import BotaoVerDocumento from "../BotaoVerDocumento";
import InfoLegenda from "@/components/InfoLegenda";
import PainelResumoAba from "@/app/erp/PainelResumoAba";
import NavegadorMes from "../NavegadorMes";
import { periodoDoMes, IDADE_RETRATO_ABERTO } from "@/lib/erp/periodo";
import PaginaErp from "../PaginaErp";
import BotaoAutorizarCriacao from "./BotaoAutorizarCriacao";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // a criação de cards (ação do botão) fala com o Bitrix card a card
export const metadata = { title: "Renovação" };

// ERP O2 — Renovação (Matheus 28/10/2026). PRÉVIA DE CRIAÇÃO DE CARDS: todas as apólices vigentes que vencem no período, já organizadas como serão os
// cards, em 5 blocos que seguem os funis (SPA) de destino: Seguro Fiança (SPA 1042) · Capitalização (SPA 1048) · Automóvel (SPA 1050) ·
// Ramos Elementares com lotes (SPA 1046: incêndio imobiliário, 1 card por imobiliária + seguradora, Segimob em lote separado como o robô de renovações RE) ·
// Ramos Elementares, demais produtos (SPA 1046: 1 card por apólice). O Matheus autoriza a criação bloco a bloco. NESTA FASE a tela é SÓ LEITURA:
// a autorização ainda não está ligada ao Bitrix e nada é criado.
type Doc = {
  documento_id: string; nosso_numero: number; numero_apolice: string | null; produto: string; ramo: string; seguradora: string | null;
  imobiliaria_id: string | null; imobiliaria: string | null; cliente_id: string | null; cliente: string | null; cliente_incompleto: boolean | null;
  vigencia_inicio: string | null; vigencia_fim: string; premio_liquido: number | null; comissao_pct: number | null; forma: string | null;
  destino: string; tipo_card: "lote" | "individual"; chave_card: string; status_renovacao: string | null; anexos: number;
};
type Extra = { corp: number | null; abrev: string; canais: string[]; card: { entity: number; id: number } | null };
type BlocoId = "fianca" | "cap" | "auto" | "re_lotes" | "re_demais";
type Card = { chave: string; tipo: "lote" | "individual"; titulo: string; docs: Doc[]; fim: string; premio: number; comissaoMin: number | null; segimob: boolean; canais: string[] };

const BLOCOS: { id: BlocoId; titulo: string; funil: string; regra: string }[] = [
  { id: "fianca", titulo: "Renovações de Seguro Fiança", funil: "SPA 1042 · Renovação (cat. 32)", regra: "1 card por apólice" },
  { id: "cap", titulo: "Renovações de Capitalização", funil: "SPA 1048 · Reaplicações (cat. 38)", regra: "1 card por título (apólice)" },
  { id: "auto", titulo: "Renovações de Automóvel", funil: "SPA 1050 · Pipeline padrão (cat. 30)", regra: "1 card por apólice" },
  { id: "re_lotes", titulo: "Ramos Elementares — incêndio imobiliário em lotes", funil: "SPA 1046 · Renovações (cat. 34)", regra: "1 card por imobiliária + seguradora (lote); itens renovados pela Segimob ficam em lote separado (SEG/seguradora)" },
  { id: "re_demais", titulo: "Ramos Elementares — demais produtos", funil: "SPA 1046 · Renovações (cat. 34)", regra: "1 card por apólice (residencial, empresarial, condomínio, vida, portáteis, RC…)" },
];
// Complemento da explicação (ⓘ) de cada bloco: como as apólices viram cards.
const INFO_BLOCO: Record<BlocoId, string> = {
  fianca: "Apólices de Seguro Fiança vigentes que vencem no período. Cada apólice vira um card de renovação.",
  cap: "Títulos de Capitalização vigentes que vencem no período. Cada título (apólice) vira um card de reaplicação.",
  auto: "Apólices de Automóvel vigentes que vencem no período. Cada apólice vira um card de renovação.",
  re_lotes: "Apólices de Seguro Incêndio de imobiliárias vigentes que vencem no período, reunidas em lote: um card por imobiliária e seguradora. Os itens renovados pela Segimob ficam em um lote separado, como faz o robô de renovações de Ramos Elementares. (Seguro Incêndio não é garantia locatícia.)",
  re_demais: "Apólices de Ramos Elementares que não entram em lote (residencial, empresarial, condomínio, vida, portáteis, RC e outros) vigentes que vencem no período. Cada apólice vira um card.",
};
const STATUS: Record<string, string> = { a_renovar: "A renovar", em_cotacao: "Em cotação", renovado: "Renovado", nao_renovado: "Não renovado", cancelado: "Cancelado" };
const NOME_SEG: Record<string, string> = { TOKI: "TOKIO", YELU: "YELLUM", PORT: "PORTO", ALLI: "ALLIANZ", ZURI: "ZURICH", ALF: "ALFA", BRAD: "BRADESCO" };
const mmaaaa = (iso: string) => `${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const isoData = (d: Date) => d.toISOString().slice(0, 10);
const nomeSeg = (s: string | null) => (s ? NOME_SEG[s] ?? s : "SEM SEGURADORA");
const lotes = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export default async function ErpRenovacaoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  // Período padrão do ERP (Matheus 01/11): abre no MÊS CORRENTE; ?mes=AAAA-MM navega. O mês define o recorte (fim de vigência no mês = "do mês").
  const per = periodoDoMes(f.mes);
  const de = per.de;
  const ate = per.ate;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  // Consultas independentes disparam juntas (antes rodavam em série: ~2,8 s no banco); a cadeia de documentos segue em paralelo com elas
  type Aberta = { bitrix_card_id: string; status: string; vence_em: string; doc: { id: string; nosso_numero: number; numero_apolice: string | null; situacao: string; loc: { nome: string } | { nome: string }[] | null; ramo: { produto: string } | { produto: string }[] | null } | null };
  type Herdada = { documento_id: string; nosso_numero: number; numero_apolice: string | null; produto: string; ramo: string; seguradora: string | null; cliente_id: string | null; cliente: string | null; imobiliaria: string | null; vigencia_fim: string; dias_desde_vencimento: number; mes_origem: string; bitrix_card_id: string | null; status_renovacao: string | null; situacao_renovacao: string };
  type LoteResumo = { documento_id: string; nosso_numero: number; origem_ref: string; imobiliaria: string | null; seguradora: string | null; mes: string; confirmados: number; sugestoes: number };
  type LinhaIndice = { mes: string; seguradora: string; produto: string | null; imobiliaria: string | null; vencidas: number; renovadas: number; provaveis: number; nao_renovadas: number; aguardando: number; canceladas: number; em_vigor: number; premio_nao_renovado: number };
  type NaoRenov = { documento_id: string; nosso_numero: number; numero_apolice: string | null; vigencia_fim: string; seguradora: string; produto: string | null; imobiliaria: string | null; premio_liquido: number | null; desfecho: string; motivo: string | null };
  const pAbertas = (async () => (await supabase
    .from("erp_renovacoes")
    .select("bitrix_card_id, status, vence_em, doc:erp_documentos!erp_renovacoes_documento_id_fkey(id, nosso_numero, numero_apolice, situacao, loc:locatarios!erp_documentos_locatario_id_fkey(nome), ramo:erp_ramos(produto))")
    .in("status", ["a_renovar", "em_cotacao"])
    .not("bitrix_card_id", "is", null)
    .order("vence_em")
    .limit(1500)).data)();
  const pHeranca = (async () => (await supabase.rpc("erp_renovacao_heranca", { p_de: per.de, p_dias: 90 })).data)();
  const pLotes = (async () => (await supabase.rpc("erp_renovacao_lotes_resumo", { p_de: per.de, p_ate: per.ate })).data)();
  // retrato de 60 min (erp_retrato): a view do índice custa ~1,1 s; o cron renova os retratos usados
  const pIndice = (async () => {
    const { data } = await supabase.rpc("erp_retrato", { p_funcao: "erp_renovacao_indice", p_de: "2026-09-01", p_ate: per.ate, p_max_idade: IDADE_RETRATO_ABERTO });
    return ((data ?? []) as LinhaIndice[]);
  })();
  const pNaoRenov = (async () => (await supabase.from("erp_renovacao_desfecho").select("documento_id, nosso_numero, numero_apolice, vigencia_fim, seguradora, produto, imobiliaria, premio_liquido, desfecho, motivo")
    .eq("mes_vencimento", per.mes).in("desfecho", ["nao_renovada", "aguardando_decisao"]).order("vigencia_fim").limit(400)).data)();

  const docs: Doc[] = [];
  for (let p = 0; p < 4; p++) {
    const { data, error } = await supabase
      .rpc("erp_renovacao_documentos", { p_de: de, p_ate: ate, p_produto: f.produto ?? null, p_seguradora: f.seguradora ?? null, p_imobiliaria: f.imobiliaria ?? null, p_busca: f.q ?? null })
      .range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(`erp_renovacao_documentos: ${error.message}`);
    docs.push(...((data ?? []) as Doc[]));
    if ((data ?? []).length < 1000) break;
  }
  const truncado = docs.length >= 4000;

  // complementos por documento: Nosso nº do Corp, abreviação do ramo e canais (Segimob/Superlógica/Base Software/Sohtec) vindos dos produtores do Corp
  const extra = new Map<string, Extra>();
  const ids = docs.map((d) => d.documento_id);
  // cabeçalho padrão (Matheus 28/10): tipo, titular, produto, seguradora e vigência
  const cab = await dadosDeCabecalhoPorId(supabase, ids);
  for (const l of lotes(ids, 120)) {
    const [{ data: dd }, { data: pp }, { data: rn }] = await Promise.all([
      supabase.from("erp_documentos").select("id, nosso_numero_corp, ramo:erp_ramos(abreviacao)").in("id", l),
      supabase.from("erp_documento_produtores").select("documento_id, produtor_corp_nome").in("documento_id", l),
      supabase.from("erp_renovacoes").select("documento_id, bitrix_card_id").in("documento_id", l).not("bitrix_card_id", "is", null),
    ]);
    for (const x of (dd ?? []) as unknown as { id: string; nosso_numero_corp: number | null; ramo: { abreviacao: string } | { abreviacao: string }[] | null }[]) {
      const r = Array.isArray(x.ramo) ? x.ramo[0] : x.ramo;
      extra.set(x.id, { corp: x.nosso_numero_corp, abrev: r?.abreviacao ?? "", canais: [], card: null });
    }
    for (const r of (rn ?? []) as { documento_id: string; bitrix_card_id: string }[]) {
      const [entity, id] = r.bitrix_card_id.split(":").map(Number);
      const e = extra.get(r.documento_id);
      if (e && entity && id) e.card = { entity, id };
    }
    for (const p of (pp ?? []) as { documento_id: string; produtor_corp_nome: string | null }[]) {
      const n = (p.produtor_corp_nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
      const canal = /^SEGIMOB/.test(n) ? "SEGIMOB" : /^SUPERLOGICA/.test(n) ? "SUPERLOGICA" : /^BASE SOFTWARE/.test(n) ? "BASE SOFTWARE" : /^SOHTEC/.test(n) ? "SOHTEC" : null;
      const e = extra.get(p.documento_id);
      if (canal && e && !e.canais.includes(canal)) e.canais.push(canal);
    }
  }

  const blocoDe = (d: Doc): BlocoId =>
    d.produto === "fianca" ? "fianca" : d.produto === "capitalizacao" ? "cap" : d.produto === "automovel" ? "auto" : d.tipo_card === "lote" ? "re_lotes" : "re_demais";

  // Apólice cancelada não renova: situação "cancelado" ou endosso de cancelamento (tipo X) já lançado/proposto na apólice (Matheus 28/10/2026)
  const comCancelamento = async (idsDocs: string[]) => {
    const set = new Set<string>();
    for (const l of lotes(idsDocs, 150)) {
      const { data } = await supabase.from("erp_documentos").select("documento_pai_id").in("documento_pai_id", l).eq("tipo", "X").in("situacao", ["vigente", "proposta", "cancelado"]);
      for (const x of (data ?? []) as { documento_pai_id: string }[]) set.add(x.documento_pai_id);
    }
    return set;
  };
  const cancelando = await comCancelamento(ids);
  let canceladosFora = 0;
  const porChave = new Map<string, Card & { bloco: BlocoId }>();
  for (const d of docs) {
    if (cancelando.has(d.documento_id)) { canceladosFora++; continue; }
    const ex = extra.get(d.documento_id);
    const bloco = blocoDe(d);
    const segimob = bloco === "re_lotes" && !!ex?.canais.includes("SEGIMOB");
    const chaveCard = d.chave_card + (segimob ? "|SEG" : "");
    let c = porChave.get(chaveCard);
    if (!c) {
      const mes = mmaaaa(d.vigencia_fim);
      const cli = d.cliente ?? "SEM CLIENTE";
      const imob = d.imobiliaria;
      const titulo =
        bloco === "re_lotes" ? `RENOVAÇÃO - ${imob ?? "SEM IMOBILIÁRIA"} - ${segimob ? "SEG/" : ""}${nomeSeg(d.seguradora)} - ${mes}`
        : bloco === "fianca" ? `${cli}${imob ? ` - ${imob}` : ""}`
        : bloco === "cap" ? `VENCE ${formatarData(d.vigencia_fim)} | ${cli} | CORP ${ex?.corp ?? d.nosso_numero}`
        : bloco === "auto" ? `RENOVAÇÃO - ${formatarData(d.vigencia_fim)} - ${cli}`
        : `RENOVAÇÃO - ${ex?.abrev || d.ramo} - ${cli}${imob && !cli.toUpperCase().startsWith(imob.toUpperCase().slice(0, 12)) ? ` - ${imob}` : ""} - ${mes}`;
      c = { chave: chaveCard, tipo: d.tipo_card, titulo, docs: [], fim: d.vigencia_fim, premio: 0, comissaoMin: null, segimob, canais: [], bloco };
      porChave.set(chaveCard, c);
    }
    c.docs.push(d);
    for (const k of ex?.canais ?? []) if (!c.canais.includes(k)) c.canais.push(k);
    if (d.vigencia_fim < c.fim) c.fim = d.vigencia_fim;
    c.premio += Number(d.premio_liquido ?? 0);
    if (d.comissao_pct != null && Number(d.comissao_pct) > 0) c.comissaoMin = c.comissaoMin == null ? Number(d.comissao_pct) : Math.min(c.comissaoMin, Number(d.comissao_pct));
  }
  const cards = [...porChave.values()].sort((a, b) => a.fim.localeCompare(b.fim) || a.titulo.localeCompare(b.titulo));

  // Renovações ainda SEM DESFECHO de apólices que já não estão vigentes: continuam sendo acompanhadas até Renovado ou Não renovado (Matheus 28/10/2026)
  const abertasRaw = await pAbertas;
  const abertasCand = ((abertasRaw ?? []) as unknown as Aberta[]).filter((a) => a.doc && a.doc.situacao !== "vigente" && a.doc.situacao !== "cancelado");
  const abertasCancel = await comCancelamento(abertasCand.map((a) => a.doc!.id));
  const abertas = abertasCand.filter((a) => !abertasCancel.has(a.doc!.id));
  const abertasPorCard = new Map<string, Aberta[]>();
  for (const a of abertas) abertasPorCard.set(a.bitrix_card_id, [...(abertasPorCard.get(a.bitrix_card_id) ?? []), a]);

  // Herança (Matheus 01/11): apólices que venceram nos 90 dias antes do mês escolhido e ainda sem desfecho — separada e rotulada, com os dias desde o vencimento
  const herdRaw = await pHeranca;
  const heranca = ((herdRaw ?? []) as Herdada[]).sort((a, b) => b.vigencia_fim.localeCompare(a.vigencia_fim)).slice(0, 300);
  const herancaMap = new Map<string, Herdada[]>();
  for (const h of heranca) herancaMap.set(h.mes_origem, [...(herancaMap.get(h.mes_origem) ?? []), h]);
  const herancaMeses = [...herancaMap.entries()].sort((x, y) => y[0].localeCompare(x[0]));
  // Lotes de renovação (proposta criada do card) × apólices anteriores, item a item (Matheus 03/11): confirmado = linha da planilha da equipe achada no ERP + imobiliária + seguradora + vigência
  const loteRaw = await pLotes;
  const lotesResumo = ((loteRaw ?? []) as LoteResumo[]).sort((a, b) => (a.imobiliaria ?? "").localeCompare(b.imobiliaria ?? ""));
  // Radar (Matheus 05/11): apólices ainda VIGENTES que se aproximam do fim, com o alerta de cada uma (sem card, card parado na entrada, card perdido)
  type Radar = { documento_id: string; nosso_numero: number; numero_apolice: string | null; produto: string; seguradora: string | null; cliente: string | null; imobiliaria: string | null; vigencia_fim: string; dias_para_vencer: number; bitrix_card_id: string | null; etapa: string; alerta: string; regra_dias_card: number; regra_confirmada: boolean; parceria_encerrada: boolean };
  const { data: radarRaw } = await supabase.rpc("erp_renovacao_radar", { p_hoje: new Date().toISOString().slice(0, 10), p_horizonte: 75 });
  const radar = (radarRaw ?? []) as Radar[];
  const ROT_ALERTA: Record<string, string> = { sem_card: "Sem card", parado_na_entrada: "Card parado na entrada", card_perdido: "Card perdido, apólice vigente", parceria_encerrada: "Parceria encerrada (não renova)" };
  const COR_ALERTA: Record<string, string> = { sem_card: "bg-red-100 text-red-700", parado_na_entrada: "bg-orange-100 text-orange-800", card_perdido: "bg-gray-200 text-gray-700", parceria_encerrada: "bg-slate-200 text-slate-700" };
  const radarAlertas = radar.filter((r) => r.alerta !== "ok");
  const radarPorAlerta = new Map<string, Radar[]>();
  for (const r of radarAlertas) radarPorAlerta.set(r.alerta, [...(radarPorAlerta.get(r.alerta) ?? []), r]);
  // mês do ciclo do robô de renovações: no dia 25 ele trata os vencimentos de M+2
  const hojeR = new Date();
  const cicloRobo = (() => { const t = hojeR.getUTCFullYear() * 12 + hojeR.getUTCMonth() + 2; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; })();

  // Índice de não renovação (Matheus 03/11): desfecho de cada apólice vencida; "Apólice Não Nova" do Corp (RENV) prova a renovação, sem apólice nova = não renovada
  const linhasIdx = await pIndice;
  const somaIdx = (l: LinhaIndice[]) => l.reduce((a, x) => ({ vencidas: a.vencidas + Number(x.vencidas), renovadas: a.renovadas + Number(x.renovadas), provaveis: a.provaveis + Number(x.provaveis), nao: a.nao + Number(x.nao_renovadas), aguardando: a.aguardando + Number(x.aguardando), canceladas: a.canceladas + Number(x.canceladas), premio: a.premio + Number(x.premio_nao_renovado) }), { vencidas: 0, renovadas: 0, provaveis: 0, nao: 0, aguardando: 0, canceladas: 0, premio: 0 });
  const idxPorMes = [...new Set(linhasIdx.map((x) => x.mes))].sort().reverse().map((m) => ({ mes: m, ...somaIdx(linhasIdx.filter((x) => x.mes === m)) }));
  const idxMesAtual = linhasIdx.filter((x) => x.mes === per.mes);
  const idxPorSeg = [...new Set(idxMesAtual.map((x) => x.seguradora))].map((s2) => ({ seguradora: s2, ...somaIdx(idxMesAtual.filter((x) => x.seguradora === s2)) })).filter((x) => x.vencidas > 0).sort((a, b) => b.nao - a.nao);
  const pctNao = (nao: number, renov: number) => (nao + renov > 0 ? `${((100 * nao) / (nao + renov)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
  const nrRaw = await pNaoRenov;
  const naoRenov = (nrRaw ?? []) as NaoRenov[];

  // atalhos de mês: o mês atual +1 até +4
  const hoje = new Date();
  const atalhos = [1, 2, 3, 4].map((n) => {
    const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + n, 1));
    const fim = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
    return { rotulo: ini.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }), de: isoData(ini), ate: isoData(fim) };
  });
  const base = new URLSearchParams();
  for (const k of ["q", "seguradora", "produto", "imobiliaria"] as const) if (sp[k] && typeof sp[k] === "string") base.set(k, sp[k] as string);

  return (
    <PaginaErp>
      <PainelResumoAba funcao="erp_resumo_renovacao" titulo="Renovação" mes={f.mes} legendas={{"Do mês: situação da renovação":"Apólices que vencem no mês escolhido, por situação da renovação: sem card, card criado, em cotação, renovado ou não renovado.","Do mês: por produto":"Apólices que vencem no mês, por produto.","Herdadas: mês de origem":"Apólices de meses anteriores (até 90 dias antes do mês escolhido) que venceram e ainda não têm desfecho, por mês em que venceram."}} />
      <PageHeader
        icon={<IconReport />}
        titulo="ERP O2 — Renovação"
        subtitulo="Prévia dos cards de renovação: todas as apólices vigentes que vencem no período, organizadas em um bloco por funil. A criação dos cards será autorizada bloco a bloco aqui."
      />

      <FiltrosErp
        caminho="/erp/renovacao"
        campos={["busca", "seguradora", "produto", "imobiliaria"]}
        valores={{ ...f }}
        rotuloBusca="Cliente ou nº da apólice"
        placeholderBusca="Nome do cliente · Nº da apólice · Código O2 do documento · Nosso nº do Corp"
        resumo={
          <>
            {docs.length.toLocaleString("pt-BR")} apólice(s) que vencem em {per.rotulo} · {cards.length.toLocaleString("pt-BR")} card(s) a criar
            {truncado ? " · lista limitada a 4.000 documentos: afunile o período" : ""}
            <InfoLegenda titulo="Período e filtros da renovação">
              A tela abre no mês corrente e navega por mês e por ano. O mês filtra pelo fim de vigência da apólice (apólices vigentes ou já vencidas; canceladas e propostas que ainda não viraram apólice não entram). O atalho do ciclo do robô leva ao mês que o robô trata no dia 25. As apólices de meses anteriores sem desfecho aparecem à parte, em Herdadas de meses anteriores. Os filtros de busca, seguradora, produto e imobiliária recortam as apólices. Apólices com endosso de cancelamento ficam de fora. A tela só mostra a prévia: nada é criado no Bitrix a partir dela.
            </InfoLegenda>
          </>
        }
      />

      <NavegadorMes caminho="/erp/renovacao" mes={f.mes} params={{ q: f.q ?? undefined, seguradora: f.seguradora ?? undefined, produto: f.produto ?? undefined, imobiliaria: f.imobiliaria ?? undefined }} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">Atalho do ciclo do robô:</span>
        <Link
          href={`/erp/renovacao?${new URLSearchParams({ ...(f.q ? { q: f.q } : {}), ...(f.seguradora ? { seguradora: f.seguradora } : {}), ...(f.produto ? { produto: f.produto } : {}), ...(f.imobiliaria ? { imobiliaria: f.imobiliaria } : {}), mes: cicloRobo }).toString()}`}
          className={`rounded-full border px-3 py-1 capitalize ${per.mes === cicloRobo ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
        >
          {periodoDoMes(cicloRobo).rotulo} (vencimentos tratados no dia 25)
        </Link>
      </div>

      {idxPorMes.length > 0 && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <h2 className="text-base font-semibold text-gray-900">
            Índice de não renovação
            <InfoLegenda titulo="Índice de não renovação">
              Não renovar é normal e fica registrado. Para cada apólice que venceu a partir de setembro/2026: renovada = existe apólice nova ligada a ela (o Corp marca a nova como “Apólice Não Nova”), mesmo em outra seguradora, pois renovar é continuar com a O2 como corretora; renovação provável = sem ligação gravada, mas há apólice nova do mesmo titular e produto começando de 30 dias antes a 60 dias depois do fim (conta como renovação no índice, a confirmar); não renovada = venceu há mais de 30 dias e não tem apólice nova; aguardando decisão = venceu há até 30 dias e ainda pode ser renovada; cancelada = apólice cancelada ou com endosso de cancelamento (fora do índice). Índice = não renovadas ÷ (renovadas + prováveis + não renovadas). O motivo só aparece quando há fonte (e-mail com sinal de não renovar ou motivo registrado); sem fonte, fica “sem motivo informado”. Nada é apagado.
            </InfoLegenda>
          </h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-2">Vencimento</th><th className="px-3 py-2 text-right">Vencidas</th><th className="px-3 py-2 text-right">Renovadas</th><th className="px-3 py-2 text-right">Renovação provável (sem ligação)</th><th className="px-3 py-2 text-right">Não renovadas</th><th className="px-3 py-2 text-right">Aguardando decisão</th><th className="px-3 py-2 text-right">Canceladas</th><th className="px-3 py-2 text-right">Índice de não renovação</th><th className="px-3 py-2 text-right">Prêmio líquido não renovado</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {idxPorMes.map((m) => (
                  <tr key={m.mes} className={m.mes === per.mes ? "bg-amber-50" : "hover:bg-gray-50"}>
                    <td className="px-3 py-1.5 font-medium capitalize"><Link href={`/erp/renovacao?mes=${m.mes}`} className="text-o2-navy hover:underline">{periodoDoMes(m.mes).rotulo}</Link></td>
                    <td className="px-3 py-1.5 text-right">{m.vencidas}</td>
                    <td className="px-3 py-1.5 text-right">{m.renovadas}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{m.provaveis}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{m.nao}</td>
                    <td className="px-3 py-1.5 text-right">{m.aguardando}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{m.canceladas}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{pctNao(m.nao, m.renovadas + m.provaveis)}</td>
                    <td className="px-3 py-1.5 text-right">{formatarReais(m.premio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {idxPorSeg.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-2 text-xs font-medium capitalize text-gray-900">{periodoDoMes(per.mes).rotulo}: índice por seguradora</summary>
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr><th className="px-3 py-2">Seguradora</th><th className="px-3 py-2 text-right">Renovadas</th><th className="px-3 py-2 text-right">Não renovadas</th><th className="px-3 py-2 text-right">Aguardando</th><th className="px-3 py-2 text-right">Índice</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {idxPorSeg.map((s2) => (
                      <tr key={s2.seguradora} className="hover:bg-gray-50"><td className="px-3 py-1.5">{s2.seguradora}</td><td className="px-3 py-1.5 text-right">{s2.renovadas}</td><td className="px-3 py-1.5 text-right font-medium">{s2.nao}</td><td className="px-3 py-1.5 text-right">{s2.aguardando}</td><td className="px-3 py-1.5 text-right font-semibold">{pctNao(s2.nao, s2.renovadas + s2.provaveis)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {naoRenov.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-2 text-xs font-medium capitalize text-gray-900">{periodoDoMes(per.mes).rotulo}: registro de não renovadas e aguardando decisão ({naoRenov.length}{naoRenov.length >= 400 ? "+" : ""})</summary>
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr><th className="px-3 py-2">Código O2 do documento</th><th className="px-3 py-2">Nº da apólice</th><th className="px-3 py-2">Imobiliária</th><th className="px-3 py-2">Seguradora</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Venceu em</th><th className="px-3 py-2 text-right">Pr. líquido</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Motivo</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {naoRenov.map((x) => (
                      <tr key={x.documento_id} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium"><Link href={`/erp/documentos/${x.documento_id}`} className="text-o2-navy hover:underline">{x.nosso_numero}</Link></td>
                        <td className="px-3 py-1.5">{x.numero_apolice ?? "—"}</td>
                        <td className="px-3 py-1.5">{x.imobiliaria ?? "—"}</td>
                        <td className="px-3 py-1.5">{x.seguradora}</td>
                        <td className="px-3 py-1.5">{x.produto ?? "—"}</td>
                        <td className="px-3 py-1.5">{formatarData(x.vigencia_fim)}</td>
                        <td className="px-3 py-1.5 text-right">{formatarReais(x.premio_liquido)}</td>
                        <td className="px-3 py-1.5">{x.desfecho === "nao_renovada" ? "Não renovada" : "Aguardando decisão"}</td>
                        <td className="px-3 py-1.5">{x.motivo ?? <span className="text-gray-400">sem motivo informado</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      )}

      {radarAlertas.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-red-200 bg-red-50/60 p-4">
          <h2 className="text-base font-semibold text-gray-900">
            Radar: apólices vigentes perto do fim
            <InfoLegenda titulo="Radar de renovação">
              Apólices ainda vigentes que vencem nos próximos 75 dias e precisam de ação. Sem card: está dentro da janela de renovação do produto e ainda não tem card no Bitrix. Card parado na entrada: o card existe, mas segue em Entrada ou Preparação perto do fim (a cotação deve sair cerca de 22 dias antes). Card perdido: o card foi para perdido e a apólice ainda está vigente (conferir). Os prazos por produto ficam na tabela de regras e ainda são propostos, a confirmar.
            </InfoLegenda>
          </h2>
          <p className="text-xs text-gray-600">
            {radarAlertas.length} apólice(s) com alerta{radar.some((r) => !r.regra_confirmada) ? " · prazos por produto ainda propostos, não confirmados" : ""}.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {[...radarPorAlerta.entries()].map(([a, l]) => (
              <span key={a} className={`rounded-full px-3 py-1 font-medium ${COR_ALERTA[a] ?? "bg-gray-100"}`}>{ROT_ALERTA[a] ?? a}: {l.length}</span>
            ))}
          </div>
          {[...radarPorAlerta.entries()].filter(([a]) => a !== "card_perdido" && a !== "parceria_encerrada").map(([a, l]) => (
            <details key={a} className="rounded-xl border border-gray-200 bg-white">
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-900">{ROT_ALERTA[a] ?? a} · {l.length} apólice(s) · as 60 mais próximas do fim</summary>
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <tr><th className="px-3 py-2">Dias para vencer</th><th className="px-3 py-2">Código O2 do documento</th><th className="px-3 py-2">Nº da apólice</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Seg.</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Imobiliária</th><th className="px-3 py-2">Vence em</th><th className="px-3 py-2">Card</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {l.slice(0, 60).map((r) => {
                      const [ent, cid] = (r.bitrix_card_id ?? "").split(":").map(Number);
                      return (
                        <tr key={r.documento_id} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5 font-semibold">{r.dias_para_vencer}</td>
                          <td className="px-3 py-1.5 font-medium"><Link href={`/erp/documentos/${r.documento_id}`} className="text-o2-navy hover:underline">{r.nosso_numero}</Link></td>
                          <td className="px-3 py-1.5">{r.numero_apolice ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.produto}</td>
                          <td className="px-3 py-1.5">{r.seguradora ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.cliente ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.imobiliaria ?? "—"}{r.parceria_encerrada && <span title="Parceria encerrada: comunicar a renovação ao segurado; sem previsão de receita de renovação" className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">parceria encerrada</span>}</td>
                          <td className="px-3 py-1.5">{formatarData(r.vigencia_fim)}</td>
                          <td className="px-3 py-1.5">{ent && cid ? <a href={urlCard(ent, cid)} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">#{cid} {r.etapa}</a> : <span className="text-gray-300">sem card</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </section>
      )}

      {heranca.length > 0 && (
        <section className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/60 p-4">
          <h2 className="text-base font-semibold text-gray-900">
            Herdadas de meses anteriores
            <InfoLegenda titulo="Herdadas de meses anteriores">
              Apólices que venceram antes de {per.rotulo} (até 90 dias antes) e ainda não têm desfecho: sem renovação lançada, sem “não renovado” e sem endosso de cancelamento. Ficam separadas das do mês e rotuladas pelo mês em que venceram, com os dias desde o vencimento.
            </InfoLegenda>
          </h2>
          <p className="text-xs text-gray-600">{heranca.length} apólice(s) sem desfecho, de {herancaMeses.length} mês(es) anterior(es). Só os 300 vencimentos mais recentes aparecem na lista.</p>
          <div className="space-y-2">
            {herancaMeses.map(([mesOrigem, lista]) => (
              <details key={mesOrigem} className="rounded-xl border border-gray-200 bg-white">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 px-4 py-2 text-xs">
                  <span className="text-sm font-medium capitalize text-gray-900">herdada de {periodoDoMes(mesOrigem).rotulo}</span>
                  <span>{lista.length} apólice(s)</span>
                  <span className="text-gray-500">{lista.filter((h) => h.situacao_renovacao === "Sem card").length} sem card · {lista.filter((h) => h.situacao_renovacao !== "Sem card").length} com card</span>
                </summary>
                <div className="overflow-x-auto border-t border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr><th className="px-3 py-2">Código O2 do documento</th><th className="px-3 py-2">Nº da apólice</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Imobiliária</th><th className="px-3 py-2">Seg.</th><th className="px-3 py-2">Venceu em</th><th className="px-3 py-2 text-right">Dias desde o vencimento</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Card</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lista.map((h) => {
                        const [ent, cid] = (h.bitrix_card_id ?? "").split(":").map(Number);
                        return (
                          <tr key={h.documento_id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 font-medium"><Link href={`/erp/documentos/${h.documento_id}`} className="text-o2-navy hover:underline">{h.nosso_numero}</Link></td>
                            <td className="px-3 py-1.5">{h.numero_apolice ?? "—"}</td>
                            <td className="px-3 py-1.5">{h.cliente ?? "—"}</td>
                            <td className="px-3 py-1.5">{h.imobiliaria ?? "—"}</td>
                            <td className="px-3 py-1.5">{h.seguradora ?? "—"}</td>
                            <td className="px-3 py-1.5">{formatarData(h.vigencia_fim)}</td>
                            <td className="px-3 py-1.5 text-right">{h.dias_desde_vencimento}</td>
                            <td className="px-3 py-1.5">{h.situacao_renovacao}</td>
                            <td className="px-3 py-1.5">{ent && cid ? <a href={urlCard(ent, cid)} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">#{cid}</a> : <span className="text-gray-300">sem card</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {lotesResumo.length > 0 && (
        <section className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <h2 className="text-base font-semibold text-gray-900">
            Lotes de renovação × apólices anteriores
            <InfoLegenda titulo="Lotes de renovação × apólices anteriores">
              Cada lote é uma proposta de renovação criada de um card (imobiliária + seguradora). Os itens do lote são as apólices anteriores que foram trazidas para renovar. Confirmado: a apólice consta na planilha de renovação da equipe e o Nº da apólice, a seguradora e o fim de vigência batem com o ERP, e a imobiliária, a seguradora e o mês batem com o lote. Sugestão: só imobiliária, seguradora e mês batem; falta a linha na planilha.
            </InfoLegenda>
          </h2>
          <p className="text-xs text-gray-600">{lotesResumo.length} lote(s) em {per.rotulo} · {lotesResumo.reduce((s2, l) => s2 + Number(l.confirmados), 0)} apólice(s) anterior(es) confirmada(s) · {lotesResumo.reduce((s2, l) => s2 + Number(l.sugestoes), 0)} sugestão(ões).</p>
          <div className="overflow-x-auto rounded-xl border border-sky-100 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-2">Código O2 do lote</th><th className="px-3 py-2">Imobiliária</th><th className="px-3 py-2">Seg.</th><th className="px-3 py-2">Card</th><th className="px-3 py-2 text-right">Confirmadas</th><th className="px-3 py-2 text-right">Sugestões</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lotesResumo.map((l) => {
                  const [ent, cid] = l.origem_ref.split(":").map(Number);
                  return (
                    <tr key={l.documento_id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-medium"><Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">{l.nosso_numero}</Link></td>
                      <td className="px-3 py-1.5">{l.imobiliaria ?? "—"}</td>
                      <td className="px-3 py-1.5">{l.seguradora ?? "—"}</td>
                      <td className="px-3 py-1.5">{ent && cid ? <a href={urlCard(ent, cid)} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">#{cid}</a> : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{l.confirmados}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500">{l.sugestoes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {abertasPorCard.size > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <h2 className="text-base font-semibold text-gray-900">
            Em acompanhamento até o desfecho
            <InfoLegenda titulo="Em acompanhamento até o desfecho">
              Cards de renovação já criados no Bitrix que ainda estão em A renovar ou Em cotação, mas cuja apólice já não está vigente (inclui os mais antigos que 90 dias, que não entram na herança) (a vigência acabou). Continuam listados até o card chegar a Renovado ou Não renovado. Apólices com endosso de cancelamento ficam de fora. Esta lista não muda com o período nem com os filtros da tela.
            </InfoLegenda>
          </h2>
          <p className="text-xs text-gray-600">
            {abertasPorCard.size} card(s) de renovação ainda sem desfecho (nem Renovado nem Não renovado), cuja apólice já não está vigente. Continuam aqui até o card chegar ao fim do funil.
          </p>
          <div className="overflow-x-auto rounded-xl border border-amber-100 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-2">Card no Bitrix</th><th className="px-3 py-2">Apólices</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Venceu em</th><th className="px-3 py-2">Situação</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...abertasPorCard.entries()].slice(0, 120).map(([cardId, lista]) => {
                  const [entity, id] = cardId.split(":").map(Number);
                  const loc0 = lista[0].doc?.loc; const nome = Array.isArray(loc0) ? loc0[0]?.nome : loc0?.nome;
                  return (
                    <tr key={cardId} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5"><a href={urlCard(entity, id)} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">#{id}</a> <span className="text-gray-400">SPA {entity}</span></td>
                      <td className="px-3 py-1.5">{lista.length === 1 ? (lista[0].doc?.numero_apolice ?? lista[0].doc?.nosso_numero) : `${lista.length} apólices (lote)`}</td>
                      <td className="px-3 py-1.5">{lista.length === 1 ? nome ?? "—" : "—"}</td>
                      <td className="px-3 py-1.5">{formatarData(lista[0].vence_em)}</td>
                      <td className="px-3 py-1.5">{STATUS[lista[0].status] ?? lista[0].status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canceladosFora > 0 && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{canceladosFora} apólice(s) deste período têm endosso de cancelamento e não entram na renovação.</p>}

      {cards.length === 0 && <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Nenhuma apólice vigente com fim de vigência nesse período e filtros.</p>}

      {BLOCOS.map((b) => {
        const lista = cards.filter((c) => c.bloco === b.id);
        if (!lista.length) return null;
        const nDocs = lista.reduce((s, c) => s + c.docs.length, 0);
        const todos = lista.flatMap((c) => c.docs);
        const semImob = todos.filter((d) => !d.imobiliaria_id).length;
        const semPremio = todos.filter((d) => !d.premio_liquido || Number(d.premio_liquido) <= 0).length;
        const incompletos = todos.filter((d) => d.cliente_incompleto).length;
        const semNumero = todos.filter((d) => !d.numero_apolice || !/[1-9]/.test(d.numero_apolice)).length;
        const jaRenov = todos.filter((d) => d.status_renovacao && d.status_renovacao !== "a_renovar").length;
        const comCard = todos.filter((d) => extra.get(d.documento_id)?.card).length;
        const cardsNovos = lista.filter((c) => c.docs.some((d) => !extra.get(d.documento_id)?.card)).length;
        const premio = lista.reduce((s, c) => s + c.premio, 0);
        const segCards = lista.filter((c) => c.segimob).length;
        return (
          <section key={b.id} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-[280px] flex-1">
                <h2 className="text-base font-semibold text-gray-900">
                  {b.titulo}
                  <InfoLegenda titulo={b.titulo}>
                    {INFO_BLOCO[b.id]} Funil de destino no Bitrix: {b.funil}. Mostra quantos cards, quantas apólices e o prêmio líquido (conforme o Corp). As etiquetas coloridas apontam pendências a resolver antes de criar os cards (sem imobiliária, sem prêmio, sem Nº da apólice, cliente com cadastro incompleto) e quantas apólices já têm card no Bitrix ou já estão em andamento/renovadas. O botão Autorizar criação cria os cards no Bitrix só quando o setor responsável clicar (antes há "Conferir antes", que não cria nada). Automóvel usa o funil padrão, com o título "RENOVAÇÃO - fim da vigência - nome do segurado". Clique num card para ver as apólices dele.
                  </InfoLegenda>
                </h2>
                <p className="text-xs text-gray-500">Destino: {b.funil} · {b.regra}</p>
                <p className="mt-1 text-sm text-gray-800">
                  <strong>{lista.length}</strong> card(s) · <strong>{nDocs}</strong> apólice(s) · prêmio líquido {formatarReais(premio)}
                  {segCards > 0 && <> · {segCards} lote(s) Segimob</>}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {semImob > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">{semImob} sem imobiliária{b.id === "re_demais" ? " (venda direta O2)" : ""}</span>}
                  {semPremio > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{semPremio} sem prêmio</span>}
                  {semNumero > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{semNumero} sem Nº da apólice</span>}
                  {incompletos > 0 && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">{incompletos} cliente(s) com cadastro incompleto</span>}
                  {comCard > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{comCard} já com card no Bitrix</span>}
                  {jaRenov > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">{jaRenov} já em andamento/renovada(s)</span>}
                </div>
              </div>
              <BotaoAutorizarCriacao
                bloco={b.id}
                de={de}
                ate={ate}
                cards={lista.filter((c) => c.docs.every((d) => !extra.get(d.documento_id)?.card)).map((c) => ({ titulo: c.titulo, documentoIds: c.docs.map((d) => d.documento_id) }))}
                itens={lista.filter((c) => c.docs.every((d) => !extra.get(d.documento_id)?.card)).reduce((s, c) => s + c.docs.length, 0)}
              />
            </div>

            <div className="space-y-2">
              {lista.map((c) => (
                <details key={c.chave} className="rounded-xl border border-gray-200 bg-white">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${c.tipo === "lote" ? "bg-o2-navy text-white" : "bg-gray-100 text-gray-700"}`}>{c.tipo === "lote" ? "LOTE" : "INDIVIDUAL"}</span>
                    {c.segimob && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-800">SEGIMOB</span>}
                    {!c.segimob && c.canais.filter((k) => k !== "SEGIMOB").map((k) => <span key={k} className="rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700">{k}</span>)}
                    <span className="min-w-[260px] flex-1 text-sm font-medium text-gray-900">{c.titulo}</span>
                    <span>{c.docs.length} item(ns)</span>
                    <span>vence {formatarData(c.fim)}</span>
                    <span>prêmio líquido {formatarReais(c.premio)}</span>
                    <span>comissão {c.comissaoMin != null ? `${c.comissaoMin.toLocaleString("pt-BR")}%` : "—"}</span>
                  </summary>
                  <div className="overflow-x-auto border-t border-gray-100">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-3 py-2">Abrir</th>
                          <th className="px-3 py-2">Tipo de documento</th>
                          <th className="px-3 py-2">Titular do seguro</th>
                          <th className="px-3 py-2">Produto</th>
                          <th className="px-3 py-2">Seguradora</th>
                          <th className="px-3 py-2">Vigência</th>
                          <th className="px-3 py-2">Código O2 do documento</th>
                          <th className="px-3 py-2">Nº da apólice</th>
                          <th className="px-3 py-2">Imobiliária</th>
                          <th className="px-3 py-2 text-right">Pr. líquido</th>
                          <th className="px-3 py-2 text-right">Com. %</th>
                          <th className="px-3 py-2">Renovação</th>
                          <th className="px-3 py-2">Card no Bitrix</th>
                          <th className="px-3 py-2 text-right">Anexos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {c.docs.map((d) => {
                          const k = cab.get(d.documento_id);
                          const t = tipoDoCabecalho({ tipo: "A", tipo_corp: null, situacao: "vigente", modo_cobranca: k?.modo_cobranca ?? null });
                          const titular = k?.titular ?? d.cliente;
                          return (
                          <tr key={d.documento_id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5"><BotaoVerDocumento id={d.documento_id} /></td>
                            <td className="px-3 py-1.5"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${t.cor}`}>{t.nome}</span></td>
                            <td className="px-3 py-1.5">
                              {titular ? <span className="font-medium text-gray-900">{titular}</span> : <span className="text-gray-400">titular não ligado</span>}
                              {d.cliente_incompleto && <span className="ml-1 rounded bg-yellow-100 px-1 text-xs text-yellow-800">cadastro incompleto</span>}
                              {k?.inquilino && k.inquilino !== titular ? (
                                <span className="block text-xs text-gray-500">inquilino: {d.cliente_id ? <Link href={`/erp/clientes/${d.cliente_id}`} className="hover:underline">{k.inquilino}</Link> : k.inquilino}</span>
                              ) : null}
                            </td>
                            <td className="px-3 py-1.5">{k?.produto_nome ?? d.ramo}</td>
                            <td className="px-3 py-1.5">{k?.seguradora_nome ?? d.seguradora ?? "—"}</td>
                            <td className="whitespace-nowrap px-3 py-1.5">{formatarData(d.vigencia_inicio)} a {formatarData(d.vigencia_fim)}</td>
                            <td className="px-3 py-1.5 font-medium"><Link href={`/erp/documentos/${d.documento_id}`} className="text-o2-navy hover:underline">{d.nosso_numero}</Link></td>
                            <td className="px-3 py-1.5">{d.numero_apolice ?? <span className="text-gray-300">0</span>}</td>
                            <td className="px-3 py-1.5">{d.imobiliaria ?? <span className="text-gray-400">—</span>}</td>
                            <td className="px-3 py-1.5 text-right">{formatarReais(d.premio_liquido)}</td>
                            <td className="px-3 py-1.5 text-right">{d.comissao_pct != null ? Number(d.comissao_pct).toLocaleString("pt-BR") : "—"}</td>
                            <td className="px-3 py-1.5">{d.status_renovacao ? STATUS[d.status_renovacao] ?? d.status_renovacao : "—"}</td>
                            <td className="px-3 py-1.5">{extra.get(d.documento_id)?.card ? <a href={urlCard(extra.get(d.documento_id)!.card!.entity, extra.get(d.documento_id)!.card!.id)} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">#{extra.get(d.documento_id)!.card!.id}</a> : <span className="text-gray-300">sem card</span>}</td>
                            <td className="px-3 py-1.5 text-right">{d.anexos > 0 ? d.anexos : <span className="text-gray-300">0</span>}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-gray-500">
        Só entram apólices vigentes (propostas, que ainda não viraram apólice, não aparecem). Prêmio líquido conforme o Corp; a regra de prêmio total (líquido + IOF + adicional de fracionamento) vale na ficha do documento.
        Os títulos de Fiança, Capitalização e Automóvel seguem o padrão dos cards já existentes em cada funil e ainda precisam ser confirmados.
      </p>
    </PaginaErp>
  );
}
