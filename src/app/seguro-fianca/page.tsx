import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import SeletorCompetencia from "./SeletorCompetencia";
import AtualizarAgora from "./AtualizarAgora";
import ImobiliariasTabela from "./ImobiliariasTabela";
import styles from "./seguro-fianca.module.css";
import {
  buscarDefinicaoCampos,
  buscarEmpresas,
  buscarUsuarios,
  listarHistoricoEtapas,
  listarItensSpa,
} from "@/lib/bitrix/client";
import {
  CATEGORIA_ANALISE,
  CATEGORIA_NEGOCIACAO,
  ENTITY_TYPE_ID,
  ETAPAS,
  SEGURADORAS,
  idsResponsaveisEtapas,
  montarAnaliseGerencial,
  montarContagemMensal,
  normalizarQuadroDiario,
  type AnaliseGerencial,
  type QuadroDiario,
} from "@/lib/bitrix/seguroFianca";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}
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
  return {
    ...payload,
    analisesDiariasPorResponsavel: normalizarQuadroDiario(payload.analisesDiariasPorResponsavel, competencia),
    contratosRecebidosPorDia: normalizarQuadroDiario(payload.contratosRecebidosPorDia, competencia),
    efetivacoesPorDia: normalizarQuadroDiario(payload.efetivacoesPorDia, competencia),
  };
}

async function buscarDadosAoVivo(competencia: string): Promise<AnaliseGerencial & { totalMovimentacoes: number }> {
  const [items, historico, defs] = await Promise.all([
    listarItensSpa(ENTITY_TYPE_ID),
    listarHistoricoEtapas(ENTITY_TYPE_ID),
    buscarDefinicaoCampos(ENTITY_TYPE_ID),
  ]);

  const idsEmpresa = items.map((it) => it.companyId).filter((id): id is number => !!id);
  const idsUsuario = items
    .flatMap((it) => [it.assignedById, it.createdBy, it.movedBy, ...idsResponsaveisEtapas(it)])
    .filter((id): id is number => !!id);
  const [empresas, usuarios] = await Promise.all([buscarEmpresas(idsEmpresa), buscarUsuarios(idsUsuario)]);

  const contagem = montarContagemMensal(items, historico, usuarios, empresas, defs);
  const gerencial = montarAnaliseGerencial(contagem, historico, competencia);
  return { ...gerencial, totalMovimentacoes: historico.length };
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

  if (categoria === CATEGORIA_ANALISE) {
    if (gerencial.kpis.aprovados > 0) {
      segmentos.push({ label: "Aprovado p/ Negociação e Contrato", value: gerencial.kpis.aprovados, classe: styles.segInfo });
    }
    if (gerencial.kpis.recusados > 0) {
      segmentos.push({ label: "Recusado", value: gerencial.kpis.recusados, classe: styles.segNeg });
    }
  } else {
    if (gerencial.kpis.convertidos > 0) {
      segmentos.push({ label: "Convertido", value: gerencial.kpis.convertidos, classe: styles.segInfo });
    }
    if (gerencial.kpis.perdidos > 0) {
      segmentos.push({ label: "Perdido", value: gerencial.kpis.perdidos, classe: styles.segNeg });
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

function ProdutividadeTabela({ dados }: { dados: AnaliseGerencial["porResponsavelFunil1"] }) {
  const linhas = Object.entries(dados).sort((a, b) => b[1].cards - a[1].cards);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.data}>
        <thead>
          <tr>
            <th>Responsável</th>
            <th className={styles.numCol}>Cards</th>
            <th className={styles.numCol}>Andamento</th>
            <th className={styles.numCol}>Negativos</th>
            <th className={styles.numCol}>Positivos</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(([nome, d]) => (
            <tr key={nome}>
              <td>{nome}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.cards}</td>
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

// Tabela "Data × Responsável" compartilhada pelos 3 quadros diários
// (cotações concluídas, contratos recebidos, efetivações) -- mesma forma
// desde que passaram a usar os campos de responsável por etapa.
function QuadroDiarioTabela({ quadro }: { quadro: QuadroDiario }) {
  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.data}>
          <thead>
            <tr>
              <th>Data</th>
              <th className={styles.numCol}>Quant.</th>
              {quadro.responsaveis.map((nome) => (
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
                {quadro.responsaveis.map((nome) => (
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
              {quadro.responsaveis.map((nome) => (
                <td key={nome} className={`${styles.numCol} ${styles.num}`} style={{ fontWeight: 700 }}>
                  {quadro.dias.reduce((a, d) => a + (d.porResponsavel[nome] ?? 0), 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {quadro.responsaveis.length === 0 && (
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
      gerencial = await comLimiteDeTempo(buscarDadosAoVivo(competencia), LIMITE_TEMPO_AO_VIVO_MS);
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

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <div className={styles.wrap}>
        <div className={styles.container}>
          <div className={styles.masthead}>
            <div>
              <div className={styles.eyebrow}>O2 Seguros · Central de Negócios · SPA Seguro Fiança</div>
              <h1 className={styles.title}>Painel de Produção — {competencia}</h1>
            </div>
            <div className={styles.meta}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                <SeletorCompetencia competencia={competencia} />
                {ehCompetenciaAtual && <AtualizarAgora />}
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
            <>
              <div className={styles.kpis}>
                <Kpi label="Total de Cards" value={String(gerencial.kpis.total)} sub="entradas no mês" />
                <Kpi label="Em Andamento" value={String(gerencial.kpis.emAndamento)} sub="ainda sendo trabalhados, nos dois funis" tone="positive" />
                <Kpi label="Recusados" value={String(gerencial.kpis.recusados)} sub="não avançaram em Análise e Cotação" tone="negative" />
                <Kpi label="Aprovados" value={String(gerencial.kpis.aprovados)} sub="saíram de Análise e Cotação p/ Negociação" tone="info" />
                <Kpi label="Perdidos" value={String(gerencial.kpis.perdidos)} sub="não fecharam em Negociação e Contrato" tone="negative" />
                <Kpi label="Convertidos" value={String(gerencial.kpis.convertidos)} sub="contrato fechado" />
                <Kpi
                  label="Cards com Alerta"
                  value={String(gerencial.kpis.comAlerta)}
                  sub={`${Math.round((gerencial.kpis.comAlerta / Math.max(gerencial.kpis.total, 1)) * 100)}% — ver qualidade dos dados`}
                  tone={gerencial.kpis.comAlerta / Math.max(gerencial.kpis.total, 1) > 0.2 ? "warning" : "positive"}
                />
                <Kpi label="Imobiliárias" value={String(gerencial.kpis.imobiliarias)} sub="enviaram cotação no período" />
              </div>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Distribuição por funil e etapa</h2>
                  <div className={styles.note}>{gerencial.kpis.total} cards</div>
                </div>
                <div className={styles.panel}>
                  <div className={styles.stackGroup}>
                    <div className={styles.glabel}>
                      <span>Análise e Cotação — resultado de todos que passaram por aqui</span>
                      <span className={styles.num}>{gerencial.kpis.total} cards</span>
                    </div>
                    <StackBar segments={construirSegmentosFunil(gerencial, CATEGORIA_ANALISE)} total={gerencial.kpis.total} />
                  </div>
                  <div className={styles.stackGroup}>
                    <div className={styles.glabel}>
                      <span>Negociação e Contrato — situação atual dos encaminhados</span>
                      <span className={styles.num}>{gerencial.kpis.aprovados} cards</span>
                    </div>
                    <StackBar segments={construirSegmentosFunil(gerencial, CATEGORIA_NEGOCIACAO)} total={gerencial.kpis.aprovados} />
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legendItem}>
                      <span className={styles.swatch} style={{ background: "var(--accent)" }} /> Em andamento
                    </div>
                    <div className={styles.legendItem}>
                      <span className={styles.swatch} style={{ background: "var(--info)" }} /> Aprovado/Convertido
                    </div>
                    <div className={styles.legendItem}>
                      <span className={styles.swatch} style={{ background: "var(--negative)" }} /> Recusado/Perdido
                    </div>
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Análise por seguradora e plano</h2>
                  <div className={styles.note}>status de cotação — Porto e Pottencial têm mais de um plano cotado por card</div>
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

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Produtividade por responsável, por funil</h2>
                  <div className={styles.note}>
                    Análise e Cotação: Responsável(is) pela Cotação, ou pelo Cadastro se a cotação ainda não foi atribuída. Negociação e
                    Contrato: Responsável(is) pela Negociação. Nunca o dono atual do card.
                  </div>
                </div>
                <div className={styles.grid2}>
                  <div className={styles.panel}>
                    <h3>Análise e Cotação</h3>
                    <div className={styles.panelSub}>Positivos = card que essa pessoa encaminhou pro funil 2 (crédito de quem concluiu, não de quem só criou)</div>
                    <ProdutividadeTabela dados={gerencial.porResponsavelFunil1} />
                  </div>
                  <div className={styles.panel}>
                    <h3>Negociação e Contrato</h3>
                    <div className={styles.panelSub}>{gerencial.kpis.aprovados} cards encaminhados</div>
                    <ProdutividadeTabela dados={gerencial.porResponsavelFunil2} />
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Taxa média da parcela sobre o pacote de locação</h2>
                  <div className={styles.note}>parcela do seguro ÷ pacote de locação, por seguradora — só nos cards cotados</div>
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

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Cotado vs. Convertido, por seguradora</h2>
                  <div className={styles.note}>todo prêmio cotado até agora contra o que já foi efetivamente convertido</div>
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
                          <td className={`${styles.numCol} ${styles.num}`}>{gerencial.kpis.convertidos}</td>
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

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Valores trabalhados no mês</h2>
                  <div className={styles.note}>não é receita — ver nota no rodapé</div>
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

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Tempo de ciclo por funil</h2>
                  <div className={styles.note}>do início até sair de cada funil (aprovado/recusado em Análise e Cotação, convertido/perdido em Negociação e Contrato)</div>
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
                    "Cards" aqui conta quem já tem esse tempo definido — Negociação e Contrato só existe pra quem foi aprovado em Análise e Cotação.
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Tempo de cotação por responsável</h2>
                  <div className={styles.note}>
                    HORA INICIO → HORA FIM da fase de cotação, por Responsável(is) pela Cotação — separado por resultado porque recusar é mais rápido que cotar de verdade
                  </div>
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

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Quadros diários por responsável de etapa</h2>
                  <div className={styles.note}>campos de responsável por etapa, adicionados em 17/08/2026 — meses anteriores a essa data ficam vazios aqui</div>
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
                      cards que entraram na etapa &quot;Contrato Recebido&quot; (Negociação e Contrato), por Responsável(is) pela Negociação — sem o campo preenchido vira alerta em &quot;Qualidade dos dados&quot;, não entra na quebra por pessoa
                    </div>
                    <QuadroDiarioTabela quadro={gerencial.contratosRecebidosPorDia} />
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

              <section className={styles.section}>
                <div className={styles.grid2}>
                  <div className={styles.panel}>
                    <h3>Tempo em aberto por etapa</h3>
                    <div className={styles.panelSub}>tempo de cada passagem pela etapa (se o card voltou, conta mais de uma vez)</div>
                    <div className={styles.tableWrap}>
                      <table className={styles.data}>
                        <thead>
                          <tr>
                            <th>Etapa</th>
                            <th className={styles.numCol}>Passagens</th>
                            <th className={styles.numCol}>Média</th>
                            <th className={styles.numCol}>Máx.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(gerencial.tempoPorEtapa).map(([etapa, t]) => (
                            <tr key={etapa}>
                              <td>{etapa}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{t.n}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(t.media)}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(t.max)}</td>
                            </tr>
                          ))}
                          {Object.keys(gerencial.tempoPorEtapa).length === 0 && (
                            <tr>
                              <td colSpan={4} style={{ color: "var(--ink-faint)" }}>
                                Nenhum card em aberto neste período.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className={styles.panel}>
                    <h3>Cards que pedem atenção</h3>
                    <div className={styles.panelSub}>parado pelo menos 30% mais que a média da própria etapa</div>
                    <div className={styles.tableWrap}>
                      <table className={styles.data}>
                        <thead>
                          <tr>
                            <th>Card</th>
                            <th>Etapa</th>
                            <th className={styles.numCol}>Tempo</th>
                            <th>Responsável</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gerencial.cardsQuePedemAtencao.map((c) => (
                            <tr key={c.id}>
                              <td>
                                #{c.id} {c.nome}
                              </td>
                              <td>{c.etapa}</td>
                              <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(c.minutos)}</td>
                              <td>{c.responsavel}</td>
                            </tr>
                          ))}
                          {gerencial.cardsQuePedemAtencao.length === 0 && (
                            <tr>
                              <td colSpan={4} style={{ color: "var(--ink-faint)" }}>
                                Nenhum card fora do padrão da própria etapa.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Motivos de recusa/perda</h2>
                  <div className={styles.note}>
                    {gerencial.motivosRecusaFunil1.total} recusados em Análise e Cotação + {gerencial.motivosPerdaFunil2.total} perdidos em Negociação e Contrato
                  </div>
                </div>
                <div className={styles.grid2}>
                  <div className={styles.panel}>
                    <h3>Recusas — Análise e Cotação</h3>
                    <div className={styles.panelSub}>decisão de compliance da seguradora, sem motivo interno esperado</div>
                    <div className={styles.barlist}>
                      <BarraProporcional label="Total de recusas" value={gerencial.motivosRecusaFunil1.total} max={Math.max(gerencial.motivosRecusaFunil1.total, 1)} />
                    </div>
                  </div>
                  <div className={styles.panel}>
                    <h3>Perdas — Negociação e Contrato</h3>
                    <div className={styles.panelSub}>{gerencial.motivosPerdaFunil2.total} cards perdidos</div>
                    <div className={styles.barlist}>
                      {Object.entries(gerencial.motivosPerdaFunil2.porMotivo).map(([motivo, n]) => (
                        <BarraProporcional key={motivo} label={motivo} value={n} max={gerencial.motivosPerdaFunil2.total} />
                      ))}
                      {gerencial.motivosPerdaFunil2.semMotivo > 0 && (
                        <BarraProporcional label="Sem motivo registrado" value={gerencial.motivosPerdaFunil2.semMotivo} max={gerencial.motivosPerdaFunil2.total} warning />
                      )}
                      {gerencial.motivosPerdaFunil2.total === 0 && (
                        <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhuma perda registrada neste período.</div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Imobiliárias — status de todos os cards</h2>
                  <div className={styles.note}>{gerencial.kpis.imobiliarias} imobiliárias com pelo menos 1 cotação no período</div>
                </div>
                <div className={styles.panel}>
                  <ImobiliariasTabela imobiliarias={gerencial.topImobiliarias} />
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Qualidade dos dados</h2>
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
                            ? `${Math.round(((gerencial.motivosPerdaFunil2.total - gerencial.qualidade.perdidosFunil2SemMotivo) / gerencial.motivosPerdaFunil2.total) * 100)}% das perdas em Negociação e Contrato (${gerencial.motivosPerdaFunil2.total - gerencial.qualidade.perdidosFunil2SemMotivo} de ${gerencial.motivosPerdaFunil2.total}) têm motivo registrado. `
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
                      </div>
                    </div>
                  );
                })()}
              </section>

              <footer className={styles.footer}>
                Fonte: Bitrix24, SPA &quot;Seguro Fiança&quot; (entityTypeId {ENTITY_TYPE_ID}), funis &quot;Análise e Cotação&quot; ({CATEGORIA_ANALISE}) e &quot;Negociação e Contrato&quot; ({CATEGORIA_NEGOCIACAO}
                ), via webhook de leitura. {gerencial.totalMovimentacoes} movimentações de etapa registradas no histórico nativo do CRM. &quot;Produtividade&quot; conta o responsável ATUAL de cada
                card — o CRM não guarda histórico de troca de responsável via API, só de troca de etapa. &quot;Valores trabalhados&quot; mostram volume de trabalho, não receita da corretora;
                receita real só existe a partir do prêmio líquido e comissão de contratos convertidos.
              </footer>
            </>
          )}
        </div>
      </div>
    </>
  );
}
