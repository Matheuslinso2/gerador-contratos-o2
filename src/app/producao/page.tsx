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
import { IconChart } from "@/components/icons";
import BarrasMensais from "./BarrasMensais";
import { signOut } from "../actions";
import FiltrosProducao, { type Filtros, type OpcaoImob } from "./FiltrosProducao";
import { Abas } from "./_corp/comum";

export const dynamic = "force-dynamic";

// Painel Produção (Base Única — Fase 5). Dois universos que se conectam mas
// têm fontes diferentes (Matheus, 20/10/2026), cada um no seu bloco:
//  - COTAÇÕES (funil): tomadas de preço — análise → aprovação/recusa →
//    negociação → conversão ou negativação. Planilhas de análise até
//    jul/2026 e SPA do Bitrix a partir de ago/2026, com os MESMOS KPIs ("quando
//    a fonte muda, só a fonte muda"): entradas pelo mês em que a cotação
//    entrou; aprovação/recusa/negativação/conversão pelo mês em que aconteceu
//    (regra do painel /seguro-fianca). Bitrix lido de hora em hora pelo cron
//    /api/cron/base-unica-bitrix.
//  - APÓLICES (Corp): o que foi efetivado — propostas, prêmio líquido,
//    comissão —, pelo mês da data da proposta.
// O filtro de período e de imobiliária/grupo recorta os dois blocos; o de
// seguradora só as apólices. Números: supabase/schema_producao_painel.sql
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
  funil_meses_com_planilha: string[];
  atualizado_em: string | null;
};
type Fontes = { bitrix: string | null; corp: string | null };

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
const COR_ENTRADA = "#2E6FB7";
const DESFECHOS = [
  { chave: "conversao", rotulo: "Convertidas", cor: "#2E6FB7" },
  { chave: "perda", rotulo: "Negativadas", cor: "#F8540D" },
  { chave: "recusa", rotulo: "Recusadas", cor: "#01192e" },
] as const;
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
// Diferença de taxa em pontos percentuais (ex.: conversão 22% → 24% = +2 p.p.).
function variacaoPp(atual: number, anterior: number): Variacao {
  const d = (atual - anterior) * 100;
  return { texto: `${d >= 0 ? "+" : "−"}${Math.abs(d).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`, cls: d >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700" };
}

export default async function ProducaoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; p?: string; s?: string; g?: string; i?: string; atualizar?: string; todas?: string; todasc?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const mesAtual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const ultimoFechado = somarMeses(mesAtual, -1);
  let de = mesValido(sp.de) ?? somarMeses(ultimoFechado, -11);
  let ate = mesValido(sp.ate) ?? ultimoFechado;
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
  const [{ data: kpisData, error: erroKpis }, { data: opcoesData }, { data: imports }] = await Promise.all([
    supabase.rpc("kpis_producao", {
      p_de: de,
      p_ate: ate,
      p_produtos: filtros.produtos.length ? filtros.produtos : null,
      p_grupos: filtros.grupos.length ? filtros.grupos : null,
      p_imobs: filtros.imobs.length ? filtros.imobs : null,
      p_seguradoras: filtros.seguradoras.length ? filtros.seguradoras : null,
    }),
    supabase.rpc("opcoes_filtro_producao"),
    supabase.from("base_unica_importacoes").select("layout, importado_em").in("layout", ["bitrix_spa", "corp_relatorio_propostas"]),
  ]);
  const kpis = kpisData as Kpis | null;
  const opcoes = (opcoesData ?? []) as OpcaoImob[];
  const nomesSelecionados = opcoes.filter((o) => (o.tipo === "grupo" ? filtros.grupos : filtros.imobs).includes(o.id)).map((o) => o.nome);
  const ultima = (layout: string) =>
    (imports ?? [])
      .filter((r) => r.layout === layout)
      .map((r) => r.importado_em as string)
      .sort()
      .at(-1) ?? null;
  const fontes: Fontes = { bitrix: ultima("bitrix_spa"), corp: ultima("corp_relatorio_propostas") };

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader
            icon={<IconChart />}
            titulo="Power BI - O2 Seguros"
            subtitulo={`Cotações e apólices · ${rotuloMes(de)} a ${rotuloMes(ate)}${filtroImob ? ` · só ${nomesSelecionados.join(", ") || "imobiliárias selecionadas"}` : " · visão macro"}`}
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
        {kpis && filtroImob && (
          <p className="rounded-lg border border-o2-coral/30 bg-o2-coral/5 p-3 text-sm text-o2-navy">
            Os dois blocos abaixo mostram só as imobiliárias selecionadas (grupo = soma de todas as fichas do grupo). Automóvel não entra, porque não tem vínculo com
            imobiliária. Só conta o que já tem vínculo <b>confirmado</b> no cadastro.
          </p>
        )}
        {kpis && (
          <>
            <BlocoCotacoes kpis={kpis} filtros={filtros} filtroImob={filtroImob} fontes={fontes} todas={sp.todasc === "1"} sp={sp} />
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
      <div>
        <h2 className="text-lg font-bold text-o2-navy">{titulo}</h2>
        <p className="text-xs text-gray-500">{fonte}</p>
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
    </h3>
  );
}

function Grafico({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h4 className="mb-2 text-sm font-semibold text-o2-navy">{titulo}</h4>
      {children}
    </div>
  );
}

// Link que aplica o filtro de uma imobiliária/grupo mantendo período/produto/seguradora.
function linkEntidade(sp: Record<string, string | undefined>, id: string, tipo: string) {
  const q = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["atualizar", "todas", "todasc", "g", "i"].includes(k)) as [string, string][]);
  q.set(tipo === "grupo" ? "g" : "i", id);
  return `/producao?${q.toString()}`;
}
function linkVerTodas(sp: Record<string, string | undefined>, chave: "todas" | "todasc") {
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

function motivoSemFonte(m: string) {
  if (MESES_INEXISTENTES.has(m)) return "planilha não existe";
  if (MESES_SEM_STATUS_GERAL.has(m)) return "planilha só tem status por seguradora (pendente)";
  if (m < INICIO_FUNIL) return "2015–jun/2020 ainda não importado";
  return "sem planilha";
}

// ---------------------------------------------------------------- Cotações

function BlocoCotacoes({
  kpis,
  filtros,
  filtroImob,
  fontes,
  todas,
  sp,
}: {
  kpis: Kpis;
  filtros: Filtros;
  filtroImob: boolean;
  fontes: Fontes;
  todas: boolean;
  sp: Record<string, string | undefined>;
}) {
  const f = kpis.funil;
  const fa = kpis.funil_ano_anterior;
  const meses = listaMeses(kpis.de, kpis.ate);
  const compara = kpis.meses <= 24 && fa.entradas > 0;
  const porMes = new Map(kpis.funil_mensal.map((m) => [m.competencia, m.eventos]));
  const andamento = (f.etapa_atual_das_entradas["Em análise"] ?? 0) + (f.etapa_atual_das_entradas["Aprovado"] ?? 0);
  const comFonte = new Set([...kpis.funil_meses_com_planilha, ...meses.filter((m) => m >= INICIO_BITRIX_FIANCA)]);
  const semFonte = meses.filter((m) => !comFonte.has(m));
  const entidades = todas ? kpis.funil_por_entidade : kpis.funil_por_entidade.slice(0, 30);
  const soOutrosProdutos = filtros.produtos.length > 0 && !filtros.produtos.includes("fianca");

  return (
    <Bloco
      titulo="Cotações (funil)"
      cor="#F8540D"
      fonte={
        <>
          Tomadas de preço: análise → aprovação ou recusa → negociação → conversão ou negativação. Fontes: planilhas de análise (jul/2020 a jul/2026) e Bitrix (ago/2026
          em diante{fontes.bitrix ? `, lido em ${dataHora(fontes.bitrix)}` : ""}) — os indicadores são os mesmos nas duas fontes. Por enquanto só Seguro Fiança; Ramos
          Elementares, Capitalização e Automóvel entram em seguida.
        </>
      }
    >
      {soOutrosProdutos ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          As cotações dos produtos selecionados ainda não foram ligadas a este painel (por enquanto só Seguro Fiança).
        </p>
      ) : filtroImob && f.entradas === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          Nenhuma cotação ligada a essa seleção no período. O nome da imobiliária na planilha (ou a empresa do card no Bitrix) só conta depois que o vínculo é confirmado em{" "}
          <Link href="/admin/imobiliarias" className="text-o2-blue underline">
            Imobiliárias cadastradas
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Cartao
              rotulo="Cotações recebidas"
              valor={num(f.entradas)}
              linhas={[`${num(andamento)} ainda em andamento`]}
              variacaoAno={compara ? variacao(f.entradas, fa.entradas) : null}
              legenda="Cotações (análises) que entraram no período — na planilha, a linha do mês em que a análise foi recebida (a herança para o mês seguinte não conta de novo); no Bitrix, o card criado no mês."
            />
            <Cartao
              rotulo="Aprovadas"
              valor={num(f.aprovacoes)}
              linhas={[`aprovação ${pct(f.aprovacoes, f.aprovacoes + f.recusas)}`]}
              variacaoAno={compara ? variacao(f.aprovacoes, fa.aprovacoes) : null}
              legenda="Aprovadas pela seguradora no período (pelo mês da aprovação), incluindo as que depois converteram ou negativaram. Aprovação = aprovadas ÷ (aprovadas + recusadas)."
            />
            <Cartao
              rotulo="Recusadas"
              valor={num(f.recusas)}
              linhas={[`${pct(f.recusas, f.aprovacoes + f.recusas)} das decididas`]}
              variacaoAno={compara ? variacao(f.recusas, fa.recusas) : null}
              legenda="Recusadas pela seguradora no período (pelo mês da recusa). RECUSA ENVIADA é a mesma recusa, já comunicada ao cliente."
            />
            <Cartao
              rotulo="Negativadas"
              valor={num(f.perdas)}
              linhas={[`${pct(f.perdas, f.aprovacoes)} das aprovadas`]}
              variacaoAno={compara ? variacao(f.perdas, fa.perdas) : null}
              legenda="Aprovadas em que o cliente não fechou (NEGATIVADO/DESISTÊNCIA; no Bitrix, PERDIDO em Negociação e Contrato), pelo mês em que aconteceu."
            />
            <Cartao
              rotulo="Convertidas"
              valor={num(f.conversoes)}
              linhas={[`conversão ${pct(f.conversoes, f.entradas)} das recebidas`]}
              variacaoAno={compara ? variacaoPp(f.conversoes / Math.max(1, f.entradas), fa.conversoes / Math.max(1, fa.entradas)) : null}
              legenda="Cotações convertidas (contrato fechado) no período, pelo mês da conversão. Conversão = convertidas ÷ cotações recebidas no mesmo período; a variação é em pontos percentuais."
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Grafico titulo="Cotações recebidas por mês">
              <BarrasMensais pontos={meses.map((m) => ({ mes: m, valores: { e: porMes.get(m)?.entrada ?? 0 } }))} series={[{ chave: "e", rotulo: "Recebidas", cor: COR_ENTRADA }]} altura={170} />
            </Grafico>
            <Grafico titulo="Desfechos por mês">
              <BarrasMensais
                pontos={meses.map((m) => ({ mes: m, valores: Object.fromEntries(DESFECHOS.map((d) => [d.chave, porMes.get(m)?.[d.chave] ?? 0])) }))}
                series={DESFECHOS.map((d) => ({ chave: d.chave, rotulo: d.rotulo, cor: d.cor }))}
                altura={170}
              />
            </Grafico>
          </div>
          {semFonte.length > 0 && (
            <p className="text-xs text-gray-500">
              Meses sem fonte de cotação neste período (aparecem vazios, não são zero):{" "}
              {semFonte
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
              .
            </p>
          )}

          <div className="space-y-2">
            <Titulo
              legenda={
                <>
                  Cotações de cada imobiliária/grupo no período, com a mesma regra dos cartões acima. Clique no nome para ver o painel inteiro só daquela imobiliária. Só
                  aparece quem já tem vínculo confirmado no cadastro.
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
                    <th className="px-3 py-2 text-right">Aprovadas</th>
                    <th className="px-3 py-2 text-right">Recusadas</th>
                    <th className="px-3 py-2 text-right">Negativadas</th>
                    <th className="px-3 py-2 text-right">Convertidas</th>
                    <th className="px-3 py-2 text-right">Conversão</th>
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
                      <td className="px-3 py-2 text-right">{num(x.aprovacoes)}</td>
                      <td className="px-3 py-2 text-right">{num(x.recusas)}</td>
                      <td className="px-3 py-2 text-right">{num(x.perdas)}</td>
                      <td className="px-3 py-2 text-right">{num(x.conversoes)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{pct(x.conversoes, x.entradas)}</td>
                    </tr>
                  ))}
                  {!entidades.length && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
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
            {!filtroImob && f.entradas > 0 && (
              <p className="text-xs text-gray-500">
                {pct(f.identificados, f.entradas, 0)} das cotações recebidas no período já têm a imobiliária confirmada no cadastro; o restante ainda é sugestão por nome e
                não entra nesta tabela nem no filtro por imobiliária.
              </p>
            )}
          </div>
        </>
      )}
    </Bloco>
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
          O que foi efetivado de fato: propostas emitidas, prêmio líquido e comissão, pelo mês da data da proposta. Fonte: Relatório de Propostas do Corp
          {fontes.corp ? `, importado em ${dataHora(fontes.corp)}` : ""} (2015 em diante, conferido com os totais do próprio Corp). Entram todas as propostas que o Corp
          registra (novas, renovações e endossos). O filtro de seguradora vale só para este bloco.
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
        <p className="text-xs text-gray-500">O mês corrente ({rotuloMes(mesAtual)}) está incompleto: o Corp foi importado em {dataHora(fontes.corp)}.</p>
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
