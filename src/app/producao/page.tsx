import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { pediuAtualizacao } from "@/lib/retratoPaineis";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import AtualizarAgora from "@/components/AtualizarAgora";
import InfoLegenda from "@/components/InfoLegenda";
import ExportarEste from "@/components/ExportarEste";
import { IconChart } from "@/components/icons";
import BarrasMensais from "./BarrasMensais";
import { signOut } from "../actions";
import FiltrosProducao, { type Filtros, type OpcaoImob } from "./FiltrosProducao";
import { Abas } from "./_corp/comum";
import { Imobiliaria360 } from "./Imobiliaria360";

export const dynamic = "force-dynamic";

// Painel Produção (Base Única — Fase 5). Dois universos que se conectam mas
// têm fontes diferentes (Matheus, 20/10/2026), cada um no seu bloco:
//  - COTAÇÕES (funil): tomadas de preço de TODOS os produtos (21/10/2026):
//    Fiança (planilhas jul/2020–jul/2026 + Bitrix), RE (planilhas jul/2025–ago/2026
//    + Bitrix), Capitalização (planilhas de títulos jul/2021–jul/2026 + Bitrix) e Automóvel (planilhas de RE + Bitrix), cada um com a régua do
//    painel do produto ("quando a fonte muda, só a fonte muda"): entradas pelo
//    mês em que a cotação entrou; conversão/perda pelo mês em que aconteceu.
//    Bitrix lido de hora em hora pelo cron /api/cron/base-unica-bitrix.
//    RENOVAÇÕES de Fiança e RE (21/10/2026) são uma série à parte dentro do
//    bloco (recebidas / renovadas / não renovadas), sem entrar nas cotações
//    novas nem na conversão delas: Fiança = aba RENOVAÇÕES das planilhas
//    (nov/2025–set/2026) + funil Renovação do Bitrix (out/2026 →); RE = abas RN
//    das planilhas (nov/2025–set/2026) + funil Renovações do Bitrix (set/2026 →).
//  - APÓLICES (Corp): o que foi efetivado — propostas, prêmio líquido,
//    comissão —, pelo mês da data da proposta.
// Aba "Imobiliária 360" (21/10/2026, Matheus): sem imobiliária escolhida, a O2
// inteira com o ranking (os dois blocos abaixo); com UMA imobiliária ou grupo
// (filtro ou clique no ranking), a visão 360 dela (Imobiliaria360.tsx); com
// várias, os dois blocos somando as escolhidas. O filtro de seguradora só
// recorta as apólices. Números: supabase/schema_producao_painel.sql
// (imobiliária só por vínculo CONFIRMADO). Grade antiga: /producao/relatorios.

type Valores = { propostas: number; premio: number; comissao: number };
type Eventos = { entradas: number; aprovacoes: number; recusas: number; perdas: number; conversoes: number };
type Entidade = { id: string; nome: string | null; tipo: "grupo" | "imobiliaria" };
type Kpis = {
  de: string;
  ate: string;
  meses: number;
  resumo: Valores & { entidades_ativas: number };
  resumo_ano_anterior: Valores & { entidades_ativas: number; de: string; ate: string };
  por_produto: (Valores & { produto: string; premio_ano_anterior: number; propostas_ano_anterior: number })[];
  mensal: { competencia: string; produtos: Record<string, Valores> }[];
  por_seguradora: (Valores & { seguradora: string; produtos: Record<string, number> })[];
  por_ramo_re: (Valores & { ramo: string })[];
  por_canal: (Valores & { canal: string })[];
  por_susep: { susep: string; propostas: number; premio: number }[];
  por_entidade: (Valores & Entidade & { premio_ano_anterior: number })[];
  funil: Eventos & { premio_convertido: number; identificados: number; etapa_atual_das_entradas: Record<string, number> };
  funil_ano_anterior: Eventos;
  funil_mensal: { competencia: string; eventos: Partial<Record<"entrada" | "aprovacao" | "recusa" | "perda" | "conversao", number>> }[];
  funil_por_entidade: (Eventos & Entidade & { premio_convertido: number })[];
  funil_por_produto: CotacaoProduto[];
  funil_mensal_produto: { competencia: string; produtos: Record<string, Partial<Record<"entrada" | "aprovacao" | "recusa" | "perda" | "conversao", number>>> }[];
  funil_meses_com_planilha: string[];
  renovacoes: Renovacoes & { premio_convertido: number; comissao_convertida: number; identificados: number; etapa_atual_das_entradas: Record<string, number> };
  renovacoes_ano_anterior: Renovacoes;
  renovacoes_por_produto: RenovacaoProduto[];
  renovacoes_mensal_produto: { competencia: string; produtos: Record<string, Partial<Record<"entrada" | "perda" | "conversao", number>>> }[];
  renovacoes_por_entidade: (Renovacoes & Entidade & { premio_convertido: number })[];
  atualizado_em: string | null;
};
type Renovacoes = { entradas: number; conversoes: number; perdas: number };
type RenovacaoProduto = Renovacoes & {
  produto: string;
  premio_convertido: number;
  comissao_convertida: number;
  entradas_ano_anterior: number;
  conversoes_ano_anterior: number;
  historico_desde: string | null;
};
type Fontes = { bitrix: string | null; corp: string | null };
type CotacaoProduto = Eventos & {
  produto: string;
  premio_convertido: number;
  comissao_convertida: number;
  entradas_ano_anterior: number;
  conversoes_ano_anterior: number;
  historico_desde: string | null;
};

const PRODUTOS: Record<string, { rotulo: string; cor: string }> = {
  capitalizacao: { rotulo: "Capitalização", cor: "#2E6FB7" },
  fianca: { rotulo: "Seguro Fiança", cor: "#F8540D" },
  re: { rotulo: "Ramos Elementares", cor: "#01192e" },
  automovel: { rotulo: "Automóvel", cor: "#9CA3AF" },
};
const ORDEM_PRODUTOS = ["capitalizacao", "fianca", "re", "automovel"];
const SEGURADORAS = [
  "Tokio Marine", "Porto", "Pottencial", "Yelum (ex-Liberty)", "Brasilcap", "Icatu", "SulAmérica", "Bradesco", "Alfa", "Too",
  "Allianz", "Cardif", "Mapfre", "Zurich", "Suhai", "Azul", "HDI", "Sompo", "Outras",
];
const CANAIS: Record<string, { rotulo: string; legenda: string }> = {
  imobiliaria: { rotulo: "Imobiliária identificada", legenda: "produtor do Corp ligado (confirmado) a uma ficha do cadastro" },
  nao_identificado: { rotulo: "Imobiliária ainda não confirmada", legenda: "produtor do Corp sem vínculo confirmado — confirme em Imobiliárias cadastradas" },
  venda_direta: { rotulo: "Venda direta O2", legenda: "produtor principal é a própria O2 Corretora" },
  so_canal: { rotulo: "Só canal (Segimob, Base, Superlógica…)", legenda: "proposta sem imobiliária, só com canal ou marcador do Corp" },
  automovel: { rotulo: "Automóvel", legenda: "Automóvel não tem vínculo com imobiliária (entra só no macro)" },
};
// Cotações de Seguro Fiança: planilhas de análise jul/2020 → jul/2026, Bitrix
// de ago/2026 em diante. Meses sem planilha confirmados pelo Matheus em
// 19/10/2026 (não existem no Drive) ou ainda não importáveis.
const MESES_INEXISTENTES = new Set(["2020-06", "2021-07", "2023-08", "2025-10"]);
const MESES_SEM_STATUS_GERAL = new Set(["2024-03", "2024-12"]);
const INICIO_FUNIL = "2020-07";
const INICIO_BITRIX_FIANCA = "2026-08";

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES_PT[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const num = (v: number) => Math.round(v).toLocaleString("pt-BR");
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compacto = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`
    : `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil`;
const pct = (a: number, b: number, casas = 1) => (b ? `${((100 * a) / b).toLocaleString("pt-BR", { maximumFractionDigits: casas })}%` : "—");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

function somarMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
function listaMeses(de: string, ate: string) {
  const r: string[] = [];
  for (let m = de; m <= ate; m = somarMeses(m, 1)) r.push(m);
  return r;
}
const mesValido = (v: string | undefined) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
const lista = (v: string | undefined) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

type Variacao = { texto: string; cls: string } | null;
function variacao(atual: number, anterior: number): Variacao {
  if (!anterior) return null;
  const v = (atual / anterior - 1) * 100;
  const t = `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (Math.abs(v) < 2) return { texto: t, cls: "bg-gray-100 text-gray-600" };
  return { texto: t, cls: v > 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700" };
}

export default async function ProducaoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; p?: string; s?: string; g?: string; i?: string; atualizar?: string; todas?: string; todasc?: string; todasr?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const mesAtual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const umAlvo = lista(sp.g).filter(uuid).length + lista(sp.i).filter(uuid).length === 1;
  // Regra do Matheus (21/10/2026): toda aba do Power BI abre no mês vigente.
  let de = mesValido(sp.de) ?? mesAtual;
  let ate = mesValido(sp.ate) ?? mesAtual;
  if (de < "2015-01") de = "2015-01";
  if (ate > mesAtual) ate = mesAtual;
  if (de > ate) [de, ate] = [ate, de];
  const filtros: Filtros = {
    de,
    ate,
    produtos: lista(sp.p).filter((p) => p in PRODUTOS),
    seguradoras: lista(sp.s).filter((s) => SEGURADORAS.includes(s)),
    grupos: lista(sp.g).filter(uuid),
    imobs: lista(sp.i).filter(uuid),
  };
  const filtroImob = filtros.grupos.length + filtros.imobs.length > 0;

  // Resumo remontado só quando houve vínculo/grupo/importação nova (ou no botão).
  const { error: erroAtualizar } = await supabase.rpc("atualizar_producao_painel", { p_forcar: pediuAtualizacao(sp.atualizar) });
  if (umAlvo) {
    const opcoes = await opcoesImobiliarias(supabase);
    const nome = opcoes.find((o) => o.id === (filtros.grupos[0] ?? filtros.imobs[0]))?.nome;
    return (
      <>
        <AppHeader userEmail={user.email} logoutAction={signOut} />
        <main className="mx-auto max-w-7xl flex-1 space-y-6 p-8">
          <PageHeader icon={<IconChart />} titulo="Power BI - O2 Seguros" subtitulo={`Imobiliária 360 · ${rotuloMes(de)} a ${rotuloMes(ate)}${nome ? ` · ${nome}` : ""}`} />
          <Abas ativa="/producao" />
          <Imobiliaria360
            supabase={supabase}
            de={de}
            ate={ate}
            grupo={filtros.grupos[0] ?? null}
            imob={filtros.grupos.length ? null : (filtros.imobs[0] ?? null)}
            mesAtual={mesAtual}
            opcoes={opcoes}
          />
        </main>
      </>
    );
  }
  const [{ data: kpisData, error: erroKpis }, opcoes, { data: imports }, { data: espelho }] = await Promise.all([
    supabase.rpc("kpis_producao", {
      p_de: de,
      p_ate: ate,
      p_produtos: filtros.produtos.length ? filtros.produtos : null,
      p_grupos: filtros.grupos.length ? filtros.grupos : null,
      p_imobs: filtros.imobs.length ? filtros.imobs : null,
      p_seguradoras: filtros.seguradoras.length ? filtros.seguradoras : null,
    }),
    opcoesImobiliarias(supabase),
    supabase.from("base_unica_importacoes").select("layout, importado_em").in("layout", ["bitrix_spa"]),
    supabase.from("corp_sp_arquivos").select("importado_em").eq("tipo", "grade").order("importado_em", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const kpis = kpisData as Kpis | null;
  const nomesSelecionados = opcoes.filter((o) => (o.tipo === "grupo" ? filtros.grupos : filtros.imobs).includes(o.id)).map((o) => o.nome);
  const ultima = (layout: string) =>
    (imports ?? [])
      .filter((r) => r.layout === layout)
      .map((r) => r.importado_em as string)
      .sort()
      .at(-1) ?? null;
  // Corp = espelho do SharePoint (cron corp-sharepoint), de 2020 em diante.
  const fontes: Fontes = { bitrix: ultima("bitrix_spa"), corp: (espelho?.importado_em as string | null) ?? null };

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader
            icon={<IconChart />}
            titulo="Power BI - O2 Seguros"
            subtitulo={`Imobiliária 360 · ${rotuloMes(de)} a ${rotuloMes(ate)}${filtroImob ? ` · só ${nomesSelecionados.join(", ") || "imobiliárias selecionadas"}` : " · O2 inteira"}`}
          />
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {kpis?.atualizado_em && <span>resumo de {dataHora(kpis.atualizado_em)}</span>}
            <AtualizarAgora />
            <Link href="/producao/relatorios" className="text-o2-blue underline">
              Grade do Corp (relatórios antigos)
            </Link>
          </div>
        </div>

        <Abas ativa="/producao" />

        {/* key: remonta a barra quando o recorte muda por link (ex.: clique numa imobiliária da tabela). */}
        <FiltrosProducao key={JSON.stringify(filtros)} filtros={filtros} mesAtual={mesAtual} opcoesImob={opcoes} seguradoras={SEGURADORAS} />

        {(erroKpis || erroAtualizar) && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não foi possível calcular agora ({(erroKpis ?? erroAtualizar)?.message}).</p>
        )}
        {!filtroImob && (
          <p className="text-sm text-gray-600">
            Visão da O2 inteira. Para ver tudo de uma imobiliária ou grupo (cadastro, cotações, apólices, sinistros e ferramentas), escolha no filtro ou clique no
            nome dela no ranking.
          </p>
        )}
        {kpis && filtroImob && (
          <p className="rounded-lg border border-o2-coral/30 bg-o2-coral/5 p-3 text-sm text-o2-navy">
            Os dois blocos abaixo mostram só as imobiliárias selecionadas (grupo = soma de todas as fichas do grupo). Automóvel não entra, porque não tem vínculo com
            imobiliária. Só conta o que já tem vínculo <b>confirmado</b> no cadastro.
          </p>
        )}
        {kpis && (
          <>
            <BlocoCotacoes kpis={kpis} filtros={filtros} filtroImob={filtroImob} fontes={fontes} todas={sp.todasc === "1"} todasRenov={sp.todasr === "1"} sp={sp} />
            <BlocoApolices kpis={kpis} filtroImob={filtroImob} mesAtual={mesAtual} fontes={fontes} todas={sp.todas === "1"} sp={sp} />
          </>
        )}
      </main>
    </>
  );
}

function Bloco({ titulo, fonte, cor, children }: { titulo: string; fonte: ReactNode; cor: string; children: ReactNode }) {
  return (
    <section className="space-y-6 rounded-2xl border border-gray-200 bg-gray-50/60 p-5" style={{ borderTop: `4px solid ${cor}` }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-o2-navy">{titulo}</h2>
          <p className="text-xs text-gray-500">{fonte}</p>
        </div>
        <ExportarEste titulo={titulo} />
      </div>
      {children}
    </section>
  );
}

function Cartao({ rotulo, valor, linhas, legenda, variacaoAno }: { rotulo: string; valor: string; linhas: string[]; legenda: ReactNode; variacaoAno?: Variacao }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {rotulo}
        <InfoLegenda titulo={rotulo}>{legenda}</InfoLegenda>
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-o2-navy">{valor}</p>
      {linhas.map((l) => (
        <p key={l} className="text-xs text-gray-500">
          {l}
        </p>
      ))}
      {variacaoAno && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${variacaoAno.cls}`}>{variacaoAno.texto} vs ano anterior</span>}
    </div>
  );
}

function Titulo({ children, legenda }: { children: ReactNode; legenda?: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
      {children}
      {legenda && <InfoLegenda titulo={typeof children === "string" ? children : undefined}>{legenda}</InfoLegenda>}
      <ExportarEste titulo={typeof children === "string" ? children : undefined} />
    </h3>
  );
}

function Grafico({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-sm font-semibold text-o2-navy">{titulo}</h4>
        <ExportarEste titulo={titulo} />
      </div>
      {children}
    </div>
  );
}

// Link que abre a visão 360 da imobiliária/grupo, mantendo o período.
function linkEntidade(sp: Record<string, string | undefined>, id: string, tipo: string) {
  const q = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["atualizar", "todas", "todasc", "todasr", "g", "i", "p", "s"].includes(k)) as [string, string][]);
  q.set(tipo === "grupo" ? "g" : "i", id);
  return `/producao?${q.toString()}`;
}
function linkVerTodas(sp: Record<string, string | undefined>, chave: "todas" | "todasc" | "todasr") {
  const q = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "atualizar") as [string, string][]);
  q.set(chave, "1");
  return `/producao?${q.toString()}`;
}
function NomeEntidade({ e, sp }: { e: Entidade; sp: Record<string, string | undefined> }) {
  return (
    <>
      <Link href={linkEntidade(sp, e.id, e.tipo)} className="font-medium text-o2-navy hover:underline">
        {e.nome ?? "—"}
      </Link>
      {e.tipo === "grupo" && <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">grupo</span>}
    </>
  );
}

// Opções do filtro: grupos e fichas com produção (maiores primeiro) + todas as
// outras fichas (a 360 também serve para quem só usa as ferramentas).
async function opcoesImobiliarias(supabase: Awaited<ReturnType<typeof createClient>>): Promise<OpcaoImob[]> {
  const [{ data: opcoesData }, { data: fichas }] = await Promise.all([
    supabase.rpc("opcoes_filtro_producao"),
    supabase.from("imobiliarias").select("id, nome, apelido, grupo_id").order("nome"),
  ]);
  const opcoes = (opcoesData ?? []) as OpcaoImob[];
  const jaListadas = new Set(opcoes.map((o) => o.id));
  for (const f of fichas ?? [])
    if (!jaListadas.has(f.id)) opcoes.push({ id: f.id, nome: f.apelido || f.nome, tipo: "imobiliaria", tipo_grupo: null, grupo_id: f.grupo_id, premio: 0, n: 0 });
  return opcoes;
}

function motivoSemFonte(m: string) {
  if (MESES_INEXISTENTES.has(m)) return "planilha não existe";
  if (MESES_SEM_STATUS_GERAL.has(m)) return "planilha só tem status por seguradora (pendente)";
  if (m < INICIO_FUNIL) return "2015–jun/2020 ainda não importado";
  return "sem planilha";
}

// Conversão de cada produto com a régua do painel do produto (21/10/2026):
// Fiança e RE = convertidas ÷ recebidas; Capitalização e Automóvel =
// convertidas ÷ (convertidas + perdidas), como /painel-capitalizacao e
// /painel-seguro-auto.
const REGUA_CONVERSAO: Record<string, { texto: string; calc: (p: CotacaoProduto) => [number, number] }> = {
  fianca: { texto: "convertidas ÷ recebidas", calc: (p) => [p.conversoes, p.entradas] },
  re: { texto: "efetivadas ÷ recebidas", calc: (p) => [p.conversoes, p.entradas] },
  capitalizacao: { texto: "emitidos ÷ (emitidos + perdidos)", calc: (p) => [p.conversoes, p.conversoes + p.perdas] },
  automovel: { texto: "convertidas ÷ (convertidas + perdidas)", calc: (p) => [p.conversoes, p.conversoes + p.perdas] },
};
const ROTULO_CURTO: Record<string, string> = { fianca: "Fiança", re: "RE", capitalizacao: "Cap", automovel: "Auto" };
const FONTE_COTACOES: Record<string, string> = {
  fianca: "planilhas de análise (jul/2020 a jul/2026) e Bitrix (ago/2026 →)",
  re: "planilhas Cotação diária RE (jul/2025 a ago/2026) e Bitrix (set/2026 →); negócio novo",
  capitalizacao: "planilhas de títulos novos (jul/2021 a jul/2026) e Bitrix (ago/2026 →)",
  automovel: "planilhas de RE (jul/2025 a ago/2026) e Bitrix (ago/2026 →); sem imobiliária",
};

// Renovações (21/10/2026): cada produto com a régua do painel dele —
// Fiança (aba Renovação do /seguro-fianca): renovadas ÷ (renovadas + perdidas);
// RE (/ramos-elementares): efetivadas ÷ renovações da competência.
const REGUA_RENOVACAO: Record<string, { texto: string; calc: (p: Renovacoes) => [number, number] }> = {
  fianca: { texto: "renovadas ÷ (renovadas + não renovadas)", calc: (p) => [p.conversoes, p.conversoes + p.perdas] },
  re: { texto: "efetivadas ÷ recebidas", calc: (p) => [p.conversoes, p.entradas] },
  automovel: { texto: "efetivadas ÷ recebidas", calc: (p) => [p.conversoes, p.entradas] },
};
const FONTE_RENOVACOES: Record<string, string> = {
  fianca: "aba RENOVAÇÕES das planilhas de análise (nov/2025 a set/2026) e funil Renovação do Bitrix (out/2026 →)",
  re: "abas RN das planilhas Cotação diária RE (nov/2025 a set/2026, 1 linha = 1 item) e funil Renovações do Bitrix (set/2026 →, 1 card = 1 negociação)",
  automovel: "renovações de automóvel lançadas nas planilhas de RE; sem imobiliária",
};

// ---------------------------------------------------------------- Cotações

function BlocoCotacoes({
  kpis,
  filtros,
  filtroImob,
  fontes,
  todas,
  todasRenov,
  sp,
}: {
  kpis: Kpis;
  filtros: Filtros;
  filtroImob: boolean;
  fontes: Fontes;
  todas: boolean;
  todasRenov: boolean;
  sp: Record<string, string | undefined>;
}) {
  const f = kpis.funil;
  const fa = kpis.funil_ano_anterior;
  const meses = listaMeses(kpis.de, kpis.ate);
  // Comparação com o ano anterior só quando todos os produtos na tela já têm
  // cotações no ano anterior nesta base (RE, Cap e Auto começam em 2026).
  const compara = kpis.meses <= 24 && fa.entradas > 0 && kpis.funil_por_produto.every((p) => !p.entradas || p.entradas_ano_anterior > 0);
  const naoConvertidas = f.perdas + f.recusas;
  const produtos = ORDEM_PRODUTOS.map((p) => kpis.funil_por_produto.find((x) => x.produto === p)).filter((x): x is CotacaoProduto => !!x);
  const produtosNaTela = produtos.map((p) => p.produto);
  const porMes = new Map(kpis.funil_mensal_produto.map((m) => [m.competencia, m.produtos]));
  const entidades = todas ? kpis.funil_por_entidade : kpis.funil_por_entidade.slice(0, 30);
  const mostraFianca = !filtros.produtos.length || filtros.produtos.includes("fianca");
  const comFonte = new Set([...kpis.funil_meses_com_planilha, ...meses.filter((m) => m >= INICIO_BITRIX_FIANCA)]);
  const semFonteFianca = mostraFianca ? meses.filter((m) => !comFonte.has(m)) : [];
  const entradasComImob = f.entradas - (produtos.find((p) => p.produto === "automovel")?.entradas ?? 0);

  return (
    <Bloco
      titulo="Cotações (funil)"
      cor="#F8540D"
      fonte={
        <>
          Tomadas de preço de todos os produtos: a cotação conta no mês em que entrou; a conversão (efetivação, emissão) e a perda, no mês em que aconteceram — a mesma
          régua do painel de cada produto, lida das mesmas fontes{fontes.bitrix ? ` (Bitrix lido em ${dataHora(fontes.bitrix)})` : ""}.
        </>
      }
    >
      {filtroImob && f.entradas === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          Nenhuma cotação ligada a essa seleção no período. O nome da imobiliária na planilha (ou a empresa do card no Bitrix) só conta depois que o vínculo é confirmado em{" "}
          <Link href="/admin/imobiliarias" className="text-o2-blue underline">
            Imobiliárias cadastradas
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cartao
              rotulo="Cotações recebidas"
              valor={num(f.entradas)}
              linhas={[produtos.map((p) => `${ROTULO_CURTO[p.produto] ?? p.produto} ${num(p.entradas)}`).join(" · ")]}
              variacaoAno={compara ? variacao(f.entradas, fa.entradas) : null}
              legenda="Cotações que entraram no período, somando os produtos (cada uma contada uma vez, no mês em que entrou — a herança da planilha para o mês seguinte não conta de novo)."
            />
            <Cartao
              rotulo="Convertidas"
              valor={num(f.conversoes)}
              linhas={[`${compacto(f.premio_convertido)} de prêmio/valor nas convertidas`]}
              variacaoAno={compara ? variacao(f.conversoes, fa.conversoes) : null}
              legenda="Cotações convertidas no período, pelo mês da conversão: Fiança convertida, RE efetivado, título de Capitalização pago/emitido, Automóvel finalizado."
            />
            <Cartao
              rotulo="Não convertidas"
              valor={num(naoConvertidas)}
              linhas={[mostraFianca && f.recusas ? `${num(f.recusas)} recusadas pela seguradora (Fiança) · ${num(f.perdas)} perdidas` : `${num(f.perdas)} perdidas`]}
              variacaoAno={compara ? variacao(naoConvertidas, fa.perdas + fa.recusas) : null}
              legenda="Cotações que terminaram sem fechar no período, pelo mês em que aconteceu: recusa da seguradora (só no processo da Fiança), cliente desistiu/negativou, não efetivado, pagamento não realizado."
            />
            <Cartao
              rotulo="Conversão geral"
              valor={pct(f.conversoes, f.conversoes + naoConvertidas)}
              linhas={["convertidas ÷ (convertidas + não convertidas)"]}
              legenda="Das cotações que tiveram desfecho no período, quantas converteram. A conversão de cada produto, com a régua do painel dele, está na tabela abaixo."
            />
          </div>

          <div className="space-y-2">
            <Titulo legenda="Cada produto com a régua do painel dele (/seguro-fianca, /ramos-elementares, /painel-capitalizacao, /painel-seguro-auto). 'Desde' = primeiro mês com cotações nesta base.">
              Por produto
            </Titulo>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-o2-navy text-left text-xs text-white">
                  <tr>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2 text-right">Recebidas</th>
                    <th className="px-3 py-2 text-right">Convertidas</th>
                    <th className="px-3 py-2 text-right">Não convertidas</th>
                    <th className="px-3 py-2 text-right">Conversão</th>
                    <th className="px-3 py-2 text-right">Prêmio/valor convertido</th>
                    {kpis.meses <= 24 && <th className="px-3 py-2 text-right">Recebidas vs ano anterior</th>}
                  </tr>
                </thead>
                <tbody>
                  {produtos.map((p) => {
                    const [a, b] = REGUA_CONVERSAO[p.produto]?.calc(p) ?? [p.conversoes, p.entradas];
                    const v = variacao(p.entradas, p.entradas_ano_anterior);
                    return (
                      <tr key={p.produto} className="border-t border-gray-100 align-top">
                        <td className="px-3 py-2">
                          <p className="font-medium text-o2-navy">
                            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PRODUTOS[p.produto]?.cor }} />
                            {PRODUTOS[p.produto]?.rotulo ?? p.produto}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {FONTE_COTACOES[p.produto]}
                            {p.historico_desde ? ` · desde ${rotuloMes(p.historico_desde)}` : ""}
                          </p>
                          {p.produto === "fianca" && (
                            <p className="text-[11px] text-gray-500">
                              aprovadas {num(p.aprovacoes)} (aprovação {pct(p.aprovacoes, p.aprovacoes + p.recusas)}) · recusadas {num(p.recusas)} · negativadas {num(p.perdas)}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{num(p.entradas)}</td>
                        <td className="px-3 py-2 text-right">{num(p.conversoes)}</td>
                        <td className="px-3 py-2 text-right">{num(p.perdas + p.recusas)}</td>
                        <td className="px-3 py-2 text-right">
                          <span className="font-semibold">{pct(a, b)}</span>
                          <p className="text-[10px] text-gray-400">{REGUA_CONVERSAO[p.produto]?.texto}</p>
                        </td>
                        <td className="px-3 py-2 text-right">{p.premio_convertido ? compacto(p.premio_convertido) : "—"}</td>
                        {kpis.meses <= 24 && <td className="px-3 py-2 text-right">{v ? <span className={`rounded-full px-2 py-0.5 text-xs ${v.cls}`}>{v.texto}</span> : <span className="text-xs text-gray-400">sem base</span>}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500">
              Só o Seguro Fiança tem a etapa de aprovação/recusa pela seguradora; nos outros produtos a cotação vai direto para a negociação com o cliente.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Grafico titulo="Cotações recebidas por mês">
              <BarrasMensais
                pontos={meses.map((m) => ({ mes: m, valores: Object.fromEntries(produtosNaTela.map((p) => [p, porMes.get(m)?.[p]?.entrada ?? 0])) }))}
                series={produtosNaTela.map((p) => ({ chave: p, rotulo: PRODUTOS[p].rotulo, cor: PRODUTOS[p].cor }))}
                altura={170}
              />
            </Grafico>
            <Grafico titulo="Convertidas por mês">
              <BarrasMensais
                pontos={meses.map((m) => ({ mes: m, valores: Object.fromEntries(produtosNaTela.map((p) => [p, porMes.get(m)?.[p]?.conversao ?? 0])) }))}
                series={produtosNaTela.map((p) => ({ chave: p, rotulo: PRODUTOS[p].rotulo, cor: PRODUTOS[p].cor }))}
                altura={170}
              />
            </Grafico>
          </div>
          {semFonteFianca.length > 0 && (
            <p className="text-xs text-gray-500">
              Seguro Fiança — meses sem fonte de cotação neste período (aparecem vazios, não são zero):{" "}
              {semFonteFianca
                .reduce<{ motivo: string; meses: string[] }[]>((acc, m) => {
                  const motivo = motivoSemFonte(m);
                  const ult = acc[acc.length - 1];
                  // Junta só meses seguidos com o mesmo motivo.
                  if (ult && ult.motivo === motivo && somarMeses(ult.meses[ult.meses.length - 1], 1) === m) ult.meses.push(m);
                  else acc.push({ motivo, meses: [m] });
                  return acc;
                }, [])
                .map((g) => `${g.meses.length > 2 ? `${rotuloMes(g.meses[0])} a ${rotuloMes(g.meses[g.meses.length - 1])}` : g.meses.map(rotuloMes).join(", ")} (${g.motivo})`)
                .join(" · ")}
              . Os outros produtos só têm cotações a partir do mês indicado em &quot;desde&quot; na tabela.
            </p>
          )}

          <div className="space-y-2">
            <Titulo
              legenda={
                <>
                  Cotações de cada imobiliária/grupo no período, somando os produtos (Automóvel não tem imobiliária). Clique no nome para ver o painel inteiro só daquela
                  imobiliária — e use o filtro de produto para ver um produto só. Só aparece quem já tem vínculo confirmado no cadastro.
                </>
              }
            >
              {filtroImob ? "Cotações das imobiliárias selecionadas" : "Cotações por imobiliária / grupo"}
            </Titulo>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-o2-navy text-left text-xs text-white">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Imobiliária / grupo</th>
                    <th className="px-3 py-2 text-right">Recebidas</th>
                    <th className="px-3 py-2 text-right">Convertidas</th>
                    <th className="px-3 py-2 text-right">Não convertidas</th>
                    <th className="px-3 py-2 text-right">Conversão</th>
                    <th className="px-3 py-2 text-right">Prêmio/valor convertido</th>
                  </tr>
                </thead>
                <tbody>
                  {entidades.map((x, i) => (
                    <tr key={x.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <NomeEntidade e={x} sp={sp} />
                      </td>
                      <td className="px-3 py-2 text-right">{num(x.entradas)}</td>
                      <td className="px-3 py-2 text-right">{num(x.conversoes)}</td>
                      <td className="px-3 py-2 text-right">{num(x.perdas + x.recusas)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{pct(x.conversoes, x.conversoes + x.perdas + x.recusas)}</td>
                      <td className="px-3 py-2 text-right">{x.premio_convertido ? compacto(x.premio_convertido) : "—"}</td>
                    </tr>
                  ))}
                  {!entidades.length && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                        Nenhuma cotação com imobiliária confirmada no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!todas && kpis.funil_por_entidade.length > entidades.length && (
              <Link href={linkVerTodas(sp, "todasc")} className="text-sm text-o2-blue underline">
                Ver todas as {kpis.funil_por_entidade.length}
              </Link>
            )}
            {!filtroImob && entradasComImob > 0 && (
              <p className="text-xs text-gray-500">
                {pct(f.identificados, entradasComImob, 0)} das cotações recebidas no período (sem contar Automóvel) já têm a imobiliária confirmada no cadastro; o restante
                ainda é sugestão por nome e não entra nesta tabela nem no filtro por imobiliária.
              </p>
            )}
          </div>
        </>
      )}
      <Renovacoes kpis={kpis} filtroImob={filtroImob} todas={todasRenov} sp={sp} meses={meses} />
    </Bloco>
  );
}

// Renovações de Seguro Fiança e Ramos Elementares — série separada das
// cotações novas (Matheus, 21/10/2026): a renovação conta como recebida no
// mês em que entrou (Fiança: 1ª planilha em que aparece / criação do card;
// RE: mês do vencimento = aba RN / competência do card) e como renovada ou
// não renovada no mês do desfecho. Não entra nos números de cotações acima.
function Renovacoes({ kpis, filtroImob, todas, sp, meses }: { kpis: Kpis; filtroImob: boolean; todas: boolean; sp: Record<string, string | undefined>; meses: string[] }) {
  const r = kpis.renovacoes;
  const ra = kpis.renovacoes_ano_anterior;
  const produtos = ORDEM_PRODUTOS.map((p) => kpis.renovacoes_por_produto.find((x) => x.produto === p)).filter((x): x is RenovacaoProduto => !!x);
  if (!produtos.length) return null;
  const produtosNaTela = produtos.map((p) => p.produto);
  const porMes = new Map(kpis.renovacoes_mensal_produto.map((m) => [m.competencia, m.produtos]));
  const entidades = todas ? kpis.renovacoes_por_entidade : kpis.renovacoes_por_entidade.slice(0, 30);
  const compara = kpis.meses <= 24 && ra.entradas > 0 && produtos.every((p) => !p.entradas || p.entradas_ano_anterior > 0);
  const transicaoRe = produtosNaTela.includes("re") && meses.some((m) => m >= "2026-09") && meses.some((m) => m <= "2026-09");

  return (
    <div className="space-y-4 rounded-xl border border-dashed border-o2-coral/40 bg-white/60 p-4">
      <div>
        <h3 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
          Renovações (Seguro Fiança e Ramos Elementares)
          <InfoLegenda titulo="Renovações">
            Série separada das cotações novas acima — não entra nas cotações recebidas nem na conversão. A renovação conta como recebida no mês em que entrou
            (Fiança: primeira planilha em que aparece ou criação do card; RE: mês do vencimento da apólice) e como renovada ou não renovada no mês em que isso
            aconteceu, a mesma régua da aba Renovação do /seguro-fianca e do /ramos-elementares.
          </InfoLegenda>
          <ExportarEste titulo="Renovações" />
        </h3>
        <p className="text-xs text-gray-500">
          Fiança: {FONTE_RENOVACOES.fianca}. RE: {FONTE_RENOVACOES.re}.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          rotulo="Renovações recebidas"
          valor={num(r.entradas)}
          linhas={[produtos.map((p) => `${ROTULO_CURTO[p.produto] ?? p.produto} ${num(p.entradas)}`).join(" · ")]}
          variacaoAno={compara ? variacao(r.entradas, ra.entradas) : null}
          legenda="Renovações que entraram no período, cada uma contada uma vez, no mês em que entrou (Fiança: 1ª planilha em que aparece ou criação do card; RE: mês do vencimento)."
        />
        <Cartao
          rotulo="Renovadas"
          valor={num(r.conversoes)}
          linhas={[`${compacto(r.premio_convertido)} de prêmio nas renovadas`]}
          variacaoAno={compara ? variacao(r.conversoes, ra.conversoes) : null}
          legenda="Renovações efetivadas no período, pelo mês em que foram efetivadas (Sucesso no funil ou RENOVADO/EFETIVADO na planilha)."
        />
        <Cartao
          rotulo="Não renovadas"
          valor={num(r.perdas)}
          linhas={[produtos.map((p) => `${ROTULO_CURTO[p.produto] ?? p.produto} ${num(p.perdas)}`).join(" · ")]}
          variacaoAno={compara ? variacao(r.perdas, ra.perdas) : null}
          legenda="Renovações perdidas no período, pelo mês em que isso aconteceu (Perdido no funil; NÃO RENOVADO, NÃO EFETIVADO, SEM PARCERIA ou CANCELADO na planilha)."
        />
        <Cartao
          rotulo="Taxa de renovação"
          valor={pct(r.conversoes, r.conversoes + r.perdas)}
          linhas={["renovadas ÷ (renovadas + não renovadas)"]}
          legenda="Das renovações que tiveram desfecho no período, quantas renovaram. A taxa de cada produto, com a régua do painel dele, está na tabela ao lado."
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-o2-navy text-left text-xs text-white">
              <tr>
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2 text-right">Recebidas</th>
                <th className="px-3 py-2 text-right">Renovadas</th>
                <th className="px-3 py-2 text-right">Não renovadas</th>
                <th className="px-3 py-2 text-right">Taxa</th>
                <th className="px-3 py-2 text-right">Prêmio renovado</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => {
                const [a, b] = REGUA_RENOVACAO[p.produto]?.calc(p) ?? [p.conversoes, p.entradas];
                return (
                  <tr key={p.produto} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium text-o2-navy">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PRODUTOS[p.produto]?.cor }} />
                        {PRODUTOS[p.produto]?.rotulo ?? p.produto}
                      </p>
                      <p className="text-[11px] text-gray-400">{p.historico_desde ? `desde ${rotuloMes(p.historico_desde)}` : ""}</p>
                    </td>
                    <td className="px-3 py-2 text-right">{num(p.entradas)}</td>
                    <td className="px-3 py-2 text-right">{num(p.conversoes)}</td>
                    <td className="px-3 py-2 text-right">{num(p.perdas)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-semibold">{pct(a, b)}</span>
                      <p className="text-[10px] text-gray-400">{REGUA_RENOVACAO[p.produto]?.texto}</p>
                    </td>
                    <td className="px-3 py-2 text-right">{p.premio_convertido ? compacto(p.premio_convertido) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Grafico titulo="Renovações recebidas e renovadas por mês">
          <BarrasMensais
            pontos={meses.map((m) => ({
              mes: m,
              valores: Object.fromEntries(produtosNaTela.flatMap((p) => [[`${p}_r`, porMes.get(m)?.[p]?.entrada ?? 0], [`${p}_c`, porMes.get(m)?.[p]?.conversao ?? 0]])),
            }))}
            series={produtosNaTela.flatMap((p) => [
              { chave: `${p}_r`, rotulo: `${PRODUTOS[p].rotulo} recebidas`, cor: PRODUTOS[p].cor + "66" },
              { chave: `${p}_c`, rotulo: `${PRODUTOS[p].rotulo} renovadas`, cor: PRODUTOS[p].cor },
            ])}
            altura={170}
          />
        </Grafico>
      </div>
      {transicaoRe && (
        <p className="text-xs text-gray-500">
          Ramos Elementares: até set/2026 as renovações vêm das planilhas e contam por item (1 linha = 1 apólice); a partir de out/2026 vêm do Bitrix e contam por
          card (1 card = 1 negociação por imobiliária, com os itens em planilha anexa). Em set/2026 o painel soma as duas fontes. Set e out não são comparáveis.
        </p>
      )}
      {entidades.length > 0 && (
        <div className="space-y-2">
          <Titulo legenda="Renovações de cada imobiliária/grupo no período (Automóvel não tem imobiliária). Só aparece quem já tem vínculo confirmado no cadastro.">
            {filtroImob ? "Renovações das imobiliárias selecionadas" : "Renovações por imobiliária / grupo"}
          </Titulo>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-o2-navy text-left text-xs text-white">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Imobiliária / grupo</th>
                  <th className="px-3 py-2 text-right">Recebidas</th>
                  <th className="px-3 py-2 text-right">Renovadas</th>
                  <th className="px-3 py-2 text-right">Não renovadas</th>
                  <th className="px-3 py-2 text-right">Taxa</th>
                  <th className="px-3 py-2 text-right">Prêmio renovado</th>
                </tr>
              </thead>
              <tbody>
                {entidades.map((x, i) => (
                  <tr key={x.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2">
                      <NomeEntidade e={x} sp={sp} />
                    </td>
                    <td className="px-3 py-2 text-right">{num(x.entradas)}</td>
                    <td className="px-3 py-2 text-right">{num(x.conversoes)}</td>
                    <td className="px-3 py-2 text-right">{num(x.perdas)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{pct(x.conversoes, x.conversoes + x.perdas)}</td>
                    <td className="px-3 py-2 text-right">{x.premio_convertido ? compacto(x.premio_convertido) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!todas && kpis.renovacoes_por_entidade.length > entidades.length && (
            <Link href={linkVerTodas(sp, "todasr")} className="text-sm text-o2-blue underline">
              Ver todas as {kpis.renovacoes_por_entidade.length}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Apólices (Corp)

function estatisticas(valores: number[]) {
  const n = valores.length;
  if (!n) return null;
  const media = valores.reduce((s, v) => s + v, 0) / n;
  const ord = [...valores].sort((a, b) => a - b);
  const mediana = n % 2 ? ord[(n - 1) / 2] : (ord[n / 2 - 1] + ord[n / 2]) / 2;
  const desvio = Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / n);
  return { media, mediana, desvio, cv: media ? desvio / media : 0 };
}

// Tendência: inclinação da reta (mínimos quadrados) por mês, em % da média.
function tendencia(valores: number[]) {
  const n = valores.length;
  if (n < 3) return null;
  const mx = (n - 1) / 2;
  const my = valores.reduce((s, v) => s + v, 0) / n;
  let numerador = 0;
  let den = 0;
  valores.forEach((v, i) => {
    numerador += (i - mx) * (v - my);
    den += (i - mx) ** 2;
  });
  return my ? numerador / den / my : null;
}

function BlocoApolices({
  kpis,
  filtroImob,
  mesAtual,
  fontes,
  todas,
  sp,
}: {
  kpis: Kpis;
  filtroImob: boolean;
  mesAtual: string;
  fontes: Fontes;
  todas: boolean;
  sp: Record<string, string | undefined>;
}) {
  const r = kpis.resumo;
  const ant = kpis.resumo_ano_anterior;
  const compara = kpis.meses <= 24 && ant.propostas > 0;
  const meses = listaMeses(kpis.de, kpis.ate);
  const porMes = new Map(kpis.mensal.map((m) => [m.competencia, m.produtos]));
  const produtosNaTela = ORDEM_PRODUTOS.filter((p) => kpis.por_produto.some((x) => x.produto === p));
  const premioMensal = meses.map((m) => Object.values(porMes.get(m) ?? {}).reduce((s, v) => s + v.premio, 0));
  const est = estatisticas(premioMensal);
  const tend = tendencia(premioMensal);
  const melhor = meses.length ? meses[premioMensal.indexOf(Math.max(...premioMensal))] : null;
  const pior = meses.length ? meses[premioMensal.indexOf(Math.min(...premioMensal))] : null;
  const entidades = todas ? kpis.por_entidade : kpis.por_entidade.slice(0, 30);
  const totalCanal = kpis.por_canal.reduce((s, c) => s + c.premio, 0);

  return (
    <Bloco
      titulo="Apólices efetivadas (Corp)"
      cor="#01192e"
      fonte={
        <>
          O que foi efetivado de fato: documentos, prêmio líquido e comissão da corretora, pelo mês da data da proposta — a mesma conta do Power BI (documento
          conta uma vez; novos, renovações, endossos, faturas e cancelamentos). Fonte: espelho do SharePoint do Corp, de 2020 em diante
          {fontes.corp ? ` (atualizado em ${dataHora(fontes.corp)})` : ""}; de 2015 a 2019, os relatórios PDF do Corp. A imobiliária é ligada pelo código do
          produtor. O filtro de seguradora vale só para este bloco.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          rotulo="Prêmio líquido"
          valor={compacto(r.premio)}
          linhas={[`média de ${compacto(r.premio / Math.max(1, kpis.meses))} por mês`]}
          variacaoAno={compara ? variacao(r.premio, ant.premio) : null}
          legenda={`Soma do prêmio líquido das propostas efetivadas no Corp no período. A comparação é com o mesmo período do ano anterior (${rotuloMes(ant.de)} a ${rotuloMes(ant.ate)}).`}
        />
        <Cartao
          rotulo="Comissão da corretora"
          valor={compacto(r.comissao)}
          linhas={[`${pct(r.comissao, r.premio)} do prêmio`]}
          variacaoAno={compara ? variacao(r.comissao, ant.comissao) : null}
          legenda="Comissão da corretora registrada no Corp para essas propostas (antes do repasse às imobiliárias)."
        />
        <Cartao
          rotulo="Propostas efetivadas"
          valor={num(r.propostas)}
          linhas={[`ticket médio ${reais(r.propostas ? r.premio / r.propostas : 0)}`]}
          variacaoAno={compara ? variacao(r.propostas, ant.propostas) : null}
          legenda="Quantidade de propostas efetivadas no Corp. Ticket médio = prêmio líquido ÷ propostas."
        />
        <Cartao
          rotulo={filtroImob ? "Fichas com produção" : "Imobiliárias ativas"}
          valor={num(r.entidades_ativas)}
          linhas={[compara && !filtroImob ? `${num(ant.entidades_ativas)} no ano anterior` : "com ao menos 1 proposta no período"]}
          variacaoAno={compara && !filtroImob ? variacao(r.entidades_ativas, ant.entidades_ativas) : null}
          legenda="Imobiliárias (ou grupos, contados uma vez) com ao menos uma proposta efetivada no período. Só conta quem já tem vínculo confirmado no cadastro."
        />
      </div>
      {kpis.ate === mesAtual && fontes.corp && (
        <p className="text-xs text-gray-500">O mês corrente ({rotuloMes(mesAtual)}) está incompleto: o espelho do Corp foi atualizado em {dataHora(fontes.corp)}.</p>
      )}

      <div className="space-y-2">
        <Titulo>Por produto</Titulo>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-o2-navy text-left text-xs text-white">
              <tr>
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2 text-right">Propostas</th>
                <th className="px-3 py-2 text-right">Prêmio líquido</th>
                <th className="px-3 py-2 text-right">% do prêmio</th>
                <th className="px-3 py-2 text-right">Comissão</th>
                <th className="px-3 py-2 text-right">Ticket médio</th>
                {compara && <th className="px-3 py-2 text-right">Prêmio vs ano anterior</th>}
              </tr>
            </thead>
            <tbody>
              {kpis.por_produto.map((p) => {
                const v = variacao(p.premio, p.premio_ano_anterior);
                return (
                  <tr key={p.produto} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-o2-navy">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PRODUTOS[p.produto]?.cor }} />
                      {PRODUTOS[p.produto]?.rotulo ?? p.produto}
                    </td>
                    <td className="px-3 py-2 text-right">{num(p.propostas)}</td>
                    <td className="px-3 py-2 text-right">{reais(p.premio)}</td>
                    <td className="px-3 py-2 text-right">{pct(p.premio, r.premio)}</td>
                    <td className="px-3 py-2 text-right">{reais(p.comissao)}</td>
                    <td className="px-3 py-2 text-right">{reais(p.propostas ? p.premio / p.propostas : 0)}</td>
                    {compara && <td className="px-3 py-2 text-right">{v ? <span className={`rounded-full px-2 py-0.5 text-xs ${v.cls}`}>{v.texto}</span> : "—"}</td>}
                  </tr>
                );
              })}
              {!kpis.por_produto.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    Nenhuma proposta efetivada com esse recorte.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Grafico titulo="Prêmio líquido por mês">
          <BarrasMensais
            pontos={meses.map((m) => ({ mes: m, valores: Object.fromEntries(produtosNaTela.map((p) => [p, porMes.get(m)?.[p]?.premio ?? 0])) }))}
            series={produtosNaTela.map((p) => ({ chave: p, rotulo: PRODUTOS[p].rotulo, cor: PRODUTOS[p].cor }))}
            formato="reais"
            altura={180}
          />
        </Grafico>
        <Grafico titulo="Propostas efetivadas por mês">
          <BarrasMensais
            pontos={meses.map((m) => ({ mes: m, valores: Object.fromEntries(produtosNaTela.map((p) => [p, porMes.get(m)?.[p]?.propostas ?? 0])) }))}
            series={produtosNaTela.map((p) => ({ chave: p, rotulo: PRODUTOS[p].rotulo, cor: PRODUTOS[p].cor }))}
            altura={180}
          />
        </Grafico>
      </div>

      {est && meses.length >= 3 && (
        <div className="space-y-2">
          <Titulo
            legenda={
              <>
                Calculado sobre o prêmio líquido de cada mês do período (meses sem produção contam como zero). Coeficiente de variação = desvio-padrão ÷ média: quanto
                maior, mais irregular a produção mês a mês. Tendência = inclinação da reta que melhor passa pelos meses, em % da média por mês.
              </>
            }
          >
            Estatística mensal do prêmio
          </Titulo>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Média", compacto(est.media)],
              ["Mediana", compacto(est.mediana)],
              ["Desvio-padrão", compacto(est.desvio)],
              ["Coef. de variação", `${(est.cv * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`],
              ["Melhor mês", melhor ? `${rotuloMes(melhor)} · ${compacto(Math.max(...premioMensal))}` : "—"],
              ["Tendência", tend == null ? "—" : `${tend >= 0 ? "+" : "−"}${Math.abs(tend * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ao mês`],
            ].map(([rot, val]) => (
              <div key={rot} className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-xs text-gray-500">{rot}</p>
                <p className="mt-0.5 text-sm font-semibold text-o2-navy">{val}</p>
              </div>
            ))}
          </div>
          {pior && (
            <p className="text-xs text-gray-500">
              Pior mês: {rotuloMes(pior)} · {compacto(Math.min(...premioMensal))}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <Titulo legenda="Seguradora da proposta no Corp, com os nomes agrupados (ex.: as duas grafias da Porto viram uma; Liberty e Yelum são a mesma companhia).">
            Por seguradora
          </Titulo>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-o2-navy text-left text-xs text-white">
                <tr>
                  <th className="px-3 py-2">Seguradora</th>
                  <th className="px-3 py-2 text-right">Propostas</th>
                  <th className="px-3 py-2 text-right">Prêmio</th>
                  <th className="px-3 py-2 text-right">% prêmio</th>
                  <th className="px-3 py-2 text-right">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {kpis.por_seguradora.map((s) => (
                  <tr key={s.seguradora} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-o2-navy">
                      {s.seguradora}
                      <span className="ml-1 text-[11px] font-normal text-gray-400">
                        {ORDEM_PRODUTOS.filter((p) => s.produtos[p])
                          .map((p) => PRODUTOS[p].rotulo.split(" ")[0])
                          .join(" · ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{num(s.propostas)}</td>
                    <td className="px-3 py-2 text-right">{compacto(s.premio)}</td>
                    <td className="px-3 py-2 text-right">{pct(s.premio, r.premio)}</td>
                    <td className="px-3 py-2 text-right">{compacto(s.comissao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          {!filtroImob && (
            <div className="space-y-2">
              <Titulo legenda="De onde vem a produção do período. 'Ainda não confirmada' é produção de produtor do Corp sem vínculo confirmado no cadastro: diminui à medida que as fichas são revisadas.">
                Origem da produção
              </Titulo>
              <div className="space-y-1.5 rounded-xl border border-gray-200 bg-white p-4 text-sm">
                {Object.keys(CANAIS)
                  .map((k) => kpis.por_canal.find((c) => c.canal === k))
                  .filter((c): c is NonNullable<typeof c> => !!c)
                  .map((c) => (
                    <div key={c.canal}>
                      <div className="flex justify-between gap-2">
                        <span className="text-o2-navy" title={CANAIS[c.canal].legenda}>
                          {CANAIS[c.canal].rotulo}
                        </span>
                        <span className="tabular-nums text-gray-600">
                          {compacto(c.premio)} · {pct(c.premio, totalCanal)}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full bg-o2-blue" style={{ width: `${totalCanal ? (100 * c.premio) / totalCanal : 0}%` }} />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {kpis.por_ramo_re.length > 0 && (
            <div className="space-y-2">
              <Titulo>Ramos Elementares por ramo</Titulo>
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-o2-navy text-left text-xs text-white">
                    <tr>
                      <th className="px-3 py-2">Ramo</th>
                      <th className="px-3 py-2 text-right">Propostas</th>
                      <th className="px-3 py-2 text-right">Prêmio</th>
                      <th className="px-3 py-2 text-right">Comissão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpis.por_ramo_re.map((x) => (
                      <tr key={x.ramo} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-o2-navy">{x.ramo}</td>
                        <td className="px-3 py-2 text-right">{num(x.propostas)}</td>
                        <td className="px-3 py-2 text-right">{compacto(x.premio)}</td>
                        <td className="px-3 py-2 text-right">{compacto(x.comissao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {kpis.por_susep.length > 1 && (
            <p className="text-xs text-gray-500">
              SUSEP do grupo O2:{" "}
              {[...kpis.por_susep]
                .sort((a, b) => a.susep.localeCompare(b.susep))
                .map((s) => `${s.susep === "primeira_susep" ? "1ª SUSEP" : "2ª SUSEP"} ${compacto(s.premio)} (${num(s.propostas)} propostas)`)
                .join(" · ")}
              .
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Titulo
          legenda={
            <>
              Imobiliárias e grupos com produção efetivada no período (grupo = soma das fichas). Clique no nome para ver o painel inteiro só daquela imobiliária. Só aparece
              quem já tem vínculo confirmado no cadastro.
            </>
          }
        >
          {filtroImob ? "Apólices das imobiliárias selecionadas" : "Apólices por imobiliária / grupo"}
        </Titulo>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-o2-navy text-left text-xs text-white">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Imobiliária / grupo</th>
                <th className="px-3 py-2 text-right">Propostas</th>
                <th className="px-3 py-2 text-right">Prêmio</th>
                <th className="px-3 py-2 text-right">% prêmio</th>
                <th className="px-3 py-2 text-right">Comissão</th>
                {compara && <th className="px-3 py-2 text-right">vs ano anterior</th>}
              </tr>
            </thead>
            <tbody>
              {entidades.map((x, i) => {
                const v = variacao(x.premio, x.premio_ano_anterior);
                return (
                  <tr key={x.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2">
                      <NomeEntidade e={x} sp={sp} />
                    </td>
                    <td className="px-3 py-2 text-right">{num(x.propostas)}</td>
                    <td className="px-3 py-2 text-right">{reais(x.premio)}</td>
                    <td className="px-3 py-2 text-right">{pct(x.premio, r.premio)}</td>
                    <td className="px-3 py-2 text-right">{reais(x.comissao)}</td>
                    {compara && (
                      <td className="px-3 py-2 text-right">
                        {v ? <span className={`rounded-full px-2 py-0.5 text-xs ${v.cls}`}>{v.texto}</span> : <span className="text-xs text-gray-400">nova</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!todas && kpis.por_entidade.length > entidades.length && (
          <Link href={linkVerTodas(sp, "todas")} className="text-sm text-o2-blue underline">
            Ver todas as {kpis.por_entidade.length}
          </Link>
        )}
      </div>
    </Bloco>
  );
}
