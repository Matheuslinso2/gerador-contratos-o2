import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import SeletorCompetencia from "./SeletorCompetencia";
import AtualizarAgora from "./AtualizarAgora";
import ImobiliariasTabela from "./ImobiliariasTabela";
import DetalheImobiliariaTabela from "./DetalheImobiliariaTabela";
import { AbasProvider, AbaSlot, type DefinicaoAba } from "./AbasPainel";
import styles from "./seguro-fianca.module.css";
import ExportarQuadro, { BotaoExportarPainelPdf } from "@/components/ExportarQuadro";
import {
  CATEGORIA_ANALISE,
  CATEGORIA_NEGOCIACAO,
  ENTITY_TYPE_ID,
  ETAPAS,
  NOME_NAO_ADMINISTRADA,
  SEGURADORAS,
  buscarAnaliseGerencialAoVivo,
  montarAnaliseGerencial,
  normalizarQuadroDiario,
  type AnaliseGerencial,
  type EstatisticaTempo as EstatisticaTempoTipo,
  type QuadroDiario,
} from "@/lib/bitrix/seguroFianca";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

// Usado na coluna "Tendência" da tabela de imobiliárias (comparação com o
// mês anterior, pedido da Patricia) -- competência é sempre "YYYY-MM".
function competenciaAnterior(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const data = new Date(ano, mes - 2, 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(v: number | null): string {
  // Retratos salvos antes da correção de 31/08/2026 podem ter null aqui
  // (era NaN em memória, virou null ao passar por JSON.stringify pro
  // Supabase) -- sem essa proteção a página quebra inteira ao reabrir esse
  // mês antigo.
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}
// A etapa de encerramento de "Análise e Cotação" se chama "PERDIDO" no
// Bitrix (mesmo rótulo genérico usado nos dois funis) -- só no quadro
// "Tempo em aberto por etapa" isso precisa aparecer como "Recusado", pra
// bater com o termo usado no resto do painel pra esse funil. Não mexe em
// "Negociação e Contrato | PERDIDO", que usa "Perdido" mesmo de propósito.
function rotuloEtapaTempoAberto(chave: string): string {
  return chave === "Análise e Cotação | PERDIDO" ? "Análise e Cotação | Recusado" : chave;
}

// Tendência simples (mesma lógica da coluna "Tend." de ImobiliariasTabela,
// usada aqui pro comparativo de Total de Análises do Bloco 1).
function tendenciaSimples(atual: number, anterior: number): { pct: number; direcao: "up" | "down" | "flat" } {
  if (atual === anterior) return { pct: 0, direcao: "flat" };
  if (anterior === 0) return { pct: 100, direcao: "up" };
  const variacao = ((atual - anterior) / anterior) * 100;
  return { pct: Math.abs(variacao), direcao: variacao >= 0 ? "up" : "down" };
}

function fmtTendencia(atual: number, anterior: number): string {
  const t = tendenciaSimples(atual, anterior);
  const seta = t.direcao === "flat" ? "—" : t.direcao === "up" ? "▲" : "▼";
  const pct = t.direcao === "flat" ? "" : ` ${t.pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
  return `${seta}${pct} vs. mês anterior (${anterior})`;
}

// Abas reais do painel (09/09/2026, pedido do Matheus) -- classificação dos
// quadros por assunto: Cotações/Fechamento são os 2 funis (quadros híbridos
// que hoje mostram os 2 juntos entram split, cada metade na sua aba),
// Seguradora e Imobiliária são os quadros agrupados por essas entidades, e
// Equipe é produtividade/tempo por responsável (não se encaixava nas 4
// categorias pedidas). Visão Geral junta os KPIs de topo + Qualidade dos
// Dados (também não são "assunto", são visão executiva/meta).
const ABAS: DefinicaoAba[] = [
  { id: "visao-geral", label: "Visão Geral" },
  { id: "cotacoes", label: "Cotações" },
  { id: "fechamento", label: "Fechamento" },
  { id: "seguradora", label: "Seguradora" },
  { id: "imobiliaria", label: "Imobiliária" },
  { id: "equipe", label: "Equipe" },
];

function fmtDuracao(minutosTotais: number): string {
  const min = Math.round(minutosTotais);
  const horas = Math.floor(min / 60);
  const minutos = min % 60;
  if (horas === 0) return `${minutos}min`;
  return `${horas}h${String(minutos).padStart(2, "0")}min`;
}

// Timeout do Vercel é 60s e MATA a função sem rodar catch nenhum -- não dá
// pra reagir a isso depois que acontece. Por isso corta a busca ao vivo
// antes disso (com folga pra ainda dar tempo de consultar o retrato salvo e
// responder) em vez de deixar o Bitrix decidir quando a página quebra.
const LIMITE_TEMPO_AO_VIVO_MS = 40_000;

function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado após ${Math.round(ms / 1000)}s buscando no Bitrix`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// Snapshots salvos antes de 17/08/2026 têm a forma antiga desses 3 quadros
// (ou nem têm efetivacoesPorDia) -- normaliza pra não quebrar a página com
// um retrato salvo antigo, seja reabrindo um mês passado ou caindo aqui de
// fallback por erro no mês atual.
function normalizarSnapshot(
  payload: AnaliseGerencial & { totalMovimentacoes: number },
  competencia: string
): AnaliseGerencial & { totalMovimentacoes: number } {
  // Snapshots salvos antes do congelamento/herança (20/08/2026) têm
  // contratosRecebidosPorDia no formato antigo (QuadroDiario direto, sem
  // mesAtual/herdado) -- trata como objeto solto pra não quebrar o cast.
  const contratosRecebidosPorDia = payload.contratosRecebidosPorDia as unknown as { mesAtual?: unknown; herdado?: unknown } | undefined;
  return {
    ...payload,
    kpis: {
      ...payload.kpis,
      // Retratos congelados antes de 20/08/2026 não têm esse campo -- toda
      // linha de topImobiliarias já nasce de novidade, "em andamento" ou
      // evento (recusa/perda/conversão) DESTE mês, então o total de linhas
      // já é exatamente "novos + herdados relevantes este mês".
      imobiliariasAtivas: payload.kpis.imobiliariasAtivas ?? payload.topImobiliarias.length,
    },
    analisesDiariasPorResponsavel: normalizarQuadroDiario(payload.analisesDiariasPorResponsavel, competencia),
    contratosRecebidosPorDia: {
      mesAtual: normalizarQuadroDiario(contratosRecebidosPorDia?.mesAtual, competencia),
      herdado: normalizarQuadroDiario(contratosRecebidosPorDia?.herdado, competencia),
    },
    efetivacoesPorDia: normalizarQuadroDiario(payload.efetivacoesPorDia, competencia),
    // Retratos congelados antes de 09/09/2026 não têm nada disso -- entram
    // zerados/vazios em vez de quebrar a página ao reabrir um mês antigo.
    aba2Taxas: payload.aba2Taxas ?? { menor: null, media: null, n: 0 },
    top3AprovacaoPottencial: payload.top3AprovacaoPottencial ?? [],
    contratosTardios: payload.contratosTardios ?? {
      tardios: 0,
      contratacaoTardia: 0,
      pctContratacaoTardiaSobreFechamentos: 0,
      premioLiquidoContratacaoTardia: 0,
      negociacaoTardia: 0,
      agContratoTardia: 0,
    },
    topImobiliarias: payload.topImobiliarias.map((im) => ({
      ...im,
      menorTaxaMediaGeral: im.menorTaxaMediaGeral ?? null,
      menorTaxaMediaNegativados: im.menorTaxaMediaNegativados ?? null,
      // Retratos congelados antes de 10/09/2026 não têm esses 2 campos.
      menorTaxaGeral: im.menorTaxaGeral ?? null,
      taxaMediaConvertidos: im.taxaMediaConvertidos ?? null,
      clienteNovo: im.clienteNovo ?? false,
    })),
    qualidade: { ...payload.qualidade, naoAdministrados: payload.qualidade.naoAdministrados ?? 0 },
  };
}

function construirSegmentosFunil(
  gerencial: AnaliseGerencial,
  categoria: number
): { label: string; value: number; classe: string }[] {
  const nomeFunil = categoria === CATEGORIA_ANALISE ? "Análise e Cotação" : "Negociação e Contrato";
  const segmentos: { label: string; value: number; classe: string }[] = [];

  for (const etapa of ETAPAS.filter((e) => e.statusId.startsWith(`DT1042_${categoria}:`) && e.semantica === "P")) {
    const valor = gerencial.porFunilEtapa[`${nomeFunil} | ${etapa.nome}`] ?? 0;
    if (valor > 0) segmentos.push({ label: etapa.nome, value: valor, classe: styles.segNew });
  }

  // Terminais (Recusado/Aprovado/Perdido/Convertido) somam mês atual +
  // herdado num número só, e representam só o que aconteceu NESTE mês --
  // por isso usam .total (não dividem por origem aqui, ver KPIs do topo
  // pra essa divisão).
  if (categoria === CATEGORIA_ANALISE) {
    if (gerencial.kpis.aprovados.total > 0) {
      segmentos.push({ label: "Aprovado p/ Negociação e Contrato", value: gerencial.kpis.aprovados.total, classe: styles.segInfo });
    }
    if (gerencial.kpis.recusados.total > 0) {
      segmentos.push({ label: "Recusado", value: gerencial.kpis.recusados.total, classe: styles.segNeg });
    }
  } else {
    if (gerencial.kpis.convertidos.total > 0) {
      segmentos.push({ label: "Convertido", value: gerencial.kpis.convertidos.total, classe: styles.segInfo });
    }
    if (gerencial.kpis.perdidos.total > 0) {
      segmentos.push({ label: "Negativado", value: gerencial.kpis.perdidos.total, classe: styles.segNeg });
    }
  }
  return segmentos;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "positive" | "negative" | "warning" | "info" }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${styles.num} ${tone ? styles[tone] : ""}`}>{value}</div>
      <div className={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function BarraProporcional({ label, value, max, formatted, warning, tip }: { label: string; value: number; max: number; formatted?: string; warning?: boolean; tip?: string }) {
  const pct = Math.max(2, (value / Math.max(max, 1)) * 100);
  return (
    <div className={styles.barrow} title={tip}>
      <div className={styles.rlabel}>{label}</div>
      <div className={styles.track}>
        <div className={`${styles.fill} ${warning ? styles.fillWarning : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className={`${styles.rvalue} ${styles.num}`}>{formatted ?? value}</div>
    </div>
  );
}

function StackBar({ segments, total }: { segments: { label: string; value: number; classe: string }[]; total: number }) {
  return (
    <div className={styles.stackbar}>
      {segments.map((s) => (
        <div key={s.label} className={`${styles.seg} ${s.classe}`} style={{ width: `${(s.value / Math.max(total, 1)) * 100}%` }} title={`${s.label}: ${s.value}`} />
      ))}
    </div>
  );
}

// "Novos" = criados nesta competência (zera na virada). "Andamento" = tudo
// que essa pessoa tem aberto agora, novidades + herdados (não zera).
// "Negativos"/"Positivos" = evento terminal neste mês, novidade+herdado
// somados (zera na virada).
function ProdutividadeTabela({ dados }: { dados: AnaliseGerencial["porResponsavelFunil1"] }) {
  const linhas = Object.entries(dados).sort(
    (a, b) => b[1].novos + b[1].andamento + b[1].negativos + b[1].positivos - (a[1].novos + a[1].andamento + a[1].negativos + a[1].positivos)
  );
  return (
    <div className={styles.tableWrap}>
      <table className={styles.data}>
        <thead>
          <tr>
            <th>Responsável</th>
            <th className={styles.numCol}>Novos</th>
            <th className={styles.numCol}>Andamento</th>
            <th className={styles.numCol}>Negativos</th>
            <th className={styles.numCol}>Positivos</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(([nome, d]) => (
            <tr key={nome}>
              <td>{nome}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.novos}</td>
              <td className={styles.numCol}>
                <span className={`${styles.pill} ${styles.pillPositive}`}>{d.andamento}</span>
              </td>
              <td className={styles.numCol}>
                <span className={`${styles.pill} ${styles.pillNegative}`}>{d.negativos}</span>
              </td>
              <td className={styles.numCol}>
                <span className={`${styles.pill} ${styles.pillPositive}`}>{d.positivos}</span>
              </td>
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "var(--ink-faint)" }}>
                Nenhum card neste funil no período.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// "Contratos recebidos por dia" -- 3 colunas (Data, Mês Atual, Mês
// Anterior), já que mesAtual/herdado têm exatamente os mesmos dias na mesma
// ordem (vêm da mesma competência, ver montarQuadroDiario).
function ContratosRecebidosTabela({ mesAtual, herdado }: { mesAtual: QuadroDiario; herdado: QuadroDiario }) {
  const totalMesAtual = mesAtual.dias.reduce((a, d) => a + d.total, 0);
  const totalHerdado = herdado.dias.reduce((a, d) => a + d.total, 0);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.data}>
        <thead>
          <tr>
            <th>Data</th>
            <th className={styles.numCol}>Mês Atual</th>
            <th className={styles.numCol}>Mês Anterior</th>
          </tr>
        </thead>
        <tbody>
          {mesAtual.dias.map((d, i) => (
            <tr key={d.data}>
              <td>{d.data.split("-").reverse().join("/")}</td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                {d.total}
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>{herdado.dias[i]?.total ?? 0}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ fontWeight: 700 }}>Total</td>
            <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
              {totalMesAtual}
            </td>
            <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
              {totalHerdado}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Tabela "Data × Responsável" compartilhada pelos 3 quadros diários
// (cotações concluídas, contratos recebidos, efetivações) -- mesma forma
// desde que passaram a usar os campos de responsável por etapa.
// "Contratos recebidos por dia" usa mostrarResponsaveis={false} (pedido da
// Patricia): só Data × Quant., sem a quebra por pessoa que os outros dois
// quadros mantêm.
function QuadroDiarioTabela({ quadro, mostrarResponsaveis = true }: { quadro: QuadroDiario; mostrarResponsaveis?: boolean }) {
  const semNenhumRegistro = mostrarResponsaveis ? quadro.responsaveis.length === 0 : quadro.dias.every((d) => d.total === 0);
  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.data}>
          <thead>
            <tr>
              <th>Data</th>
              <th className={styles.numCol}>Quant.</th>
              {mostrarResponsaveis &&
                quadro.responsaveis.map((nome) => (
                  <th key={nome} className={styles.numCol}>
                    {nome}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {quadro.dias.map((d) => (
              <tr key={d.data}>
                <td>{d.data.split("-").reverse().join("/")}</td>
                <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                  {d.total}
                </td>
                {mostrarResponsaveis &&
                  quadro.responsaveis.map((nome) => (
                    <td key={nome} className={`${styles.numCol} ${styles.num}`}>
                      {d.porResponsavel[nome] ?? 0}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 700 }}>Total</td>
              <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                {quadro.dias.reduce((a, d) => a + d.total, 0)}
              </td>
              {mostrarResponsaveis &&
                quadro.responsaveis.map((nome) => (
                  <td key={nome} className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                    {quadro.dias.reduce((a, d) => a + (d.porResponsavel[nome] ?? 0), 0)}
                  </td>
                ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {semNenhumRegistro && (
        <div className={styles.panelSub} style={{ marginTop: 12 }}>
          Nenhum registro neste período.
        </div>
      )}
    </>
  );
}

export default async function SeguroFiancaPage({
  searchParams,
}: {
  searchParams: Promise<{ competencia?: string }>;
}) {
  const { competencia: competenciaParam } = await searchParams;
  const competenciaAtual = mesAtualDefault();
  const competencia = competenciaParam || competenciaAtual;
  const ehCompetenciaAtual = competencia === competenciaAtual;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  let gerencial: (AnaliseGerencial & { totalMovimentacoes: number }) | null = null;
  let atualizadoEm: string | null = null;
  let erro: string | null = null;
  let semRegistroNoPeriodo = false;
  let usandoRetratoSalvo = false;

  if (ehCompetenciaAtual) {
    try {
      gerencial = await comLimiteDeTempo(buscarAnaliseGerencialAoVivo(competencia), LIMITE_TEMPO_AO_VIVO_MS);
      atualizadoEm = new Date().toISOString();
      const { error: erroUpsert } = await supabase
        .from("seguro_fianca_snapshots")
        .upsert({ competencia, atualizado_em: atualizadoEm, payload: gerencial }, { onConflict: "competencia" });
      if (erroUpsert) {
        console.error("Falha ao salvar snapshot do Seguro Fiança no Supabase:", erroUpsert);
      }
    } catch (e) {
      erro = e instanceof Error ? e.message : "Falha ao buscar dados do Bitrix.";
      // Busca ao vivo falhou (ou estourou o limite) -- em vez de deixar a
      // tela em branco, cai pro último retrato salvo (se existir um) igual
      // já fazemos pra competência passada. O aviso de erro continua
      // aparecendo, só que agora com o painel funcionando por baixo.
      const { data } = await supabase
        .from("seguro_fianca_snapshots")
        .select("payload, atualizado_em")
        .eq("competencia", competencia)
        .maybeSingle();
      if (data) {
        gerencial = normalizarSnapshot(data.payload as AnaliseGerencial & { totalMovimentacoes: number }, competencia);
        atualizadoEm = data.atualizado_em;
        usandoRetratoSalvo = true;
      }
    }
  } else {
    const { data } = await supabase.from("seguro_fianca_snapshots").select("payload, atualizado_em").eq("competencia", competencia).maybeSingle();
    if (data) {
      gerencial = normalizarSnapshot(data.payload as AnaliseGerencial & { totalMovimentacoes: number }, competencia);
      atualizadoEm = data.atualizado_em;
    } else {
      // Nenhum snapshot foi salvo pra esse mês (a página nunca foi aberta
      // durante essa competência) — mostra os painéis normalmente, todos
      // zerados, em vez de uma tela em branco. É uma informação real (zero
      // cards registrados), não falta de dado.
      gerencial = { ...montarAnaliseGerencial([], [], competencia), totalMovimentacoes: 0 };
      semRegistroNoPeriodo = true;
    }
  }

  // Coluna "Tendência" da tabela de imobiliárias -- compara o total de
  // cotações desta competência com a anterior. Sem mês anterior salvo ainda
  // (ex: primeiro mês rodando o painel), cada imobiliária cai no ramo
  // "anterior = 0" e aparece como alta -- comportamento esperado, avisado
  // pela própria Patricia ao pedir essa coluna.
  const { data: snapshotAnterior } = await supabase
    .from("seguro_fianca_snapshots")
    .select("payload")
    .eq("competencia", competenciaAnterior(competencia))
    .maybeSingle();
  const topImobiliariasMesAnterior = (snapshotAnterior?.payload as AnaliseGerencial | undefined)?.topImobiliarias ?? [];
  const totalMesAnteriorPorImobiliaria: Record<string, number> = {};
  const convertidosMesAnteriorPorImobiliaria: Record<string, number> = {};
  const premioEfetivadoMesAnteriorPorImobiliaria: Record<string, number> = {};
  const comissaoEfetivadaMesAnteriorPorImobiliaria: Record<string, number> = {};
  for (const im of topImobiliariasMesAnterior) {
    totalMesAnteriorPorImobiliaria[im.nome] = im.total;
    convertidosMesAnteriorPorImobiliaria[im.nome] = im.convertidos;
    premioEfetivadoMesAnteriorPorImobiliaria[im.nome] = im.premioEfetivado;
    comissaoEfetivadaMesAnteriorPorImobiliaria[im.nome] = im.comissaoEfetivada;
  }
  // Comparativo "Total de Análises" do Bloco 1 (Visão Geral) -- mesma base
  // que a Aba 1 usa (novidades + herdados ativos no mês), pra bater com o
  // resto do painel.
  const totalRelevantesMesAnterior = (snapshotAnterior?.payload as AnaliseGerencial | undefined)?.kpis.totalRelevantes ?? 0;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <div className={styles.wrap}>
        <div id="painel-fianca-completo" className={styles.container}>
          <div className={styles.masthead}>
            <div>
              <div className={styles.eyebrow}>O2 Seguros · Central de Negócios · SPA Seguro Fiança</div>
              <h1 className={styles.title}>Painel de Produção — {competencia}</h1>
            </div>
            <div className={styles.meta}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                <SeletorCompetencia competencia={competencia} />
                {ehCompetenciaAtual && <AtualizarAgora />}
                {gerencial && (
                  <BotaoExportarPainelPdf painelId="painel-fianca-completo" nomeArquivo={`seguro-fianca-painel-${competencia}`} />
                )}
              </div>
              <br />
              {atualizadoEm && <>Atualizado em {new Date(atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>}
              {semRegistroNoPeriodo && <>Nenhum card registrado nesta competência</>}
            </div>
          </div>

          {erro && (
            <div className={styles.stampPanel + " " + styles.stampPanelWarning} style={{ marginBottom: 24 }}>
              <div className={styles.stampBadge + " " + styles.stampBadgeWarning}>ERRO</div>
              <div className={styles.stampList}>
                <div>
                  Não consegui buscar os dados do Bitrix agora: {erro}
                  {usandoRetratoSalvo
                    ? " — mostrando o último retrato salvo, pode estar um pouco desatualizado."
                    : " — e ainda não existe nenhum retrato salvo desta competência pra mostrar no lugar."}
                </div>
              </div>
            </div>
          )}

          {gerencial && (
            <AbasProvider abas={ABAS}>
              <AbaSlot aba="visao-geral">
              <div id="quadro-fianca-total-analises" className={styles.kpis} style={{ marginBottom: 20 }}>
                <Kpi
                  label="Total de Análises do Mês"
                  value={String(gerencial.kpis.totalRelevantes)}
                  sub={`${fmtTendencia(gerencial.kpis.totalRelevantes, totalRelevantesMesAnterior)} — novidades + herdados ativos`}
                  tone="info"
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--ink)" }}>Novidades do mês</h2>
                <ExportarQuadro
                  quadroId="quadro-fianca-novidades"
                  nomeArquivo={`seguro-fianca-novidades-${competencia}`}
                  dadosExcel={[
                    { indicador: "Total de Cards", valor: gerencial.kpis.total },
                    { indicador: "Imobiliárias", valor: gerencial.kpis.imobiliarias },
                    { indicador: "Em Andamento", valor: gerencial.kpis.emAndamento.mesAtual },
                    { indicador: "Recusados", valor: gerencial.kpis.recusados.mesAtual },
                    { indicador: "Aprovados", valor: gerencial.kpis.aprovados.mesAtual },
                    { indicador: "Negativados", valor: gerencial.kpis.perdidos.mesAtual },
                    { indicador: "Convertidos", valor: gerencial.kpis.convertidos.mesAtual },
                    { indicador: "Cards com Alerta", valor: gerencial.kpis.comAlerta },
                  ]}
                  nomeAbaExcel="Novidades do mês"
                />
              </div>
              <div id="quadro-fianca-novidades" className={styles.kpis}>
                <Kpi label="Total de Cards" value={String(gerencial.kpis.total)} sub="criados nesta competência" />
                <Kpi label="Imobiliárias" value={String(gerencial.kpis.imobiliarias)} sub="enviaram cotação no período" />
                <Kpi label="Em Andamento" value={String(gerencial.kpis.emAndamento.mesAtual)} sub="deste mês, ainda sendo trabalhados" tone="positive" />
                <Kpi label="Recusados" value={String(gerencial.kpis.recusados.mesAtual)} sub="deste mês, não avançaram em Análise e Cotação" tone="negative" />
                <Kpi label="Aprovados" value={String(gerencial.kpis.aprovados.mesAtual)} sub="deste mês, saíram p/ Negociação" tone="info" />
                <Kpi label="Negativados" value={String(gerencial.kpis.perdidos.mesAtual)} sub="deste mês, cliente não quis contratar" tone="negative" />
                <Kpi label="Convertidos" value={String(gerencial.kpis.convertidos.mesAtual)} sub="deste mês, contrato fechado" />
                <Kpi
                  label="Cards com Alerta"
                  value={String(gerencial.kpis.comAlerta)}
                  sub={`${Math.round((gerencial.kpis.comAlerta / Math.max(gerencial.kpis.totalRelevantes, 1)) * 100)}% de novidades + herdados — ver qualidade dos dados`}
                  tone={gerencial.kpis.comAlerta / Math.max(gerencial.kpis.totalRelevantes, 1) > 0.2 ? "warning" : "positive"}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: "var(--ink)" }}>Herdado de meses anteriores</h2>
                <ExportarQuadro
                  quadroId="quadro-fianca-herdado"
                  nomeArquivo={`seguro-fianca-herdado-${competencia}`}
                  dadosExcel={[
                    { indicador: "Imobiliárias", valor: gerencial.kpis.imobiliariasHerdado },
                    { indicador: "Em Andamento", valor: gerencial.kpis.emAndamento.herdado },
                    { indicador: "Recusados", valor: gerencial.kpis.recusados.herdado },
                    { indicador: "Aprovados", valor: gerencial.kpis.aprovados.herdado },
                    { indicador: "Negativados", valor: gerencial.kpis.perdidos.herdado },
                    { indicador: "Convertidos", valor: gerencial.kpis.convertidos.herdado },
                  ]}
                  nomeAbaExcel="Herdado"
                />
              </div>
              <div id="quadro-fianca-herdado" className={styles.kpis}>
                <Kpi label="Imobiliárias" value={String(gerencial.kpis.imobiliariasHerdado)} sub="com card herdado ainda relevante este mês" />
                <Kpi label="Em Andamento" value={String(gerencial.kpis.emAndamento.herdado)} sub="ainda em aberto, de outros meses" tone="positive" />
                <Kpi label="Recusados" value={String(gerencial.kpis.recusados.herdado)} sub="recusados este mês, criados antes" tone="negative" />
                <Kpi label="Aprovados" value={String(gerencial.kpis.aprovados.herdado)} sub="aprovados este mês, criados antes" tone="info" />
                <Kpi label="Negativados" value={String(gerencial.kpis.perdidos.herdado)} sub="negativados este mês, criados antes" tone="negative" />
                <Kpi label="Convertidos" value={String(gerencial.kpis.convertidos.herdado)} sub="convertidos este mês, criados antes" />
              </div>
              </AbaSlot>

              {(() => {
                // "Em andamento" mostra tudo (novidades + herdados); os
                // terminais (Recusado/Aprovado/Perdido/Convertido) só o que
                // aconteceu neste mês -- por isso o total de cada barra é a
                // soma dos próprios segmentos, não um KPI pronto. Quadro
                // híbrido (09/09/2026): split por funil, cada metade na sua
                // aba (Cotações/Fechamento).
                const segmentosFunil1 = construirSegmentosFunil(gerencial, CATEGORIA_ANALISE);
                const segmentosFunil2 = construirSegmentosFunil(gerencial, CATEGORIA_NEGOCIACAO);
                const totalFunil1 = segmentosFunil1.reduce((a, s) => a + s.value, 0);
                const totalFunil2 = segmentosFunil2.reduce((a, s) => a + s.value, 0);
                return (
                  <>
                    <AbaSlot aba="cotacoes">
                      <section id="quadro-fianca-distribuicao-cotacoes" className={styles.section}>
                        <div className={styles.sectionHead}>
                          <h2>Distribuição por etapa — Análise e Cotação</h2>
                          <div className={styles.note}>em andamento (todos) + recusado/aprovado deste mês</div>
                          <ExportarQuadro
                            quadroId="quadro-fianca-distribuicao-cotacoes"
                            nomeArquivo={`seguro-fianca-distribuicao-cotacoes-${competencia}`}
                            dadosExcel={segmentosFunil1.map((s) => ({ etapa: s.label, cards: s.value }))}
                            nomeAbaExcel="Distribuição Cotações"
                          />
                        </div>
                        <div className={styles.panel}>
                          <div className={styles.stackGroup}>
                            <div className={styles.glabel}>
                              <span>Análise e Cotação — em andamento (todos) + recusado/aprovado deste mês</span>
                              <span className={styles.num}>{totalFunil1} cards</span>
                            </div>
                            <StackBar segments={segmentosFunil1} total={totalFunil1} />
                          </div>
                          <div className={styles.legendRow}>
                            <div className={styles.legendItem}>
                              <span className={styles.swatch} style={{ background: "var(--accent)" }} /> Em andamento
                            </div>
                            <div className={styles.legendItem}>
                              <span className={styles.swatch} style={{ background: "var(--info)" }} /> Aprovado (este mês)
                            </div>
                            <div className={styles.legendItem}>
                              <span className={styles.swatch} style={{ background: "var(--negative)" }} /> Recusado (este mês)
                            </div>
                          </div>
                        </div>
                      </section>
                    </AbaSlot>
                    <AbaSlot aba="fechamento">
                      <section id="quadro-fianca-distribuicao-fechamento" className={styles.section}>
                        <div className={styles.sectionHead}>
                          <h2>Distribuição por etapa — Negociação e Contrato</h2>
                          <div className={styles.note}>em andamento (todos) + convertido/negativado deste mês</div>
                          <ExportarQuadro
                            quadroId="quadro-fianca-distribuicao-fechamento"
                            nomeArquivo={`seguro-fianca-distribuicao-fechamento-${competencia}`}
                            dadosExcel={segmentosFunil2.map((s) => ({ etapa: s.label, cards: s.value }))}
                            nomeAbaExcel="Distribuição Fechamento"
                          />
                        </div>
                        <div className={styles.panel}>
                          <div className={styles.stackGroup}>
                            <div className={styles.glabel}>
                              <span>Negociação e Contrato — em andamento (todos) + convertido/negativado deste mês</span>
                              <span className={styles.num}>{totalFunil2} cards</span>
                            </div>
                            <StackBar segments={segmentosFunil2} total={totalFunil2} />
                          </div>
                          <div className={styles.legendRow}>
                            <div className={styles.legendItem}>
                              <span className={styles.swatch} style={{ background: "var(--accent)" }} /> Em andamento
                            </div>
                            <div className={styles.legendItem}>
                              <span className={styles.swatch} style={{ background: "var(--info)" }} /> Convertido (este mês)
                            </div>
                            <div className={styles.legendItem}>
                              <span className={styles.swatch} style={{ background: "var(--negative)" }} /> Negativado (este mês)
                            </div>
                          </div>
                        </div>
                      </section>
                    </AbaSlot>
                  </>
                );
              })()}

              {/* Quadro híbrido (09/09/2026): "Análise, recusa e negativação" split -- Total/Aprovados/Recusados são desfecho do
                  funil 1 (Cotações); Negativados/% de Negativação são desfecho do funil 2 (Fechamento). */}
              <AbaSlot aba="cotacoes">
                <section id="quadro-fianca-analise-resumo-cotacoes" className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h2>Análise, recusa e aprovação</h2>
                    <div className={styles.note}>total de análise = todo o conjunto ativo do mês (novidades + herdados ativos)</div>
                    <ExportarQuadro
                      quadroId="quadro-fianca-analise-resumo-cotacoes"
                      nomeArquivo={`seguro-fianca-analise-resumo-cotacoes-${competencia}`}
                      dadosExcel={[
                        { indicador: "Total de Análise", valor: gerencial.kpis.totalRelevantes },
                        { indicador: "Aprovados", valor: gerencial.kpis.aprovados.total },
                        { indicador: "Recusados", valor: gerencial.kpis.recusados.total },
                      ]}
                      nomeAbaExcel="Análise resumo"
                    />
                  </div>
                  <div className={styles.kpis}>
                    <Kpi label="Total de Análise" value={String(gerencial.kpis.totalRelevantes)} sub="novidades + herdados ativos no mês" />
                    <Kpi label="Aprovados" value={String(gerencial.kpis.aprovados.total)} sub="passaram p/ Negociação, mês do evento" tone="info" />
                    <Kpi label="Recusados" value={String(gerencial.kpis.recusados.total)} sub="seguradora negou, mês do evento" tone="negative" />
                  </div>
                </section>
              </AbaSlot>
              <AbaSlot aba="fechamento">
                <section id="quadro-fianca-analise-resumo-fechamento" className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h2>Negativação</h2>
                    <div className={styles.note}>% sobre o total de análise (novidades + herdados ativos) — ver aba Cotações</div>
                    <ExportarQuadro
                      quadroId="quadro-fianca-analise-resumo-fechamento"
                      nomeArquivo={`seguro-fianca-analise-resumo-fechamento-${competencia}`}
                      dadosExcel={[
                        { indicador: "Negativados", valor: gerencial.kpis.perdidos.total },
                        {
                          indicador: "% de Negativação",
                          valor: gerencial.kpis.totalRelevantes > 0 ? (gerencial.kpis.perdidos.total / gerencial.kpis.totalRelevantes) * 100 : 0,
                        },
                      ]}
                      nomeAbaExcel="Negativação"
                    />
                  </div>
                  <div className={styles.kpis}>
                    <Kpi label="Negativados" value={String(gerencial.kpis.perdidos.total)} sub="cliente não quis contratar, mês do evento" tone="negative" />
                    <Kpi
                      label="% de Negativação"
                      value={fmtPct(gerencial.kpis.totalRelevantes > 0 ? (gerencial.kpis.perdidos.total / gerencial.kpis.totalRelevantes) * 100 : 0)}
                      sub={`negativados ÷ ${gerencial.kpis.totalRelevantes} análises do mês`}
                      tone={gerencial.kpis.totalRelevantes > 0 && gerencial.kpis.perdidos.total / gerencial.kpis.totalRelevantes > 0.2 ? "warning" : undefined}
                    />
                  </div>
                </section>
              </AbaSlot>

              <AbaSlot aba="seguradora">
              <section id="quadro-fianca-seguradora-plano" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Análise por seguradora e plano</h2>
                  <div className={styles.note}>status de cotação — Porto e Pottencial têm mais de um plano cotado por card</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-seguradora-plano"
                    nomeArquivo={`seguro-fianca-seguradora-plano-${competencia}`}
                    dadosExcel={Object.entries(gerencial.statusPorSeguradora).flatMap(([nome, contagens]) =>
                      Object.entries(contagens).map(([status, quantidade]) => ({ seguradora: nome, status, quantidade }))
                    )}
                    nomeAbaExcel="Seguradora e plano"
                  />
                </div>
                <div className={styles.panel}>
                  {Object.entries(gerencial.statusPorSeguradora).map(([nome, contagens]) => {
                    const OK = new Set(["Aprov", "Aprov.", "Aprovado", "Pré-Aprov.", "Pré-Aprovado"]);
                    const NO = new Set(["Recusado"]);
                    const PEND = new Set(["Pendente", "Em análise", "Limite insuficiente"]);
                    let ok = 0,
                      no = 0,
                      pend = 0,
                      skip = 0;
                    for (const [rotulo, n] of Object.entries(contagens)) {
                      if (OK.has(rotulo)) ok += n;
                      else if (NO.has(rotulo)) no += n;
                      else if (PEND.has(rotulo)) pend += n;
                      else skip += n;
                    }
                    const cotado = ok + no + pend + skip;
                    return (
                      <div key={nome} className={styles.insRow}>
                        <div className={styles.rlabel}>{nome}</div>
                        <div className={styles.insTrack}>
                          {ok > 0 && <div className={`${styles.insSeg} ${styles.insOk}`} style={{ width: `${(ok / gerencial.kpis.total) * 100}%` }} title={`Aprovado/Pré-aprovado: ${ok}`} />}
                          {no > 0 && <div className={`${styles.insSeg} ${styles.insNo}`} style={{ width: `${(no / gerencial.kpis.total) * 100}%` }} title={`Recusado: ${no}`} />}
                          {pend > 0 && <div className={`${styles.insSeg} ${styles.insPend}`} style={{ width: `${(pend / gerencial.kpis.total) * 100}%` }} title={`Pendente/Em análise: ${pend}`} />}
                          {skip > 0 && <div className={`${styles.insSeg} ${styles.insSkip}`} style={{ width: `${(skip / gerencial.kpis.total) * 100}%` }} title={`Não analisar: ${skip}`} />}
                        </div>
                        <div className={`${styles.num} ${styles.rvalue}`}>
                          {cotado} / {gerencial.kpis.total} cotados
                        </div>
                      </div>
                    );
                  })}
                  <div className={styles.legendRow} style={{ marginTop: 14 }}>
                    <div className={styles.legendItem}>
                      <span className={styles.swatch} style={{ background: "var(--positive)" }} /> Aprovado/Pré-aprovado
                    </div>
                    <div className={styles.legendItem}>
                      <span className={styles.swatch} style={{ background: "var(--negative)" }} /> Recusado
                    </div>
                    <div className={styles.legendItem}>
                      <span className={styles.swatch} style={{ background: "var(--warning)" }} /> Pendente/Em análise/Limite insuficiente
                    </div>
                    <div className={styles.legendItem}>
                      <span className={styles.swatch} style={{ background: "var(--ink-faint)", opacity: 0.4 }} /> Não analisar
                    </div>
                  </div>
                </div>
              </section>

              <section id="quadro-fianca-top3-pottencial" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Top 3 imobiliárias — aprovação na Pottencial</h2>
                  <div className={styles.note}>aprovado/pré-aprovado em qualquer um dos 2 planos (Taxa Fixa ou Tradicional), cards deste mês</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-top3-pottencial"
                    nomeArquivo={`seguro-fianca-top3-pottencial-${competencia}`}
                    dadosExcel={gerencial.top3AprovacaoPottencial.map((im) => ({ imobiliaria: im.nome, aprovados_pottencial: im.aprovados }))}
                    nomeAbaExcel="Top3 Pottencial"
                  />
                </div>
                <div className={styles.panel}>
                  <div className={styles.barlist}>
                    {gerencial.top3AprovacaoPottencial.map((im) => (
                      <BarraProporcional
                        key={im.nome}
                        label={im.nome}
                        value={im.aprovados}
                        max={gerencial.top3AprovacaoPottencial[0]?.aprovados ?? 1}
                      />
                    ))}
                    {gerencial.top3AprovacaoPottencial.length === 0 && (
                      <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhuma aprovação na Pottencial neste período.</div>
                    )}
                  </div>
                </div>
              </section>
              </AbaSlot>

              <AbaSlot aba="equipe">
              <section id="quadro-fianca-produtividade" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Produtividade por responsável, por funil</h2>
                  <div className={styles.note}>
                    Análise e Cotação: Responsável(is) pela Cotação, ou pelo Cadastro se a cotação ainda não foi atribuída. Negociação e
                    Contrato: Responsável(is) pela Negociação. Nunca o dono atual do card.
                  </div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-produtividade"
                    nomeArquivo={`seguro-fianca-produtividade-${competencia}`}
                    dadosExcel={[
                      ...Object.entries(gerencial.porResponsavelFunil1).map(([nome, d]) => ({
                        funil: "Análise e Cotação",
                        responsavel: nome,
                        novos: d.novos,
                        em_andamento: d.andamento,
                        positivos: d.positivos,
                        negativos: d.negativos,
                      })),
                      ...Object.entries(gerencial.porResponsavelFunil2).map(([nome, d]) => ({
                        funil: "Negociação e Contrato",
                        responsavel: nome,
                        novos: d.novos,
                        em_andamento: d.andamento,
                        positivos: d.positivos,
                        negativos: d.negativos,
                      })),
                    ]}
                    nomeAbaExcel="Produtividade"
                  />
                </div>
                <div className={styles.grid2}>
                  <div className={styles.panel}>
                    <h3>Análise e Cotação</h3>
                    <div className={styles.panelSub}>Positivos = card que essa pessoa encaminhou pro funil 2 (crédito de quem concluiu, não de quem só criou)</div>
                    <ProdutividadeTabela dados={gerencial.porResponsavelFunil1} />
                  </div>
                  <div className={styles.panel}>
                    <h3>Negociação e Contrato</h3>
                    <div className={styles.panelSub}>{gerencial.kpis.aprovados.total} cards encaminhados este mês</div>
                    <ProdutividadeTabela dados={gerencial.porResponsavelFunil2} />
                  </div>
                </div>
              </section>
              </AbaSlot>

              <AbaSlot aba="seguradora">
              <section id="quadro-fianca-taxa-parcela" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Taxa média da parcela sobre o pacote de locação</h2>
                  <div className={styles.note}>parcela do seguro ÷ pacote de locação, por seguradora — só nos cards cotados</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-taxa-parcela"
                    nomeArquivo={`seguro-fianca-taxa-parcela-${competencia}`}
                    dadosExcel={SEGURADORAS.map((seg) => {
                      const t = gerencial.taxaPorSeguradora[seg.nome];
                      return { seguradora: seg.nome, cotados: t.n, taxa_sobre_pacote_locacao: t.pctLocacao, taxa_sobre_aluguel: t.pctAluguel };
                    })}
                    nomeAbaExcel="Taxa parcela"
                  />
                </div>
                <div className={styles.panel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Seguradora</th>
                          <th className={styles.numCol}>Cotados</th>
                          <th className={styles.numCol}>Taxa s/ Pacote Locação</th>
                          <th className={styles.numCol}>Taxa s/ Aluguel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SEGURADORAS.map((seg) => {
                          const t = gerencial.taxaPorSeguradora[seg.nome];
                          return (
                            <tr key={seg.nome}>
                              <td>{seg.nome}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{t.n}</td>
                              <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                                {fmtPct(t.pctLocacao)}
                              </td>
                              <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(t.pctAluguel)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section id="quadro-fianca-cotado-convertido" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Cotado vs. Convertido, por seguradora</h2>
                  <div className={styles.note}>todo prêmio cotado até agora contra o que já foi efetivamente convertido</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-cotado-convertido"
                    nomeArquivo={`seguro-fianca-cotado-convertido-${competencia}`}
                    dadosExcel={[
                      ...SEGURADORAS.map((seg) => {
                        const c = gerencial.cotadoPorSeguradora[seg.nome];
                        return { tipo: "Cotado", seguradora: seg.nome, cards: c.n, premio: c.premio, comissao: c.comissao };
                      }),
                      ...Object.entries(gerencial.convertidoPorSeguradora).map(([nome, c]) => ({
                        tipo: "Convertido",
                        seguradora: nome,
                        cards: c.n,
                        premio: c.premio,
                        comissao: c.comissao,
                      })),
                    ]}
                    nomeAbaExcel="Cotado x Convertido"
                  />
                </div>
                <div className={styles.panel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Seguradora</th>
                          <th className={styles.numCol}>Cotações</th>
                          <th className={styles.numCol}>Prêmio Cotado</th>
                          <th className={styles.numCol}>Comissão Cotada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SEGURADORAS.map((seg) => {
                          const c = gerencial.cotadoPorSeguradora[seg.nome];
                          return (
                            <tr key={seg.nome}>
                              <td>{seg.nome}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{c.n}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(c.premio)}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(c.comissao)}</td>
                            </tr>
                          );
                        })}
                        <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                          <td>Total cotado</td>
                          <td className={`${styles.numCol} ${styles.num}`}>
                            {Object.values(gerencial.cotadoPorSeguradora).reduce((a, c) => a + c.n, 0)}
                          </td>
                          <td className={`${styles.numCol} ${styles.num}`}>
                            {fmtBRL(Object.values(gerencial.cotadoPorSeguradora).reduce((a, c) => a + c.premio, 0))}
                          </td>
                          <td className={`${styles.numCol} ${styles.num}`}>
                            {fmtBRL(Object.values(gerencial.cotadoPorSeguradora).reduce((a, c) => a + c.comissao, 0))}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ color: "var(--negative)" }}>Total convertido (fechado)</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{gerencial.kpis.convertidos.total}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>
                            {fmtBRL(Object.values(gerencial.convertidoPorSeguradora).reduce((a, c) => a + c.premio, 0))}
                          </td>
                          <td className={`${styles.numCol} ${styles.num}`}>
                            {fmtBRL(Object.values(gerencial.convertidoPorSeguradora).reduce((a, c) => a + c.comissao, 0))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.panelSub} style={{ marginTop: 12 }}>
                    &quot;Comissão cotada&quot; é estimada (valor × % de comissão de cada seguradora) — potencial, ainda não é dinheiro confirmado. O prêmio/comissão convertido usa o valor líquido e a comissão final registrados no fechamento do contrato.
                  </div>
                  {Object.keys(gerencial.convertidoPorSeguradora).length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <h3>Convertidos por seguradora</h3>
                      <div className={styles.panelSub}>
                        seguradora escolhida no fechamento — pode não bater com a lista de cotação acima se o campo não foi preenchido
                      </div>
                      <div className={styles.tableWrap}>
                        <table className={styles.data}>
                          <thead>
                            <tr>
                              <th>Seguradora</th>
                              <th className={styles.numCol}>Convertidos</th>
                              <th className={styles.numCol}>Prêmio Líquido</th>
                              <th className={styles.numCol}>Comissão Final</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(gerencial.convertidoPorSeguradora)
                              .sort((a, b) => b[1].n - a[1].n)
                              .map(([nome, c]) => (
                                <tr key={nome}>
                                  <td style={nome === "Não identificado" ? { color: "var(--negative)" } : undefined}>{nome}</td>
                                  <td className={`${styles.numCol} ${styles.num}`}>{c.n}</td>
                                  <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(c.premio)}</td>
                                  <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(c.comissao)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </section>
              </AbaSlot>

              <AbaSlot aba="cotacoes">
              <section id="quadro-fianca-valores" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Valores trabalhados no mês</h2>
                  <div className={styles.note}>não é receita — ver nota no rodapé</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-valores"
                    nomeArquivo={`seguro-fianca-valores-${competencia}`}
                    dadosExcel={gerencial.faixasPacoteLocacao.map((f) => ({
                      faixa_pacote_locacao: f.faixa,
                      cards: f.cards,
                      pacote_medio: f.pacoteMedio,
                      seguro_medio_cotado: f.seguroMedio,
                    }))}
                    nomeAbaExcel="Valores trabalhados"
                  />
                </div>
                <div className={styles.panel}>
                  <h3>Ticket médio por faixa de pacote de locação</h3>
                  <div className={styles.panelSub}>quanto maior o pacote de locação, maior a parcela média do seguro cotado</div>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Faixa de Pacote Locação</th>
                          <th className={styles.numCol}>Cards</th>
                          <th className={styles.numCol}>Pacote Médio</th>
                          <th className={styles.numCol}>Seguro Médio (cotado)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gerencial.faixasPacoteLocacao.map((f) => (
                          <tr key={f.faixa}>
                            <td>{f.faixa}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{f.cards}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(f.pacoteMedio)}</td>
                            <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                              {fmtBRL(f.seguroMedio)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.panelSub} style={{ marginTop: 12 }}>
                    Totais do mês: aluguel trabalhado {fmtBRL(gerencial.valoresTrabalhados.aluguel)}, pacote de locação trabalhado {fmtBRL(gerencial.valoresTrabalhados.pacoteLocacao)}.
                  </div>
                </div>
              </section>

              {/* "Tempo de ciclo por funil" -- híbrido, split (09/09/2026): cada linha na sua aba. */}
              <section id="quadro-fianca-tempo-ciclo-cotacoes" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Tempo de ciclo — Análise e Cotação</h2>
                  <div className={styles.note}>do início até aprovar/recusar</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-tempo-ciclo-cotacoes"
                    nomeArquivo={`seguro-fianca-tempo-ciclo-cotacoes-${competencia}`}
                    dadosExcel={[
                      {
                        funil: "Análise e Cotação",
                        cards: gerencial.tempoPorFunil.analiseECotacao.n,
                        media_min: gerencial.tempoPorFunil.analiseECotacao.media,
                        mediana_min: gerencial.tempoPorFunil.analiseECotacao.mediana,
                        minimo_min: gerencial.tempoPorFunil.analiseECotacao.min,
                        maximo_min: gerencial.tempoPorFunil.analiseECotacao.max,
                      },
                    ]}
                    nomeAbaExcel="Tempo de ciclo"
                  />
                </div>
                <div className={styles.panel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Funil</th>
                          <th className={styles.numCol}>Cards</th>
                          <th className={styles.numCol}>Média</th>
                          <th className={styles.numCol}>Mediana</th>
                          <th className={styles.numCol}>Mín.</th>
                          <th className={styles.numCol}>Máx.</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Análise e Cotação (até aprovar/recusar)</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{gerencial.tempoPorFunil.analiseECotacao.n}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(gerencial.tempoPorFunil.analiseECotacao.media)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(gerencial.tempoPorFunil.analiseECotacao.mediana)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(gerencial.tempoPorFunil.analiseECotacao.min)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(gerencial.tempoPorFunil.analiseECotacao.max)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.panelSub} style={{ marginTop: 12 }}>
                    &quot;Cards&quot; conta quem já tem esse tempo definido.
                  </div>
                </div>
              </section>
              </AbaSlot>

              <AbaSlot aba="fechamento">
              <section id="quadro-fianca-tempo-ciclo-fechamento" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Tempo de ciclo — Negociação e Contrato</h2>
                  <div className={styles.note}>do início do funil 2 até converter/perder</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-tempo-ciclo-fechamento"
                    nomeArquivo={`seguro-fianca-tempo-ciclo-fechamento-${competencia}`}
                    dadosExcel={[
                      {
                        funil: "Negociação e Contrato",
                        cards: gerencial.tempoPorFunil.negociacaoEContrato.n,
                        media_min: gerencial.tempoPorFunil.negociacaoEContrato.media,
                        mediana_min: gerencial.tempoPorFunil.negociacaoEContrato.mediana,
                        minimo_min: gerencial.tempoPorFunil.negociacaoEContrato.min,
                        maximo_min: gerencial.tempoPorFunil.negociacaoEContrato.max,
                      },
                    ]}
                    nomeAbaExcel="Tempo de ciclo"
                  />
                </div>
                <div className={styles.panel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Funil</th>
                          <th className={styles.numCol}>Cards</th>
                          <th className={styles.numCol}>Média</th>
                          <th className={styles.numCol}>Mediana</th>
                          <th className={styles.numCol}>Mín.</th>
                          <th className={styles.numCol}>Máx.</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Negociação e Contrato (até converter/perder)</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{gerencial.tempoPorFunil.negociacaoEContrato.n}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(gerencial.tempoPorFunil.negociacaoEContrato.media)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(gerencial.tempoPorFunil.negociacaoEContrato.mediana)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(gerencial.tempoPorFunil.negociacaoEContrato.min)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(gerencial.tempoPorFunil.negociacaoEContrato.max)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.panelSub} style={{ marginTop: 12 }}>
                    &quot;Cards&quot; conta quem já tem esse tempo definido — só existe pra quem foi aprovado em Análise e Cotação.
                  </div>
                </div>
              </section>
              </AbaSlot>

              <AbaSlot aba="equipe">
              <section id="quadro-fianca-tempo-cotacao" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Tempo de cotação por responsável</h2>
                  <div className={styles.note}>
                    HORA INICIO → HORA FIM da fase de cotação, por Responsável(is) pela Cotação — separado por resultado porque recusar é mais rápido que cotar de verdade
                  </div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-tempo-cotacao"
                    nomeArquivo={`seguro-fianca-tempo-cotacao-${competencia}`}
                    dadosExcel={Object.entries(gerencial.tempoCotacaoPorResponsavel).map(([nome, d]) => ({
                      responsavel: nome,
                      recusados: d.recusado.n,
                      tempo_medio_recusados_min: d.recusado.n > 0 ? d.recusado.media : "",
                      aprovados_liberados: d.aprovado.n,
                      tempo_medio_aprovados_min: d.aprovado.n > 0 ? d.aprovado.media : "",
                    }))}
                    nomeAbaExcel="Tempo de cotação"
                  />
                </div>
                <div className={styles.panel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Responsável</th>
                          <th className={styles.numCol}>Recusados</th>
                          <th className={styles.numCol}>Tempo médio</th>
                          <th className={styles.numCol}>Aprovados/Liberados</th>
                          <th className={styles.numCol}>Tempo médio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(gerencial.tempoCotacaoPorResponsavel)
                          .sort((a, b) => b[1].recusado.n + b[1].aprovado.n - (a[1].recusado.n + a[1].aprovado.n))
                          .map(([nome, d]) => (
                            <tr key={nome}>
                              <td>{nome}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{d.recusado.n}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{d.recusado.n > 0 ? fmtDuracao(d.recusado.media) : "—"}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{d.aprovado.n}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{d.aprovado.n > 0 ? fmtDuracao(d.aprovado.media) : "—"}</td>
                            </tr>
                          ))}
                        {Object.keys(gerencial.tempoCotacaoPorResponsavel).length === 0 && (
                          <tr>
                            <td colSpan={5} style={{ color: "var(--ink-faint)" }}>
                              Nenhum card com HORA INICIO e HORA FIM de cotação preenchidos neste período.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.panelSub} style={{ marginTop: 12 }}>
                    {gerencial.qualidade.cotacaoTempoInconsistente > 0 ? (
                      <>
                        {gerencial.qualidade.cotacaoTempoInconsistente} card(s) com HORA INICIO e HORA FIM aparentemente preenchidos trocados — duração corrigida automaticamente (valor absoluto), já incluída nas médias.
                      </>
                    ) : (
                      <>Campo recente (desde 05/08/2026) — a amostra cresce a cada dia.</>
                    )}
                  </div>
                </div>
              </section>

              {(() => {
                // Aba 5 (09/09/2026): tempo de retorno + total de análises,
                // combinados por analista -- reaproveita
                // tempoCotacaoPorResponsavel (recusado + aprovado) e
                // porResponsavelFunil1[nome].novos (mesmo "novos" do quadro
                // de Produtividade), só junta os dois numa visão só. Corte
                // novos × renovação fica de fora (Fase 2, pipeline ainda não
                // existe).
                const nomes = new Set([...Object.keys(gerencial.tempoCotacaoPorResponsavel), ...Object.keys(gerencial.porResponsavelFunil1)]);
                const linhas = [...nomes]
                  .map((nome) => {
                    const t = gerencial.tempoCotacaoPorResponsavel[nome];
                    const nComTempo = (t?.recusado.n ?? 0) + (t?.aprovado.n ?? 0);
                    const mediaRetorno =
                      nComTempo > 0
                        ? Math.round((((t?.recusado.media ?? 0) * (t?.recusado.n ?? 0) + (t?.aprovado.media ?? 0) * (t?.aprovado.n ?? 0)) / nComTempo) * 10) / 10
                        : null;
                    return { nome, mediaRetorno, nComTempo, totalAnalises: gerencial.porResponsavelFunil1[nome]?.novos ?? 0 };
                  })
                  .filter((l) => l.totalAnalises > 0 || l.nComTempo > 0)
                  .sort((a, b) => b.totalAnalises - a.totalAnalises);
                const somaPonderada = linhas.reduce((a, l) => a + (l.mediaRetorno ?? 0) * l.nComTempo, 0);
                const somaN = linhas.reduce((a, l) => a + l.nComTempo, 0);
                const mediaGeralTime = somaN > 0 ? Math.round((somaPonderada / somaN) * 10) / 10 : null;
                return (
                  <section id="quadro-fianca-retorno-analista" className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2>Tempo de retorno e produção por analista</h2>
                      <div className={styles.note}>
                        tempo de retorno = média entre recusados e aprovados/liberados (HORA INICIO → HORA FIM); total de análises = cotações novas
                        criadas neste mês atribuídas à pessoa
                      </div>
                      <ExportarQuadro
                        quadroId="quadro-fianca-retorno-analista"
                        nomeArquivo={`seguro-fianca-retorno-analista-${competencia}`}
                        dadosExcel={linhas.map((l) => ({
                          analista: l.nome,
                          tempo_retorno_medio_min: l.mediaRetorno ?? "",
                          total_analises: l.totalAnalises,
                        }))}
                        nomeAbaExcel="Retorno por analista"
                      />
                    </div>
                    <div className={styles.kpis} style={{ marginBottom: 16 }}>
                      <Kpi
                        label="Tempo de Retorno — Média Geral"
                        value={mediaGeralTime !== null ? fmtDuracao(mediaGeralTime) : "—"}
                        sub="média do time, ponderada pelo nº de cards"
                      />
                    </div>
                    <div className={styles.panel}>
                      <div className={styles.tableWrap}>
                        <table className={`${styles.data} ${styles.compacta}`}>
                          <thead>
                            <tr>
                              <th>Analista</th>
                              <th className={styles.numCol}>Tempo de Retorno (média)</th>
                              <th className={styles.numCol}>Total de Análises</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linhas.map((l) => (
                              <tr key={l.nome}>
                                <td>{l.nome}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{l.mediaRetorno !== null ? fmtDuracao(l.mediaRetorno) : "—"}</td>
                                <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>{l.totalAnalises}</td>
                              </tr>
                            ))}
                            {linhas.length === 0 && (
                              <tr>
                                <td colSpan={3} style={{ color: "var(--ink-faint)" }}>Nenhum analista com dado neste período.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                );
              })()}

              <section id="quadro-fianca-diarios" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Quadros diários por responsável de etapa</h2>
                  <div className={styles.note}>campos de responsável por etapa, adicionados em 17/08/2026 — meses anteriores a essa data ficam vazios aqui</div>
                  <ExportarQuadro quadroId="quadro-fianca-diarios" nomeArquivo={`seguro-fianca-diarios-${competencia}`} />
                </div>
                <div className={styles.grid3}>
                  <div className={styles.panel}>
                    <h3>Quantitativo de análises diárias</h3>
                    <div className={styles.panelSub}>
                      todas as análises que entraram por dia (independe de HORA FIM registrada), por Responsável(is) pela Cotação — card com mais de uma pessoa credita as duas, então a soma das colunas pode passar do Total; cards sem o campo preenchido não entram na quebra por pessoa, mas viram alerta em &quot;Qualidade dos dados&quot;
                    </div>
                    <QuadroDiarioTabela quadro={gerencial.analisesDiariasPorResponsavel} />
                  </div>
                  <div className={styles.panel}>
                    <h3>Contratos recebidos por dia</h3>
                    <div className={styles.panelSub}>
                      cards que entraram na etapa &quot;Contrato Recebido&quot; — Mês Atual conta os cards criados nesta competência, Mês Anterior conta os herdados de qualquer competência anterior
                    </div>
                    <ContratosRecebidosTabela mesAtual={gerencial.contratosRecebidosPorDia.mesAtual} herdado={gerencial.contratosRecebidosPorDia.herdado} />
                  </div>
                  <div className={styles.panel}>
                    <h3>Efetivações por dia</h3>
                    <div className={styles.panelSub}>
                      dia da Data de Efetivação, por Responsável pela Efetivação — sem o campo preenchido vira alerta em &quot;Qualidade dos dados&quot;, não entra na quebra por pessoa
                    </div>
                    <QuadroDiarioTabela quadro={gerencial.efetivacoesPorDia} />
                  </div>
                </div>
              </section>
              </AbaSlot>

              <AbaSlot aba="fechamento">
              <section id="quadro-fianca-contratos-tardios" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Contratos e contratação tardios</h2>
                  <div className={styles.note}>
                    contrato tardio = criado em mês anterior, entrou em &quot;Contrato Recebido&quot; este mês. Contratação tardia = recebeu o
                    contrato num mês anterior, mas só converteu (fechou) este mês
                  </div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-contratos-tardios"
                    nomeArquivo={`seguro-fianca-contratos-tardios-${competencia}`}
                    dadosExcel={[
                      { indicador: "Contratos Tardios", valor: gerencial.contratosTardios.tardios },
                      { indicador: "Contratação Tardia", valor: gerencial.contratosTardios.contratacaoTardia },
                      { indicador: "% s/ Total de Fechamentos", valor: gerencial.contratosTardios.pctContratacaoTardiaSobreFechamentos },
                      { indicador: "Prêmio Líquido (Contratação Tardia)", valor: gerencial.contratosTardios.premioLiquidoContratacaoTardia },
                      { indicador: "Negociação (Tardia)", valor: gerencial.contratosTardios.negociacaoTardia },
                      { indicador: "Ag. Contrato (Tardia)", valor: gerencial.contratosTardios.agContratoTardia },
                    ]}
                    nomeAbaExcel="Contratos tardios"
                  />
                </div>
                <div className={styles.kpis}>
                  <Kpi label="Contratos Tardios" value={String(gerencial.contratosTardios.tardios)} sub="criados antes, receberam contrato este mês" />
                  <Kpi
                    label="Contratação Tardia"
                    value={String(gerencial.contratosTardios.contratacaoTardia)}
                    sub="recebeu contrato antes, converteu este mês"
                    tone="warning"
                  />
                  <Kpi
                    label="% s/ Total de Fechamentos"
                    value={fmtPct(gerencial.contratosTardios.pctContratacaoTardiaSobreFechamentos)}
                    sub="contratação tardia ÷ convertidos do mês"
                  />
                  <Kpi
                    label="Prêmio Líquido (Tardia)"
                    value={fmtBRL(gerencial.contratosTardios.premioLiquidoContratacaoTardia)}
                    sub="soma do prêmio líquido da contratação tardia"
                  />
                  <Kpi label="Negociação (Tardia)" value={String(gerencial.contratosTardios.negociacaoTardia)} sub="herdados parados em Em Negociação" />
                  <Kpi label="Ag. Contrato (Tardia)" value={String(gerencial.contratosTardios.agContratoTardia)} sub="herdados parados em Aguardando Contrato" />
                </div>
              </section>
              </AbaSlot>

              {(() => {
                // "Tempo em aberto por etapa" -- híbrido, split (09/09/2026):
                // a chave já vem como "Análise e Cotação | Etapa" ou
                // "Negociação e Contrato | Etapa" (ver porFunilEtapa/
                // tempoPorEtapa na lib), então dá pra filtrar por prefixo.
                const TabelaTempoAberto = ({ entradas, tituloVazio }: { entradas: [string, EstatisticaTempoTipo][]; tituloVazio: string }) => (
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Etapa</th>
                          <th className={styles.numCol}>Cards</th>
                          <th className={styles.numCol}>Média</th>
                          <th className={styles.numCol}>Máx.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entradas.map(([etapa, t]) => (
                          <tr key={etapa}>
                            <td>{rotuloEtapaTempoAberto(etapa)}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{t.n}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(t.media)}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(t.max)}</td>
                          </tr>
                        ))}
                        {entradas.length === 0 && (
                          <tr>
                            <td colSpan={4} style={{ color: "var(--ink-faint)" }}>
                              {tituloVazio}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
                const entradasCotacoes = Object.entries(gerencial.tempoPorEtapa).filter(([etapa]) => etapa.startsWith("Análise e Cotação"));
                const entradasFechamento = Object.entries(gerencial.tempoPorEtapa).filter(([etapa]) => etapa.startsWith("Negociação e Contrato"));
                return (
                  <>
                    <AbaSlot aba="cotacoes">
                      <section id="quadro-fianca-tempo-aberto-cotacoes" className={styles.section}>
                        <div className={styles.panel}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                            <h3>Tempo em aberto por etapa — Análise e Cotação</h3>
                            <ExportarQuadro
                              quadroId="quadro-fianca-tempo-aberto-cotacoes"
                              nomeArquivo={`seguro-fianca-tempo-aberto-cotacoes-${competencia}`}
                              dadosExcel={entradasCotacoes.map(([etapa, t]) => ({
                                etapa: rotuloEtapaTempoAberto(etapa),
                                cards: t.n,
                                media_min: t.media,
                                maximo_min: t.max,
                              }))}
                              nomeAbaExcel="Tempo em aberto"
                            />
                          </div>
                          <div className={styles.panelSub}>só os cards que estão na etapa agora, cada card contando uma vez, pelo tempo da passagem atual</div>
                          <TabelaTempoAberto entradas={entradasCotacoes} tituloVazio="Nenhum card em aberto neste período." />
                        </div>
                      </section>
                    </AbaSlot>
                    <AbaSlot aba="fechamento">
                      <section id="quadro-fianca-tempo-aberto-fechamento" className={styles.section}>
                        <div className={styles.panel}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                            <h3>Tempo em aberto por etapa — Negociação e Contrato</h3>
                            <ExportarQuadro
                              quadroId="quadro-fianca-tempo-aberto-fechamento"
                              nomeArquivo={`seguro-fianca-tempo-aberto-fechamento-${competencia}`}
                              dadosExcel={entradasFechamento.map(([etapa, t]) => ({
                                etapa: rotuloEtapaTempoAberto(etapa),
                                cards: t.n,
                                media_min: t.media,
                                maximo_min: t.max,
                              }))}
                              nomeAbaExcel="Tempo em aberto"
                            />
                          </div>
                          <div className={styles.panelSub}>só os cards que estão na etapa agora, cada card contando uma vez, pelo tempo da passagem atual</div>
                          <TabelaTempoAberto entradas={entradasFechamento} tituloVazio="Nenhum card em aberto neste período." />
                        </div>
                      </section>
                    </AbaSlot>
                  </>
                );
              })()}

              <AbaSlot aba="cotacoes">
              <section id="quadro-fianca-motivos-recusa" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Motivos de recusa</h2>
                  <div className={styles.note}>{gerencial.motivosRecusaFunil1.total} recusados em Análise e Cotação</div>
                </div>
                <div className={styles.panel}>
                  <h3>Recusas — Análise e Cotação</h3>
                  <div className={styles.panelSub}>decisão de compliance da seguradora, sem motivo interno esperado</div>
                  <div className={styles.barlist}>
                    <BarraProporcional label="Total de recusas" value={gerencial.motivosRecusaFunil1.total} max={Math.max(gerencial.motivosRecusaFunil1.total, 1)} />
                  </div>
                </div>
              </section>
              </AbaSlot>

              <AbaSlot aba="fechamento">
              <section id="quadro-fianca-motivos-negativacao" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Motivos de negativação</h2>
                  <div className={styles.note}>{gerencial.motivosPerdaFunil2.total} negativados em Negociação e Contrato</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-motivos-negativacao"
                    nomeArquivo={`seguro-fianca-motivos-negativacao-${competencia}`}
                    dadosExcel={[
                      ...Object.entries(gerencial.motivosPerdaFunil2.porMotivo).map(([motivo, n]) => ({
                        motivo,
                        cards: n,
                      })),
                      ...(gerencial.motivosPerdaFunil2.semMotivo > 0
                        ? [{ motivo: "Sem motivo registrado", cards: gerencial.motivosPerdaFunil2.semMotivo }]
                        : []),
                    ]}
                    nomeAbaExcel="Motivos"
                  />
                </div>
                <div className={styles.panel}>
                  <h3>Negativações — Negociação e Contrato</h3>
                  <div className={styles.panelSub}>{gerencial.motivosPerdaFunil2.total} cards negativados</div>
                  <div className={styles.barlist}>
                    {Object.entries(gerencial.motivosPerdaFunil2.porMotivo).map(([motivo, n]) => (
                      <BarraProporcional key={motivo} label={motivo} value={n} max={gerencial.motivosPerdaFunil2.total} />
                    ))}
                    {gerencial.motivosPerdaFunil2.semMotivo > 0 && (
                      <BarraProporcional label="Sem motivo registrado" value={gerencial.motivosPerdaFunil2.semMotivo} max={gerencial.motivosPerdaFunil2.total} warning />
                    )}
                    {gerencial.motivosPerdaFunil2.total === 0 && (
                      <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhuma negativação registrada neste período.</div>
                    )}
                  </div>
                </div>
              </section>
              </AbaSlot>

              <AbaSlot aba="imobiliaria">
              <section id="quadro-fianca-imobiliarias" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Imobiliárias — status de todos os cards</h2>
                  <div className={styles.note}>{gerencial.kpis.imobiliariasAtivas} imobiliárias com novidade ou card herdado em andamento</div>
                  <ExportarQuadro
                    quadroId="quadro-fianca-imobiliarias"
                    nomeArquivo={`seguro-fianca-imobiliarias-${competencia}`}
                    dadosExcel={gerencial.topImobiliarias.map((im) => ({
                      imobiliaria: im.nome,
                      total: im.total,
                      em_andamento: im.emAndamento,
                      recusados: im.recusados,
                      negativados: im.perdidos,
                      convertidos: im.convertidos,
                      ticket_medio_premio: im.premioCotado,
                      comissao_media_cotada: im.comissaoCotada,
                      premio_efetivado: im.premioEfetivado,
                      comissao_efetivada: im.comissaoEfetivada,
                      parcela_media: im.ticketMedio,
                      pct_pacote_medio: im.mediaPercentualPacote,
                    }))}
                    nomeAbaExcel="Imobiliárias"
                  />
                </div>
                <div className={styles.panel}>
                  <ImobiliariasTabela
                    imobiliarias={gerencial.topImobiliarias}
                    totalMesAnteriorPorImobiliaria={totalMesAnteriorPorImobiliaria}
                  />
                </div>
              </section>

              {(() => {
                // Item 1 (09/09/2026): detalhamento por imobiliária, com %
                // sobre o total de cotações DAQUELA imobiliária (base =
                // im.total, novidades -- leitura mais direta de "cotações
                // realizadas"; diferente da base "todo o ativo do mês" usada
                // no quadro geral "Análise, recusa e negativação" acima).
                const linhas = gerencial.topImobiliarias.filter((im) => im.total > 0).sort((a, b) => b.total - a.total);
                return (
                  <section id="quadro-fianca-detalhe-imobiliaria" className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2>Detalhamento por imobiliária</h2>
                      <div className={styles.note}>% sobre o total de cotações de cada imobiliária no mês</div>
                      <ExportarQuadro
                        quadroId="quadro-fianca-detalhe-imobiliaria"
                        nomeArquivo={`seguro-fianca-detalhe-imobiliaria-${competencia}`}
                        dadosExcel={linhas.map((im) => ({
                          imobiliaria: im.nome,
                          cotacoes: im.total,
                          recusados: im.recusados,
                          pct_recusados: im.total > 0 ? (im.recusados / im.total) * 100 : 0,
                          negativados: im.perdidos,
                          pct_negativados: im.total > 0 ? (im.perdidos / im.total) * 100 : 0,
                          contratados: im.convertidos,
                          pct_contratados: im.total > 0 ? (im.convertidos / im.total) * 100 : 0,
                          em_andamento: im.emAndamento,
                        }))}
                        nomeAbaExcel="Detalhe imobiliária"
                      />
                    </div>
                    <div className={styles.panel}>
                      <DetalheImobiliariaTabela linhas={linhas} />
                    </div>
                  </section>
                );
              })()}

              {(() => {
                // Itens 2/3 (09/09/2026): taxa média (menor entre
                // seguradoras cotadas POR CARD, depois média entre os
                // cards), por imobiliária -- geral e só negativados.
                const linhas = gerencial.topImobiliarias.filter(
                  (im) => im.menorTaxaMediaGeral !== null || im.menorTaxaMediaNegativados !== null || im.taxaMediaConvertidos !== null
                );
                return (
                  <section id="quadro-fianca-taxa-imobiliaria" className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2>Taxa de locação por imobiliária (menor entre seguradoras)</h2>
                      <div className={styles.note}>por card, pega a menor taxa entre as seguradoras que cotaram; depois tira a média entre os cards</div>
                      <ExportarQuadro
                        quadroId="quadro-fianca-taxa-imobiliaria"
                        nomeArquivo={`seguro-fianca-taxa-imobiliaria-${competencia}`}
                        dadosExcel={[
                          { indicador: "Menor Taxa do Mês (negativados + contratados)", valor: gerencial.aba2Taxas.menor ?? "" },
                          { indicador: "Taxa Média do Mês (negativados + contratados)", valor: gerencial.aba2Taxas.media ?? "" },
                          ...linhas.map((im) => ({
                            imobiliaria: im.nome,
                            menor_taxa: im.menorTaxaGeral ?? "",
                            taxa_media_geral: im.menorTaxaMediaGeral ?? "",
                            taxa_media_negativados: im.menorTaxaMediaNegativados ?? "",
                            taxa_media_convertidos: im.taxaMediaConvertidos ?? "",
                          })),
                        ]}
                        nomeAbaExcel="Taxa por imobiliária"
                      />
                    </div>
                    <div className={styles.kpis} style={{ marginBottom: 16 }}>
                      <Kpi label="Menor Taxa do Mês" value={fmtPct(gerencial.aba2Taxas.menor)} sub="mínimo absoluto — negativados + contratados" />
                      <Kpi label="Taxa Média do Mês" value={fmtPct(gerencial.aba2Taxas.media)} sub={`média entre ${gerencial.aba2Taxas.n} card(s) — negativados + contratados`} />
                    </div>
                    <div className={styles.panel}>
                      <div className={styles.tableWrap}>
                        <table className={`${styles.data} ${styles.compacta}`}>
                          <thead>
                            <tr>
                              <th>Imobiliária</th>
                              <th className={styles.numCol}>Menor Taxa</th>
                              <th className={styles.numCol}>Taxa Média (geral)</th>
                              <th className={styles.numCol}>Taxa Média (negativados)</th>
                              <th className={styles.numCol}>Taxa Média (convertidos)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linhas.map((im) => (
                              <tr key={im.nome}>
                                <td>{im.nome}</td>
                                <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>{fmtPct(im.menorTaxaGeral)}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(im.menorTaxaMediaGeral)}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(im.menorTaxaMediaNegativados)}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(im.taxaMediaConvertidos)}</td>
                              </tr>
                            ))}
                            {linhas.length === 0 && (
                              <tr>
                                <td colSpan={5} style={{ color: "var(--ink-faint)" }}>Nenhuma taxa cotada neste período.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                );
              })()}

              {(() => {
                // Item 4 (09/09/2026): clientes novos = imobiliária cuja 1ª
                // cotação de toda a história caiu neste mês (calculado na
                // lib, ver clienteNovo em montarAnaliseGerencial).
                const linhas = gerencial.topImobiliarias.filter((im) => im.clienteNovo && im.total > 0).sort((a, b) => b.total - a.total);
                return (
                  <section id="quadro-fianca-clientes-novos" className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2>Clientes novos</h2>
                      <div className={styles.note}>imobiliárias cuja 1ª cotação de toda a história caiu neste mês</div>
                      <ExportarQuadro
                        quadroId="quadro-fianca-clientes-novos"
                        nomeArquivo={`seguro-fianca-clientes-novos-${competencia}`}
                        dadosExcel={linhas.map((im) => ({
                          imobiliaria: im.nome,
                          cotacoes: im.total,
                          recusados: im.recusados,
                          negativados: im.perdidos,
                          contratados: im.convertidos,
                          em_andamento: im.emAndamento,
                        }))}
                        nomeAbaExcel="Clientes novos"
                      />
                    </div>
                    <div className={styles.panel}>
                      <div className={styles.tableWrap}>
                        <table className={`${styles.data} ${styles.compacta}`}>
                          <thead>
                            <tr>
                              <th>Imobiliária</th>
                              <th className={styles.numCol}>Cotações</th>
                              <th className={styles.numCol}>Recusados</th>
                              <th className={styles.numCol}>Negativados</th>
                              <th className={styles.numCol}>Contratados</th>
                              <th className={styles.numCol}>Andamento</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linhas.map((im) => (
                              <tr key={im.nome}>
                                <td>{im.nome}</td>
                                <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>{im.total}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{im.recusados}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{im.perdidos}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{im.convertidos}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{im.emAndamento}</td>
                              </tr>
                            ))}
                            {linhas.length === 0 && (
                              <tr>
                                <td colSpan={6} style={{ color: "var(--ink-faint)" }}>Nenhum cliente novo neste período.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                );
              })()}

              {(() => {
                // Item 5 (09/09/2026): Top 10 crescimento/queda em cotações e
                // em conversões, comparando com o mês anterior completo
                // (ampliado de Top 5 pra Top 10 em 10/09/2026, pedido do Matheus).
                const nomes = new Set([...gerencial.topImobiliarias.map((im) => im.nome), ...topImobiliariasMesAnterior.map((im) => im.nome)]);
                const comparativo = [...nomes]
                  .filter((n) => n !== NOME_NAO_ADMINISTRADA)
                  .map((nome) => {
                    const atual = gerencial.topImobiliarias.find((im) => im.nome === nome);
                    const anterior = topImobiliariasMesAnterior.find((im) => im.nome === nome);
                    return {
                      nome,
                      cotAtual: atual?.total ?? 0,
                      cotAnterior: anterior?.total ?? 0,
                      convAtual: atual?.convertidos ?? 0,
                      convAnterior: anterior?.convertidos ?? 0,
                    };
                  });
                const porCotacoes = comparativo.map((c) => ({ nome: c.nome, delta: c.cotAtual - c.cotAnterior, atual: c.cotAtual, anterior: c.cotAnterior }));
                const porConversoes = comparativo.map((c) => ({ nome: c.nome, delta: c.convAtual - c.convAnterior, atual: c.convAtual, anterior: c.convAnterior }));
                const top10CresCot = [...porCotacoes].filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10);
                const top10QuedaCot = [...porCotacoes].filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);
                const top10CresConv = [...porConversoes].filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10);
                const top10QuedaConv = [...porConversoes].filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);
                const ListaTop10 = ({ titulo, itens }: { titulo: string; itens: { nome: string; delta: number; atual: number; anterior: number }[] }) => (
                  <div className={styles.panel}>
                    <h3>{titulo}</h3>
                    {itens.length === 0 ? (
                      <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhuma imobiliária nesse recorte.</div>
                    ) : (
                      <div className={styles.tableWrap}>
                        <table className={`${styles.data} ${styles.compacta}`}>
                          <thead>
                            <tr>
                              <th>Imobiliária</th>
                              <th className={styles.numCol}>Anterior</th>
                              <th className={styles.numCol}>Atual</th>
                              <th className={styles.numCol}>Variação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itens.map((i) => (
                              <tr key={i.nome}>
                                <td>{i.nome}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{i.anterior}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{i.atual}</td>
                                <td className={`${styles.numCol} ${styles.num}`} style={{ color: i.delta >= 0 ? "var(--info)" : "var(--negative)", fontWeight: 700 }}>
                                  {i.delta > 0 ? "+" : ""}{i.delta}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
                return (
                  <section id="quadro-fianca-top5-comparativo" className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2>Comparativo com o mês anterior — Top 10</h2>
                      <div className={styles.note}>maior crescimento e maior queda, em cotações e em conversões</div>
                      <ExportarQuadro
                        quadroId="quadro-fianca-top5-comparativo"
                        nomeArquivo={`seguro-fianca-top10-comparativo-${competencia}`}
                        dadosExcel={[
                          ...top10CresCot.map((i) => ({ recorte: "Maior crescimento em cotações", imobiliaria: i.nome, anterior: i.anterior, atual: i.atual, variacao: i.delta })),
                          ...top10QuedaCot.map((i) => ({ recorte: "Maior queda em cotações", imobiliaria: i.nome, anterior: i.anterior, atual: i.atual, variacao: i.delta })),
                          ...top10CresConv.map((i) => ({ recorte: "Maior crescimento em conversões", imobiliaria: i.nome, anterior: i.anterior, atual: i.atual, variacao: i.delta })),
                          ...top10QuedaConv.map((i) => ({ recorte: "Maior queda em conversões", imobiliaria: i.nome, anterior: i.anterior, atual: i.atual, variacao: i.delta })),
                        ]}
                        nomeAbaExcel="Top10 comparativo"
                      />
                    </div>
                    <div className={styles.grid2}>
                      <ListaTop10 titulo="Maior crescimento em cotações" itens={top10CresCot} />
                      <ListaTop10 titulo="Maior queda em cotações" itens={top10QuedaCot} />
                      <ListaTop10 titulo="Maior crescimento em conversões" itens={top10CresConv} />
                      <ListaTop10 titulo="Maior queda em conversões" itens={top10QuedaConv} />
                    </div>
                  </section>
                );
              })()}

              {(() => {
                // Item 6 (09/09/2026): entraram/sumiram entre os 2 meses --
                // "cotou" = total (novidades) > 0. Categoria fica de fora
                // (Fase 2, ainda sem critério definido).
                const nomesAtual = new Set(gerencial.topImobiliarias.filter((im) => im.total > 0 && im.nome !== NOME_NAO_ADMINISTRADA).map((im) => im.nome));
                const nomesAnterior = new Set(topImobiliariasMesAnterior.filter((im) => im.total > 0 && im.nome !== NOME_NAO_ADMINISTRADA).map((im) => im.nome));
                const entraram = [...nomesAtual].filter((n) => !nomesAnterior.has(n)).sort();
                const sairam = [...nomesAnterior].filter((n) => !nomesAtual.has(n)).sort();
                return (
                  <section id="quadro-fianca-entraram-sumiram" className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2>Entraram e sumiram</h2>
                      <div className={styles.note}>imobiliárias que cotaram só num dos 2 meses — categoria por tier ainda não existe (Fase 2)</div>
                      <ExportarQuadro
                        quadroId="quadro-fianca-entraram-sumiram"
                        nomeArquivo={`seguro-fianca-entraram-sumiram-${competencia}`}
                        dadosExcel={[
                          ...entraram.map((nome) => ({ imobiliaria: nome, situacao: "Entrou este mês" })),
                          ...sairam.map((nome) => ({ imobiliaria: nome, situacao: "Sumiu este mês" })),
                        ]}
                        nomeAbaExcel="Entraram e sumiram"
                      />
                    </div>
                    <div className={styles.grid2}>
                      <div className={styles.panel}>
                        <h3>Cotaram só este mês ({entraram.length})</h3>
                        {entraram.length === 0 ? (
                          <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhuma.</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {entraram.map((nome) => <li key={nome}>{nome}</li>)}
                          </ul>
                        )}
                      </div>
                      <div className={styles.panel}>
                        <h3>Cotaram só no mês anterior ({sairam.length})</h3>
                        {sairam.length === 0 ? (
                          <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhuma.</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {sairam.map((nome) => <li key={nome}>{nome}</li>)}
                          </ul>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })()}

              {(() => {
                // Aba 3 (09/09/2026): ranking de quem mais contratou no mês.
                // "Não Administrada" não compete em rankings/comparativos
                // (não é uma imobiliária de verdade) -- só entra como linha
                // própria nas tabelas informativas (pedido do Matheus).
                const linhas = gerencial.topImobiliarias
                  .filter((im) => im.convertidos > 0 && im.nome !== NOME_NAO_ADMINISTRADA)
                  .sort((a, b) => b.convertidos - a.convertidos);
                return (
                  <section id="quadro-fianca-ranking-contratacoes" className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2>Ranking de contratações no mês</h2>
                      <div className={styles.note}>imobiliárias que fecharam contrato, da que mais fechou pra que menos fechou</div>
                      <ExportarQuadro
                        quadroId="quadro-fianca-ranking-contratacoes"
                        nomeArquivo={`seguro-fianca-ranking-contratacoes-${competencia}`}
                        dadosExcel={linhas.map((im) => ({ imobiliaria: im.nome, contratos_fechados: im.convertidos }))}
                        nomeAbaExcel="Ranking contratações"
                      />
                    </div>
                    <div className={styles.panel}>
                      <div className={styles.barlist}>
                        {linhas.map((im) => (
                          <BarraProporcional key={im.nome} label={im.nome} value={im.convertidos} max={linhas[0]?.convertidos ?? 1} />
                        ))}
                        {linhas.length === 0 && <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhum contrato fechado neste período.</div>}
                      </div>
                    </div>
                  </section>
                );
              })()}

              {(() => {
                // Item 8 (09/09/2026): prêmio líquido e comissão por
                // imobiliária, mês vigente × anterior, absoluto e %. "Não
                // Administrada" fica de fora (não compete como imobiliária),
                // inclusive do total usado como base do %.
                const nomes = new Set(
                  [...gerencial.topImobiliarias.map((im) => im.nome), ...topImobiliariasMesAnterior.map((im) => im.nome)].filter(
                    (n) => n !== NOME_NAO_ADMINISTRADA
                  )
                );
                const totalAtual = gerencial.topImobiliarias.filter((im) => im.nome !== NOME_NAO_ADMINISTRADA).reduce((a, im) => a + im.premioEfetivado, 0);
                const totalAnterior = topImobiliariasMesAnterior
                  .filter((im) => im.nome !== NOME_NAO_ADMINISTRADA)
                  .reduce((a, im) => a + im.premioEfetivado, 0);
                const linhas = [...nomes]
                  .map((nome) => {
                    const atual = gerencial.topImobiliarias.find((im) => im.nome === nome);
                    const anterior = topImobiliariasMesAnterior.find((im) => im.nome === nome);
                    return {
                      nome,
                      premioAtual: atual?.premioEfetivado ?? 0,
                      comissaoAtual: atual?.comissaoEfetivada ?? 0,
                      premioAnterior: anterior?.premioEfetivado ?? 0,
                      pctAtual: totalAtual > 0 ? ((atual?.premioEfetivado ?? 0) / totalAtual) * 100 : 0,
                      pctAnterior: totalAnterior > 0 ? ((anterior?.premioEfetivado ?? 0) / totalAnterior) * 100 : 0,
                    };
                  })
                  .filter((l) => l.premioAtual > 0 || l.premioAnterior > 0)
                  .sort((a, b) => b.premioAtual - a.premioAtual);
                return (
                  <section id="quadro-fianca-premio-imobiliaria" className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2>Prêmio líquido e comissão por imobiliária — mês × mês</h2>
                      <div className={styles.note}>participação de cada imobiliária no total efetivado do mês, em valor absoluto e %</div>
                      <ExportarQuadro
                        quadroId="quadro-fianca-premio-imobiliaria"
                        nomeArquivo={`seguro-fianca-premio-imobiliaria-${competencia}`}
                        dadosExcel={linhas.map((l) => ({
                          imobiliaria: l.nome,
                          premio_liquido_atual: l.premioAtual,
                          pct_atual: l.pctAtual,
                          premio_liquido_anterior: l.premioAnterior,
                          pct_anterior: l.pctAnterior,
                        }))}
                        nomeAbaExcel="Prêmio por imobiliária"
                      />
                    </div>
                    <div className={styles.panel}>
                      <div className={styles.tableWrap}>
                        <table className={`${styles.data} ${styles.compacta}`}>
                          <thead>
                            <tr>
                              <th>Imobiliária</th>
                              <th className={styles.numCol}>Prêmio Líquido (mês)</th>
                              <th className={styles.numCol}>% do mês</th>
                              <th className={styles.numCol}>Comissão (mês)</th>
                              <th className={styles.numCol}>Prêmio Líquido (anterior)</th>
                              <th className={styles.numCol}>% do anterior</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linhas.map((l) => (
                              <tr key={l.nome}>
                                <td>{l.nome}</td>
                                <td className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>{fmtBRL(l.premioAtual)}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(l.pctAtual)}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(l.comissaoAtual)}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(l.premioAnterior)}</td>
                                <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(l.pctAnterior)}</td>
                              </tr>
                            ))}
                            {linhas.length === 0 && (
                              <tr>
                                <td colSpan={6} style={{ color: "var(--ink-faint)" }}>Nenhum prêmio efetivado nos 2 meses.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                );
              })()}
              </AbaSlot>

              <AbaSlot aba="visao-geral">
              <section id="quadro-fianca-qualidade" className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Qualidade dos dados</h2>
                  <ExportarQuadro quadroId="quadro-fianca-qualidade" nomeArquivo={`seguro-fianca-qualidade-${competencia}`} />
                </div>
                {(() => {
                  // Cada métrica é uma dimensão de preenchimento independente (um
                  // card pode faltar em mais de uma ao mesmo tempo) -- não soma
                  // valores entre si, só usa "algum alerta existe" pra decidir o
                  // selo. Os números de funil (recusados/aprovados/convertidos/
                  // etc., no topo da página) vêm do status real do card e não são
                  // afetados por nenhum desses alertas de preenchimento.
                  const algumAlerta =
                    gerencial.qualidade.semImobiliaria > 0 ||
                    gerencial.qualidade.perdidosFunil2SemMotivo > 0 ||
                    gerencial.qualidade.saiuFunil1SemHoraFim > 0 ||
                    gerencial.qualidade.semResponsavelCotacao > 0 ||
                    gerencial.qualidade.semResponsavelNegociacao > 0 ||
                    gerencial.qualidade.semResponsavelEfetivacao > 0;
                  return (
                    <div className={`${styles.stampPanel} ${algumAlerta ? styles.stampPanelWarning : ""}`}>
                      <div className={`${styles.stampBadge} ${algumAlerta ? styles.stampBadgeWarning : ""}`}>
                        {algumAlerta ? (
                          <>
                            ATENÇÃO
                            <br />
                            PREENCHIMENTO
                          </>
                        ) : (
                          <>
                            DADOS
                            <br />
                            COMPLETOS
                          </>
                        )}
                      </div>
                      <div className={styles.stampList}>
                        <div>
                          {Math.round(((gerencial.kpis.total - gerencial.qualidade.semImobiliaria) / Math.max(gerencial.kpis.total, 1)) * 100)}% dos cards (
                          {gerencial.kpis.total - gerencial.qualidade.semImobiliaria} de {gerencial.kpis.total}) têm imobiliária/empresa vinculada no CRM.
                        </div>
                        <div>
                          {gerencial.motivosPerdaFunil2.total > 0
                            ? `${Math.round(((gerencial.motivosPerdaFunil2.total - gerencial.qualidade.perdidosFunil2SemMotivo) / gerencial.motivosPerdaFunil2.total) * 100)}% das negativações em Negociação e Contrato (${gerencial.motivosPerdaFunil2.total - gerencial.qualidade.perdidosFunil2SemMotivo} de ${gerencial.motivosPerdaFunil2.total}) têm motivo registrado. `
                            : "Nenhuma perda em Negociação e Contrato ainda este mês. "}
                          Recusas em Análise e Cotação não exigem motivo — são decisão de compliance da própria seguradora, não do time.
                        </div>
                        {gerencial.qualidade.saiuFunil1SemHoraFim > 0 && (
                          <div>{gerencial.qualidade.saiuFunil1SemHoraFim} card(s) já recusado(s)/aprovado(s) em Análise e Cotação sem HORA FIM da cotação registrada.</div>
                        )}
                        {gerencial.qualidade.semResponsavelCotacao > 0 && (
                          <div>{gerencial.qualidade.semResponsavelCotacao} card(s) sem Responsável(is) pela Cotação preenchido.</div>
                        )}
                        {gerencial.qualidade.semResponsavelNegociacao > 0 && (
                          <div>
                            {gerencial.qualidade.semResponsavelNegociacao} card(s) que já entraram em &quot;Contrato Recebido&quot; sem Responsável(is) pela Negociação preenchido.
                          </div>
                        )}
                        {gerencial.qualidade.semResponsavelEfetivacao > 0 && (
                          <div>{gerencial.qualidade.semResponsavelEfetivacao} card(s) com Data de Efetivação preenchida sem Responsável pela Efetivação.</div>
                        )}
                        {gerencial.qualidade.naoAdministrados > 0 && (
                          <div style={{ color: "var(--ink-faint)" }}>
                            {gerencial.qualidade.naoAdministrados} card(s) marcados como &quot;Não Administrada&quot; (proprietário direto, sem imobiliária) — informativo, não é alerta.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </section>
              </AbaSlot>

              <footer className={styles.footer}>
                Fonte: Bitrix24, SPA &quot;Seguro Fiança&quot; (entityTypeId {ENTITY_TYPE_ID}), funis &quot;Análise e Cotação&quot; ({CATEGORIA_ANALISE}) e &quot;Negociação e Contrato&quot; ({CATEGORIA_NEGOCIACAO}
                ), via webhook de leitura. {gerencial.totalMovimentacoes} movimentações de etapa registradas no histórico nativo do CRM. &quot;Produtividade&quot; conta o responsável ATUAL de cada
                card — o CRM não guarda histórico de troca de responsável via API, só de troca de etapa. &quot;Valores trabalhados&quot; mostram volume de trabalho, não receita da corretora;
                receita real só existe a partir do prêmio líquido e comissão de contratos convertidos.
              </footer>
            </AbasProvider>
          )}
        </div>
      </div>
    </>
  );
}
