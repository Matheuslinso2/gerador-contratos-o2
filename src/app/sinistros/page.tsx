import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import InfoLegenda from "@/components/InfoLegenda";
import SubmitButton from "@/components/SubmitButton";
import { IconShield } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { atalhosPeriodo, filtrosDashboard, lista, mesesNoPeriodo, resolverPeriodo } from "@/lib/sinistros/periodo";
import { ordenarProdutos, rotuloProduto, rotuloTipoSinistro } from "@/lib/sinistros/produtos";
import { signOut } from "../actions";
import { Aviso } from "./ui";
import Abas from "./Abas";
import Filtros, { type OpcaoGrupo } from "./dashboard/Filtros";
import BarrasMensais from "./dashboard/BarrasMensais";
import { atualizarBaseSinistros } from "./dashboard/actions";

export const dynamic = "force-dynamic";

// Dashboard de Sinistros — tela de entrada do módulo (planejamento v2,
// entregaveis/modulo-sinistro/Modulo Sinistros - Planejamento v2 ...pdf).
// Uma barra de filtros (período flexível, produto, seguradora,
// imobiliária/grupo, tipo, situação) recorta TODOS os números. Fase B
// (20/10/2026): todos os ramos do Corp; sem filtro = todos os produtos. Cálculo em
// kpis_sinistros_dashboard() (supabase/schema_sinistros_dashboard.sql).

type Bloco = {
  meses: number;
  avisados: number;
  avisados_ocupado: number;
  avisados_chaves: number;
  avisado_valor: number;
  encerrados_indenizados: number;
  encerrados_sem_indenizacao: number;
  indenizado: number;
  ticket_medio: number;
  em_aberto_fim: number;
  em_aberto_90: number;
  mediana_dias_ate_encerrar: number | null;
  vigentes_media: number | null;
  vigentes_fim: number | null;
  premio_ganho: number | null;
  contratos_24m: number;
  recorrentes_24m: number;
};
type Mes = { mes: string; avisados: number; indenizados: number; sem_indenizacao: number; valor_indenizado: number; vigentes: number; premio_ganho: number };
type LinhaSeg = { seguradora: string; avisados: number; indenizados: number; sem_indenizacao: number; indenizado: number; em_aberto: number; vigentes_media: number | null; premio_ganho: number | null };
type LinhaRank = { chave: string; nome: string; tipo: "grupo" | "imobiliaria" | "sem_vinculo"; avisados: number; indenizados: number; indenizado: number; em_aberto: number; vigentes_media: number | null; premio_ganho: number | null };
type LinhaProd = { produto: string; avisados: number; indenizados: number; indenizado: number; em_aberto: number; vigentes_media: number | null; premio_ganho: number | null };
type SinistroLista = { segurado: string | null; seguradora: string | null; numero_sinistro: string | null; tipo: string | null; produto: string | null; situacao: string; dt_aviso: string | null; dt_encerramento: string | null; vl_avisado: number | null; vl_indenizado: number | null };
type Dashboard = {
  periodo: { inicio: string; fim: string; fim_dia: string; meses: number; parcial: boolean };
  base_atualizada_em: string | null;
  grupo: { chave: string; nome: string; tipo: string } | null;
  resumo: Bloco;
  anterior: Bloco;
  ano_anterior: Bloco;
  carteira: Bloco | null;
  mensal: Mes[];
  por_seguradora: LinhaSeg[];
  por_tipo: { tipo: string; avisados: number; indenizado: number }[];
  por_produto: LinhaProd[];
  ranking: LinhaRank[];
  sinistros: SinistroLista[];
  processo: { enviados: number; no_prazo: number; com_pendencia: number; abertos_na_seguradora: number; mediana_dias_ate_abrir: number | null };
  opcoes_seguradoras: string[];
  opcoes_produtos: string[];
};

const AZUL = "#2E6FB7";
const LARANJA = "#F8540D";
const BASE_MINIMA = 20; // P6

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR");
const pct = (v: number | null) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const dinheiro = (v: number | null | undefined) => {
  const x = v ?? 0;
  if (x >= 1_000_000) return `R$ ${(x / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (x >= 1_000) return `R$ ${Math.round(x / 1000).toLocaleString("pt-BR")} mil`;
  return formatarReais(x);
};
const razao = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? a / b : null);

// Taxas de um bloco (P3, P4).
function taxas(b: Bloco) {
  const freq = razao(b.avisados, b.vigentes_media);
  const baseOk = (b.vigentes_media ?? 0) >= BASE_MINIMA;
  return {
    baseOk,
    frequencia: baseOk ? freq : null,
    frequenciaAnual: baseOk && freq != null ? (freq * 12) / Math.max(1, b.meses) : null,
    sinistralidade: baseOk ? razao(b.indenizado, b.premio_ganho) : null,
    desfecho: razao(b.encerrados_indenizados, b.encerrados_indenizados + b.encerrados_sem_indenizacao),
    recorrencia: razao(b.recorrentes_24m, b.contratos_24m),
  };
}

// Comparação (P5): texto e se a variação é boa/ruim para o KPI.
function variacao(atual: number | null, antes: number | null, subirEhRuim: boolean | null, emPontos = false) {
  if (atual == null || antes == null) return null;
  if (emPontos) {
    const d = (atual - antes) * 100;
    if (Math.abs(d) < 0.05) return { texto: "=", tom: "neutro" as const };
    return { texto: `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`, tom: subirEhRuim == null ? ("neutro" as const) : (d > 0) === subirEhRuim ? ("ruim" as const) : ("bom" as const) };
  }
  if (antes === 0) return atual === 0 ? { texto: "=", tom: "neutro" as const } : null;
  const d = (atual - antes) / antes;
  if (Math.abs(d) < 0.005) return { texto: "=", tom: "neutro" as const };
  return { texto: `${d > 0 ? "▲" : "▼"} ${Math.abs(d * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`, tom: subirEhRuim == null ? ("neutro" as const) : (d > 0) === subirEhRuim ? ("ruim" as const) : ("bom" as const) };
}
const COR_TOM = { bom: "text-green-700", ruim: "text-red-700", neutro: "text-gray-500" };

export default async function DashboardSinistrosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Dashboard da imobiliária é a Fase D; até lá ela entra direto nos sinistros dela.
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/sinistros/gestao");

  const um = (k: string) => (Array.isArray(params[k]) ? (params[k] as string[])[0] : (params[k] as string | undefined));
  const periodo = resolverPeriodo({ periodo: um("periodo"), de: um("de"), ate: um("ate") });
  const produtos = lista(params.prod);
  const seguradoras = lista(params.seg);
  const grupo = um("imob") || null;
  const tipos = lista(params.tipo);
  const situacoes = lista(params.sit);

  const [{ data, error }, { data: grupos }] = await Promise.all([
    supabase.rpc("kpis_sinistros_dashboard", {
      p_inicio: periodo.inicio,
      p_fim: periodo.fim,
      p_seguradoras: seguradoras.length ? seguradoras : null,
      p_grupo: grupo,
      p_tipos: tipos.length ? tipos : null,
      p_situacoes: situacoes.length ? situacoes : null,
      p_produtos: produtos.length ? produtos : null,
    }),
    supabase.rpc("opcoes_grupos_sinistros"),
  ]);
  const d = data as Dashboard | null;
  const filtros = filtrosDashboard(params);
  const erro = um("erro");

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-5 p-8">
        <PageHeader icon={<IconShield />} titulo="Sinistros" subtitulo="Dashboard geral · equipe O2" />
        <Abas atual="dashboard" interno filtros={filtros} />
        <Filtros
          atalhos={atalhosPeriodo().map(({ chave, rotulo }) => ({ chave, rotulo }))}
          periodoAtual={periodo}
          produtos={ordenarProdutos(d?.opcoes_produtos ?? [])}
          seguradoras={(d?.opcoes_seguradoras ?? []).filter((s) => !/PREMIA/i.test(s))}
          grupos={(grupos ?? []) as OpcaoGrupo[]}
        />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {error && <Aviso tipo="erro">Não foi possível calcular o dashboard: {error.message}</Aviso>}
        {d && <Conteudo d={d} periodoRotulo={periodo.rotulo} filtros={filtros} meses={mesesNoPeriodo(periodo)} produtos={produtos} />}
      </main>
    </>
  );
}

function Cartao({
  rotulo,
  valor,
  linhas,
  legenda,
  comparacoes,
  carteira,
  destaque,
}: {
  rotulo: string;
  valor: string;
  linhas?: string[];
  legenda: string;
  comparacoes?: ({ texto: string; tom: "bom" | "ruim" | "neutro"; contra: string } | null | false)[];
  carteira?: string | null;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${destaque ? "border-o2-coral" : "border-gray-200"}`}>
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {rotulo}
        <InfoLegenda titulo={rotulo}>{legenda}</InfoLegenda>
      </p>
      <p className="mt-1 text-2xl font-bold text-o2-navy">{valor}</p>
      {linhas?.map((l) => (
        <p key={l} className="text-xs text-gray-500">
          {l}
        </p>
      ))}
      {comparacoes?.some(Boolean) && (
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs">
          {comparacoes.map(
            (c) =>
              c && (
                <span key={c.contra} className={COR_TOM[c.tom]}>
                  {c.texto} <span className="text-gray-400">{c.contra}</span>
                </span>
              )
          )}
        </p>
      )}
      {carteira && <p className="mt-1 text-xs text-gray-400">carteira O2: {carteira}</p>}
    </div>
  );
}

function Conteudo({ d, periodoRotulo, filtros, meses, produtos }: { d: Dashboard; periodoRotulo: string; filtros: string; meses: number; produtos: string[] }) {
  const r = d.resumo;
  const t = taxas(r);
  const tAnt = taxas(d.anterior);
  const tAno = taxas(d.ano_anterior);
  const tCart = d.carteira ? taxas(d.carteira) : null;
  // Com 12+ meses, o "mesmo período do ano anterior" coincide (ou se sobrepõe)
  // com o período anterior: fica só uma comparação.
  const usarAno = meses < 12;
  const ant = meses === 12 ? "vs 12 meses anteriores" : "vs período anterior";
  const ano = "vs ano anterior";
  const q = new URLSearchParams(filtros);
  const comImob = (chave: string) => {
    const n = new URLSearchParams(q);
    n.set("imob", chave);
    return `/sinistros?${n.toString()}`;
  };
  const comProduto = (chave: string) => {
    const n = new URLSearchParams(q);
    n.delete("prod");
    n.delete("tipo");
    n.set("prod", chave);
    return `/sinistros?${n.toString()}`;
  };
  const rotuloProdutos = produtos.length === 0 ? "Todos os produtos" : produtos.map(rotuloProduto).join(", ");
  const temFianca = r.avisados_ocupado + r.avisados_chaves > 0;
  const freqCarteiraAnual = t.frequenciaAnual;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-gray-600">
          <b className="text-o2-navy">{d.grupo ? d.grupo.nome : "Carteira O2"}</b> · {rotuloProdutos} · {periodoRotulo} ({meses} {meses === 1 ? "mês" : "meses"}
          {d.periodo.parcial ? `, mês atual até ${formatarData(d.periodo.fim_dia)}` : ""})
        </p>
        <form action={atualizarBaseSinistros} className="flex items-center gap-2 text-xs text-gray-500">
          <input type="hidden" name="volta" value={filtros} />
          <span>base atualizada {d.base_atualizada_em ? new Date(d.base_atualizada_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—"}</span>
          <InfoLegenda titulo="Base do dashboard" alinhar="direita">
            O histórico vem das exportações do Corp (importadas com scripts/sinistros/importar-corp.mjs) e a carteira, da produção do Corp. A base mensal é refeita
            toda madrugada, a cada importação e por este botão (leva uns 30 segundos).
          </InfoLegenda>
          <SubmitButton className="rounded border border-gray-300 px-2 py-1 text-xs text-o2-navy hover:bg-gray-50" textoCarregando="Atualizando base…">
            Atualizar base
          </SubmitButton>
        </form>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          rotulo="Sinistros avisados"
          valor={num(r.avisados)}
          linhas={[
            ...(temFianca ? [`Fiança: ${r.avisados_ocupado} imóvel ocupado · ${r.avisados_chaves} entrega de chaves`] : []),
            `${dinheiro(r.avisado_valor)} avisados`,
          ]}
          comparacoes={[
            variacao(r.avisados, d.anterior.avisados, true) && { ...variacao(r.avisados, d.anterior.avisados, true)!, contra: ant },
            usarAno && variacao(r.avisados, d.ano_anterior.avisados, true) && { ...variacao(r.avisados, d.ano_anterior.avisados, true)!, contra: ano },
          ]}
          carteira={d.carteira ? num(d.carteira.avisados) : null}
          legenda="Sinistros com aviso no período (data de aviso no Corp; sem ela, a da ocorrência). Cada sinistro conta no mês do aviso."
        />
        <Cartao
          rotulo="Em aberto"
          valor={num(r.em_aberto_fim)}
          linhas={[`em ${formatarData(d.periodo.fim_dia)} · ${r.em_aberto_90} há mais de 90 dias`]}
          comparacoes={[variacao(r.em_aberto_fim, d.anterior.em_aberto_fim, true) && { ...variacao(r.em_aberto_fim, d.anterior.em_aberto_fim, true)!, contra: ant }]}
          carteira={d.carteira ? num(d.carteira.em_aberto_fim) : null}
          legenda="Foto no último dia do período: sinistros avisados até essa data que ainda não tinham sido encerrados."
        />
        <Cartao
          rotulo="Indenizado"
          valor={dinheiro(r.indenizado)}
          linhas={[`${r.encerrados_indenizados} sinistros · ticket ${dinheiro(r.ticket_medio)}`]}
          comparacoes={[
            variacao(r.indenizado, d.anterior.indenizado, null) && { ...variacao(r.indenizado, d.anterior.indenizado, null)!, contra: ant },
            usarAno && variacao(r.indenizado, d.ano_anterior.indenizado, null) && { ...variacao(r.indenizado, d.ano_anterior.indenizado, null)!, contra: ano },
          ]}
          carteira={d.carteira ? dinheiro(d.carteira.indenizado) : null}
          legenda="Indenização dos sinistros encerrados como indenizados no período. O Corp só exporta o total de cada sinistro: o valor entra no mês do encerramento e os ainda abertos não somam (fica subestimado nos meses recentes)."
        />
        <Cartao
          rotulo="Sinistralidade"
          valor={t.baseOk ? pct(t.sinistralidade) : "base pequena"}
          linhas={[`sobre ${dinheiro(r.premio_ganho)} de prêmio ganho`]}
          destaque
          comparacoes={[
            variacao(t.sinistralidade, tAnt.sinistralidade, true, true) && { ...variacao(t.sinistralidade, tAnt.sinistralidade, true, true)!, contra: ant },
            usarAno && variacao(t.sinistralidade, tAno.sinistralidade, true, true) && { ...variacao(t.sinistralidade, tAno.sinistralidade, true, true)!, contra: ano },
          ]}
          carteira={tCart ? pct(tCart.sinistralidade) : null}
          legenda="Indenizado no período ÷ prêmio ganho no período (parte do prêmio de cada apólice correspondente aos meses do período). Vale igual para 1 mês ou 1 semestre."
        />
        <Cartao
          rotulo="Frequência"
          valor={t.baseOk ? pct(t.frequencia) : "base pequena"}
          linhas={[t.baseOk ? `${pct(t.frequenciaAnual)} ao ano · ${num(r.vigentes_media)} apólices em média` : `${num(r.vigentes_media)} apólices em média`]}
          comparacoes={[
            variacao(t.frequenciaAnual, tAnt.frequenciaAnual, true, true) && { ...variacao(t.frequenciaAnual, tAnt.frequenciaAnual, true, true)!, contra: ant },
            usarAno && variacao(t.frequenciaAnual, tAno.frequenciaAnual, true, true) && { ...variacao(t.frequenciaAnual, tAno.frequenciaAnual, true, true)!, contra: ano },
          ]}
          carteira={tCart ? `${pct(tCart.frequenciaAnual)} ao ano` : null}
          legenda="Avisados no período ÷ média de apólices vigentes nos meses do período. A anualizada (× 12 ÷ meses) permite comparar períodos de tamanhos diferentes."
        />
        <Cartao
          rotulo="Desfecho"
          valor={pct(t.desfecho)}
          linhas={[`indenizados de ${r.encerrados_indenizados + r.encerrados_sem_indenizacao} encerrados`, `${r.encerrados_sem_indenizacao} sem indenização`]}
          carteira={tCart ? pct(tCart.desfecho) : null}
          legenda="Dos encerrados no período, quantos foram indenizados. 'Sem indenização' inclui o locatário que quitou ou fez acordo — a maior parte, pelo histórico."
        />
        <Cartao
          rotulo="Tempo até encerrar"
          valor={r.mediana_dias_ate_encerrar != null ? `${Math.round(r.mediana_dias_ate_encerrar)} dias` : "—"}
          linhas={["mediana, do aviso ao encerramento"]}
          comparacoes={[
            variacao(r.mediana_dias_ate_encerrar, d.anterior.mediana_dias_ate_encerrar, true) && {
              ...variacao(r.mediana_dias_ate_encerrar, d.anterior.mediana_dias_ate_encerrar, true)!,
              contra: ant,
            },
          ]}
          carteira={d.carteira?.mediana_dias_ate_encerrar != null ? `${Math.round(d.carteira.mediana_dias_ate_encerrar)} dias` : null}
          legenda="Mediana de dias entre o aviso e o encerramento, nos sinistros encerrados no período."
        />
        <Cartao
          rotulo="Recorrência"
          valor={pct(t.recorrencia)}
          linhas={[`${r.recorrentes_24m} de ${r.contratos_24m} contratos com 2+ sinistros`]}
          carteira={tCart ? pct(tCart.recorrencia) : null}
          legenda="Nos 24 meses até o fim do período: contratos (Nosso Nº do Corp) com 2 ou mais sinistros ÷ contratos com algum sinistro."
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-o2-navy">Avisados por mês</h2>
          <BarrasMensais pontos={d.mensal.map((m) => ({ mes: m.mes, valores: { a: m.avisados } }))} series={[{ chave: "a", rotulo: "Avisados", cor: AZUL }]} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-o2-navy">Encerrados por mês</h2>
          <BarrasMensais
            pontos={d.mensal.map((m) => ({ mes: m.mes, valores: { ind: m.indenizados, sem: m.sem_indenizacao } }))}
            series={[
              { chave: "ind", rotulo: "Indenizados", cor: AZUL },
              { chave: "sem", rotulo: "Sem indenização", cor: LARANJA },
            ]}
          />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-o2-navy">Indenizado por mês do encerramento</h2>
          <BarrasMensais pontos={d.mensal.map((m) => ({ mes: m.mes, valores: { v: m.valor_indenizado } }))} series={[{ chave: "v", rotulo: "Indenizado", cor: AZUL }]} formato="reais" />
        </div>
      </section>

      {produtos.length !== 1 && d.por_produto.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
            Por produto
            <InfoLegenda titulo="Por produto">
              Clique num produto para ver o dashboard só dele. Todos os ramos vêm das exportações de sinistro do Corp; a carteira (apólices e prêmio ganho), da
              produção do Corp. Na Capitalização todo resgate registrado no Corp conta como sinistro, e o valor é o do título resgatado — use o Tipo para separar
              execução, acordo e resgate simples.
            </InfoLegenda>
          </h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-o2-navy text-left text-xs text-white">
                <tr>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Apólices (média)</th>
                  <th className="px-3 py-2 text-right">Avisados</th>
                  <th className="px-3 py-2 text-right">Freq. ao ano</th>
                  <th className="px-3 py-2 text-right">Indenizado</th>
                  <th className="px-3 py-2 text-right">Sinistralidade</th>
                  <th className="px-3 py-2 text-right">Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {d.por_produto.map((x) => {
                  const ok = (x.vigentes_media ?? 0) >= BASE_MINIMA;
                  return (
                    <tr key={x.produto} className="border-t border-gray-100 hover:bg-blue-50">
                      <td className="px-3 py-2">
                        <Link href={comProduto(x.produto)} className="font-medium text-o2-navy hover:underline">
                          {rotuloProduto(x.produto)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">{num(x.vigentes_media)}</td>
                      <td className="px-3 py-2 text-right">{x.avisados}</td>
                      <td className="px-3 py-2 text-right">
                        {ok ? pct(((x.avisados / (x.vigentes_media ?? 1)) * 12) / meses) : <span className="text-xs text-gray-400">base pequena</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{x.indenizado ? dinheiro(x.indenizado) : "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">{ok && x.premio_ganho ? pct(x.indenizado / x.premio_ganho) : "—"}</td>
                      <td className="px-3 py-2 text-right">{x.em_aberto || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Por seguradora</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-o2-navy text-left text-xs text-white">
                <tr>
                  <th className="px-3 py-2">Seguradora</th>
                  <th className="px-3 py-2 text-right">Apólices (média)</th>
                  <th className="px-3 py-2 text-right">Avisados</th>
                  <th className="px-3 py-2 text-right">Freq. ao ano</th>
                  <th className="px-3 py-2 text-right">Indenizado</th>
                  <th className="px-3 py-2 text-right">Sinistralidade</th>
                  <th className="px-3 py-2 text-right">Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {d.por_seguradora.map((s) => {
                  const ok = (s.vigentes_media ?? 0) >= BASE_MINIMA;
                  return (
                    <tr key={s.seguradora} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-o2-navy">{s.seguradora}</td>
                      <td className="px-3 py-2 text-right">{num(s.vigentes_media)}</td>
                      <td className="px-3 py-2 text-right">{s.avisados}</td>
                      <td className="px-3 py-2 text-right">{ok ? pct(((s.avisados / (s.vigentes_media ?? 1)) * 12) / meses) : "—"}</td>
                      <td className="px-3 py-2 text-right">{dinheiro(s.indenizado)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{ok && s.premio_ganho ? pct(s.indenizado / s.premio_ganho) : "—"}</td>
                      <td className="px-3 py-2 text-right">{s.em_aberto}</td>
                    </tr>
                  );
                })}
                {d.por_seguradora.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-gray-500">
                      Nenhum sinistro no recorte.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Por tipo de sinistro</h2>
          <div className="rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {d.por_tipo.map((x) => (
                  <tr key={x.tipo} className="border-t border-gray-100 first:border-t-0">
                    <td className="px-3 py-2 text-o2-navy">{rotuloTipoSinistro(x.tipo)}</td>
                    <td className="px-3 py-2 text-right">{x.avisados} avisados</td>
                    <td className="px-3 py-2 text-right">{dinheiro(x.indenizado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            O tipo vem da descrição do Corp: na Fiança, imóvel ocupado ou entrega de chaves (antes de 2024 quase sempre em branco); na Capitalização, o motivo do
            resgate. Os demais produtos não têm tipo no Corp.
          </p>
        </div>
      </section>

      {d.grupo ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
              Sinistros de {d.grupo.nome} no período ({d.sinistros.length})
            </h2>
            <Link href={`/sinistros/gestao?${filtros}`} className="text-sm text-o2-blue underline">
              Ver na gestão
            </Link>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-o2-navy text-left text-xs text-white">
                <tr>
                  <th className="px-3 py-2">Segurado</th>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2">Seguradora</th>
                  <th className="px-3 py-2">Nº sinistro</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Aviso</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2 text-right">Indenizado</th>
                </tr>
              </thead>
              <tbody>
                {d.sinistros.slice(0, 200).map((s, i) => (
                  <tr key={`${s.numero_sinistro}-${i}`} className="border-t border-gray-100">
                    <td className="px-3 py-2">{s.segurado ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{rotuloProduto(s.produto)}</td>
                    <td className="px-3 py-2 text-xs">{s.seguradora}</td>
                    <td className="px-3 py-2 text-xs">{s.numero_sinistro ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{s.tipo ? rotuloTipoSinistro(s.tipo) : "—"}</td>
                    <td className="px-3 py-2 text-xs">{formatarData(s.dt_aviso)}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.situacao.toLowerCase()}
                      {s.dt_encerramento ? ` em ${formatarData(s.dt_encerramento)}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">{s.vl_indenizado ? formatarReais(s.vl_indenizado) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
            Imobiliárias / grupos no período
            <InfoLegenda titulo="Ranking">
              Clique numa linha para ver o dashboard só daquela imobiliária (ou grupo). Grupo soma todas as imobiliárias dele. &quot;Sem vínculo&quot; = produtor do Corp
              ainda não ligado a uma imobiliária do cadastro. Risco: atenção = frequência acima de 1,5× a da carteira ou sinistralidade acima de 35%; acompanhar =
              frequência acima da carteira ou sinistralidade de 20% a 35%. Taxas e risco só com {BASE_MINIMA}+ apólices.
            </InfoLegenda>
          </h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-o2-navy text-left text-xs text-white">
                <tr>
                  <th className="px-3 py-2">Imobiliária / grupo</th>
                  <th className="px-3 py-2 text-right">Apólices (média)</th>
                  <th className="px-3 py-2 text-right">Avisados</th>
                  <th className="px-3 py-2 text-right">Freq. ao ano</th>
                  <th className="px-3 py-2 text-right">Indenizado</th>
                  <th className="px-3 py-2 text-right">Sinistralidade</th>
                  <th className="px-3 py-2 text-right">Em aberto</th>
                  <th className="px-3 py-2">Risco</th>
                </tr>
              </thead>
              <tbody>
                {d.ranking.slice(0, 40).map((l) => {
                  const ok = (l.vigentes_media ?? 0) >= BASE_MINIMA;
                  const fa = ok ? ((l.avisados / (l.vigentes_media ?? 1)) * 12) / meses : null;
                  const sin = ok && l.premio_ganho ? l.indenizado / l.premio_ganho : null;
                  const risco =
                    !ok || fa == null || freqCarteiraAnual == null
                      ? null
                      : fa > 1.5 * freqCarteiraAnual || (sin ?? 0) > 0.35
                        ? { r: "atenção", c: "bg-red-100 text-red-700" }
                        : fa > freqCarteiraAnual || (sin ?? 0) >= 0.2
                          ? { r: "acompanhar", c: "bg-orange-100 text-orange-800" }
                          : { r: "ok", c: "bg-green-100 text-green-800" };
                  return (
                    <tr key={l.chave} className="border-t border-gray-100 hover:bg-blue-50">
                      <td className="px-3 py-2">
                        <Link href={comImob(l.chave)} className="font-medium text-o2-navy hover:underline">
                          {l.nome}
                        </Link>
                        {l.tipo === "grupo" && <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">grupo</span>}
                        {l.tipo === "sem_vinculo" && <span className="ml-1 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">sem vínculo</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{num(l.vigentes_media)}</td>
                      <td className="px-3 py-2 text-right">{l.avisados}</td>
                      <td className="px-3 py-2 text-right">{ok ? pct(fa) : <span className="text-xs text-gray-400">base pequena</span>}</td>
                      <td className="px-3 py-2 text-right">{l.indenizado ? dinheiro(l.indenizado) : "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">{sin != null ? pct(sin) : "—"}</td>
                      <td className="px-3 py-2 text-right">{l.em_aberto || "—"}</td>
                      <td className="px-3 py-2">{risco ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${risco.c}`}>{risco.r}</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d.ranking.length > 40 && <p className="text-xs text-gray-500">Mostrando 40 de {d.ranking.length}. Use o filtro de imobiliária para ver qualquer uma.</p>}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
          Processo — avisos pelo Workspace
          <InfoLegenda titulo="Processo">Sinistros enviados pelo módulo novo no período (no ar desde 19/10/2026). Ficam significativos conforme as imobiliárias passarem a avisar por aqui.</InfoLegenda>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cartao rotulo="Enviados" valor={num(d.processo.enviados)} linhas={[`${d.processo.abertos_na_seguradora} já abertos na seguradora`]} legenda="Avisos enviados pelo Workspace (sem rascunhos e cancelados)." />
          <Cartao rotulo="No prazo" valor={pct(razao(d.processo.no_prazo, d.processo.enviados))} legenda="Avisos dentro do prazo calculado pelo sistema (10 dias do 2º vencimento / 15 da entrega das chaves)." />
          <Cartao rotulo="Com pendência" valor={pct(razao(d.processo.com_pendencia, d.processo.enviados))} legenda="Avisos que a O2 precisou devolver à imobiliária ao menos uma vez." />
          <Cartao
            rotulo="Aviso → abertura"
            valor={d.processo.mediana_dias_ate_abrir != null ? `${Math.round(d.processo.mediana_dias_ate_abrir)} dias` : "—"}
            legenda="Mediana de dias entre o envio e o número do sinistro na seguradora."
          />
        </div>
      </section>
    </div>
  );
}
