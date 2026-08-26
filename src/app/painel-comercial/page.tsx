import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import SeletorCompetencia from "./SeletorCompetencia";
import AtualizarAgora from "../seguro-fianca/AtualizarAgora";
import styles from "./painel-comercial.module.css";
import {
  buscarKpisComercialAoVivo,
  montarKpisComercial,
  type DistribuicaoEtapa,
  type KpisComercial,
  type RegistroResponsavel,
} from "@/lib/bitrix/comercial";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Kpis = KpisComercial & { totalEventos: number };

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function fmtPct(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

// Timeout do Vercel é 60s e MATA a função sem rodar catch nenhum -- não dá
// pra reagir a isso depois que acontece. Corta a busca ao vivo antes disso
// (com folga pra ainda dar tempo de consultar o retrato salvo e responder)
// em vez de deixar o Bitrix decidir quando a página quebra. Mesmo padrão de
// /seguro-fianca.
const LIMITE_TEMPO_AO_VIVO_MS = 40_000;

function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado após ${Math.round(ms / 1000)}s buscando no Bitrix`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer)) as Promise<T>;
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

function BarraProporcional({ label, value, max, formatted, warning }: { label: string; value: number; max: number; formatted?: string; warning?: boolean }) {
  const pctLargura = Math.max(2, (value / Math.max(max, 1)) * 100);
  return (
    <div className={styles.barrow}>
      <div className={styles.rlabel}>{label}</div>
      <div className={styles.track}>
        <div className={`${styles.fill} ${warning ? styles.fillWarning : ""}`} style={{ width: `${pctLargura}%` }} />
      </div>
      <div className={`${styles.rvalue} ${styles.num}`}>{formatted ?? value}</div>
    </div>
  );
}

function DistribuicaoEtapaBarras({ dados }: { dados: DistribuicaoEtapa[] }) {
  const max = Math.max(...dados.map((d) => d.cards), 1);
  return (
    <div className={styles.barlist}>
      {dados.map((d) => (
        <BarraProporcional key={d.etapa} label={d.etapa} value={d.cards} max={max} />
      ))}
      {dados.every((d) => d.cards === 0) && <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhum card aberto neste período.</div>}
    </div>
  );
}

// Tabela genérica "Responsável × R1-R11" -- usada tanto pra Ativação quanto
// pra Sucesso do Cliente (mesmas colunas, filtro de funil já aplicado antes
// de chegar aqui).
function PorResponsavelTabela({ dados }: { dados: RegistroResponsavel[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.data}>
        <thead>
          <tr>
            <th>Responsável</th>
            <th className={styles.numCol}>Carteira (R1)</th>
            <th className={styles.numCol}>Trabalhados (R2)</th>
            <th className={styles.numCol}>Cobertura (R3)</th>
            <th className={styles.numCol}>Ganhos (R4)</th>
            <th className={styles.numCol}>Perdas (R5)</th>
            <th className={styles.numCol}>Mud. Etapa (R6)</th>
            <th className={styles.numCol}>Atividades (R7)</th>
            <th className={styles.numCol}>Ligações (R8)</th>
            <th className={styles.numCol}>Tarefas (R9)</th>
            <th className={styles.numCol}>Vencidos (R10)</th>
            <th className={styles.numCol}>Sem Trabalho (R11)</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.responsavel}>
              <td>{d.responsavel}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.r1_carteiraAtual}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.r2_cardsTrabalhados}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(d.r3_coberturaTrabalhoPct)}</td>
              <td className={`${styles.numCol} ${styles.num}`}>
                <span className={`${styles.pill} ${styles.pillPositive}`}>{d.r4_ganhosAtribuidos}</span>
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>
                <span className={`${styles.pill} ${styles.pillNegative}`}>{d.r5_perdasFinaisAtribuidas}</span>
              </td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.r6_mudancasDeEtapa}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.r7_atividadesRegistradas}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.r8_ligacoesRegistradas}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.r9_tarefasRegistradas}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.r10_cardsVencidos}</td>
              <td className={`${styles.numCol} ${styles.num}`}>{d.r11_cardsSemTrabalho}</td>
            </tr>
          ))}
          {dados.length === 0 && (
            <tr>
              <td colSpan={12} style={{ color: "var(--ink-faint)" }}>
                Nenhum card neste funil no período.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function PainelComercialPage({
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

  let kpis: Kpis | null = null;
  let atualizadoEm: string | null = null;
  let erro: string | null = null;
  let semRegistroNoPeriodo = false;
  let usandoRetratoSalvo = false;

  if (ehCompetenciaAtual) {
    try {
      kpis = await comLimiteDeTempo(buscarKpisComercialAoVivo(competencia), LIMITE_TEMPO_AO_VIVO_MS);
      atualizadoEm = new Date().toISOString();
      const { error: erroUpsert } = await supabase
        .from("comercial_kpis_snapshots")
        .upsert({ competencia, atualizado_em: atualizadoEm, payload: kpis }, { onConflict: "competencia" });
      if (erroUpsert) {
        console.error("Falha ao salvar snapshot do Painel Comercial no Supabase:", erroUpsert);
      }
    } catch (e) {
      erro = e instanceof Error ? e.message : "Falha ao buscar dados do Bitrix.";
      // Busca ao vivo falhou (ou estourou o limite) -- cai pro último
      // retrato salvo (se existir), mesmo padrão de /seguro-fianca.
      const { data } = await supabase
        .from("comercial_kpis_snapshots")
        .select("payload, atualizado_em")
        .eq("competencia", competencia)
        .maybeSingle();
      if (data) {
        kpis = data.payload as Kpis;
        atualizadoEm = data.atualizado_em;
        usandoRetratoSalvo = true;
      }
    }
  } else {
    const { data } = await supabase.from("comercial_kpis_snapshots").select("payload, atualizado_em").eq("competencia", competencia).maybeSingle();
    if (data) {
      kpis = data.payload as Kpis;
      atualizadoEm = data.atualizado_em;
    } else {
      // Nenhum snapshot foi salvo pra essa competência (a página nunca foi
      // aberta, ou o cron ainda não rodou pra ela) -- mostra os painéis
      // normalmente, todos zerados, em vez de tela em branco. É uma
      // informação real (zero cards registrados nesse período), não falta
      // de dado.
      kpis = { ...montarKpisComercial([], [], competencia), totalEventos: 0 };
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
              <div className={styles.eyebrow}>O2 Seguros · Central de Negócios · Painel Comercial</div>
              <h1 className={styles.title}>Ativação &amp; Sucesso do Cliente — {competencia}</h1>
            </div>
            <div className={styles.meta}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                <SeletorCompetencia competencia={competencia} />
                {ehCompetenciaAtual && <AtualizarAgora />}
              </div>
              <br />
              {atualizadoEm && <>Atualizado em {new Date(atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>}
              {semRegistroNoPeriodo && <>Nenhum snapshot salvo nesta competência</>}
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

          {/* Aviso obrigatório (spec KPIs Comercial, seção 1.4): todo KPI
              agrupado por responsável usa o responsável ATUAL do card, nunca
              quem de fato executou a ação. */}
          <div className={styles.stampPanel} style={{ marginBottom: 24 }}>
            <div className={styles.stampBadge}>LEIA ANTES</div>
            <div className={styles.stampList}>
              <div>Os resultados são agrupados pelo responsável atual do card. A atividade pode ter sido executada por outro colaborador.</div>
            </div>
          </div>

          {kpis && (
            <>
              {/* ---------------------------------------------------------- */}
              {/* Ativação Novos Clientes                                    */}
              {/* ---------------------------------------------------------- */}
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px", color: "var(--ink)" }}>Ativação Novos Clientes</h2>

              <div className={styles.kpis}>
                <Kpi label="Cards Trabalhados (A1)" value={String(kpis.ativacao.a1_cardsTrabalhados)} sub="com alteração efetiva no mês" tone="positive" />
                <Kpi label="Estoque Atual (A2)" value={String(kpis.ativacao.a2_estoqueAtual)} sub="cards abertos agora, neste funil" />
                <Kpi
                  label="Sem Alteração (A3)"
                  value={String(kpis.ativacao.a3_semAlteracaoEfetiva)}
                  sub="do estoque atual, parados no mês"
                  tone={kpis.ativacao.a3_semAlteracaoEfetiva / Math.max(kpis.ativacao.a2_estoqueAtual, 1) > 0.3 ? "warning" : undefined}
                />
                <Kpi label="Ativações Concluídas (A4)" value={String(kpis.ativacao.a4_ativacoesConcluidas)} sub="transferidas p/ Sucesso ou ganhas no mês" tone="positive" />
                <Kpi label="Perdas Finais (A5)" value={String(kpis.ativacao.a5_perdasFinais)} sub="encerradas como perda no mês" tone="negative" />
                <Kpi label="Aproveitamento Mensal (A6)" value={fmtPct(kpis.ativacao.a6_aproveitamentoMensalPct)} sub="concluídas ÷ cards trabalhados" />
                <Kpi
                  label="Taxa de Sucesso dos Desfechos (A7)"
                  value={kpis.ativacao.a7_taxaSucessoDesfechosPct !== null ? fmtPct(kpis.ativacao.a7_taxaSucessoDesfechosPct) : "—"}
                  sub={`${kpis.ativacao.a4_ativacoesConcluidas} de ${kpis.ativacao.a7_amostraDesfechos} desfechos (concluídas ÷ concluídas+perdas)`}
                  tone="info"
                />
              </div>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Distribuição por etapa (A8)</h2>
                  <div className={styles.note}>só cards abertos agora, neste funil</div>
                </div>
                <div className={styles.panel}>
                  <DistribuicaoEtapaBarras dados={kpis.ativacao.a8_distribuicaoPorEtapa} />
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Movimentos de etapa no mês (A9)</h2>
                  <div className={styles.note}>avanços/retornos são aproximados pela ordem do Kanban documentada — ver nota no rodapé</div>
                </div>
                <div className={styles.kpis}>
                  <Kpi label="Total de Movimentos" value={String(kpis.ativacao.a9_movimentosDeEtapa.total)} sub="eventos de mudança de etapa no mês" />
                  <Kpi label="Avanços" value={String(kpis.ativacao.a9_movimentosDeEtapa.avancos)} sub="progressos no Kanban" tone="positive" />
                  <Kpi label="Retornos" value={String(kpis.ativacao.a9_movimentosDeEtapa.retornos)} sub="regressos no Kanban" tone="warning" />
                  <Kpi label="Transferências p/ Sucesso" value={String(kpis.ativacao.a9_movimentosDeEtapa.transferenciasParaSucesso)} sub="mudaram de funil no mês" tone="info" />
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Cards vencidos e cobertura de valor</h2>
                </div>
                <div className={styles.grid2}>
                  <div className={styles.panel}>
                    <h3>Cards com prazo vencido (A10)</h3>
                    <div className={styles.panelSub}>CLOSEDATE no passado, entre os cards abertos agora</div>
                    <div className={styles.kpi} style={{ padding: 0 }}>
                      <div className={`${styles.kpiValue} ${styles.num} ${kpis.ativacao.a10_cardsComPrazoVencido > 0 ? styles.warning : ""}`}>
                        {kpis.ativacao.a10_cardsComPrazoVencido}
                      </div>
                      <div className={styles.kpiSub}>{fmtPct(kpis.ativacao.a10_cardsComPrazoVencidoPct)} do estoque atual</div>
                    </div>
                  </div>
                  <div className={styles.panel}>
                    <h3>Cobertura de valor — OPPORTUNITY (A11)</h3>
                    <div className={styles.panelSub}>preenchimento do campo de valor, nunca somado como produção — ver rodapé</div>
                    <div className={styles.barlist}>
                      <BarraProporcional
                        label="Com valor preenchido"
                        value={kpis.ativacao.a11_coberturaValor.comValor}
                        max={kpis.ativacao.a2_estoqueAtual}
                        formatted={`${kpis.ativacao.a11_coberturaValor.comValor} (${fmtPct(kpis.ativacao.a11_coberturaValor.comValorPct)})`}
                      />
                      <BarraProporcional
                        label="Sem valor preenchido"
                        value={kpis.ativacao.a11_coberturaValor.semValor}
                        max={kpis.ativacao.a2_estoqueAtual}
                        formatted={`${kpis.ativacao.a11_coberturaValor.semValor} (${fmtPct(kpis.ativacao.a11_coberturaValor.semValorPct)})`}
                        warning
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Carteira por responsável — Ativação (A12)</h2>
                  <div className={styles.note}>responsável atual do card, não quem executou a ação</div>
                </div>
                <div className={styles.panel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Responsável</th>
                          <th className={styles.numCol}>Carteira Atual</th>
                          <th className={styles.numCol}>Cards Alterados no Mês</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kpis.ativacao.a12_carteiraPorResponsavel.map((r) => (
                          <tr key={r.responsavel}>
                            <td>{r.responsavel}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{r.carteiraAtual}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{r.cardsAlteradosNoMes}</td>
                          </tr>
                        ))}
                        {kpis.ativacao.a12_carteiraPorResponsavel.length === 0 && (
                          <tr>
                            <td colSpan={3} style={{ color: "var(--ink-faint)" }}>
                              Nenhum card aberto neste funil.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* ---------------------------------------------------------- */}
              {/* Sucesso do Cliente                                         */}
              {/* ---------------------------------------------------------- */}
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "32px 0 12px", color: "var(--ink)" }}>Sucesso do Cliente</h2>

              <div className={styles.kpis}>
                <Kpi label="Cards Trabalhados (S1)" value={String(kpis.sucesso.s1_cardsTrabalhados)} sub="com alteração efetiva no mês" tone="positive" />
                <Kpi label="Estoque Atual (S2)" value={String(kpis.sucesso.s2_estoqueAtual)} sub="cards abertos agora, neste funil" />
                <Kpi
                  label="Sem Alteração (S3)"
                  value={String(kpis.sucesso.s3_semAlteracaoEfetiva)}
                  sub="do estoque atual, parados no mês"
                  tone={kpis.sucesso.s3_semAlteracaoEfetiva / Math.max(kpis.sucesso.s2_estoqueAtual, 1) > 0.3 ? "warning" : undefined}
                />
                <Kpi label="Ganhos do Mês (S4)" value={String(kpis.sucesso.s4_ganhosDoMes)} sub="fechados como ganho no mês" tone="positive" />
                <Kpi label="Movimentos p/ Perda (S5)" value={String(kpis.sucesso.s5_movimentosParaPerda)} sub="eventos de perda no mês (card pode repetir)" tone="warning" />
                <Kpi label="Perdas Finais (S6)" value={String(kpis.sucesso.s6_perdasFinais)} sub="hoje encerrados como perda" tone="negative" />
                <Kpi label="Cards Reabertos (S7)" value={String(kpis.sucesso.s7_cardsReabertos)} sub="fechados e reabertos no mesmo funil, no mês" />
                <Kpi label="Aproveitamento Mensal (S8)" value={fmtPct(kpis.sucesso.s8_aproveitamentoMensalPct)} sub="ganhos ÷ cards trabalhados" />
                <Kpi
                  label="Taxa de Sucesso dos Desfechos (S9)"
                  value={kpis.sucesso.s9_taxaSucessoDesfechosPct !== null ? fmtPct(kpis.sucesso.s9_taxaSucessoDesfechosPct) : "—"}
                  sub={`${kpis.sucesso.s4_ganhosDoMes} de ${kpis.sucesso.s9_amostraDesfechos} desfechos (ganhos ÷ ganhos+perdas)`}
                  tone="info"
                />
                <Kpi label="Motivo de Entrada Preenchido (S13)" value={fmtPct(kpis.sucesso.s13_motivoEntradaPreenchidoPct)} sub="do estoque atual" />
                <Kpi label="Ganhos c/ Valor Preenchido (S15)" value={fmtPct(kpis.sucesso.s15_ganhosComValorPreenchidoPct)} sub="dos ganhos do mês (S4)" />
              </div>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Distribuição por etapa (S10)</h2>
                  <div className={styles.note}>só cards abertos agora, neste funil</div>
                </div>
                <div className={styles.panel}>
                  <DistribuicaoEtapaBarras dados={kpis.sucesso.s10_distribuicaoPorEtapa} />
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Gargalo por etapa — % do estoque (S11)</h2>
                  <div className={styles.note}>onde a carteira aberta está concentrada agora</div>
                </div>
                <div className={styles.panel}>
                  <div className={styles.barlist}>
                    {kpis.sucesso.s11_gargaloPorEtapaPct.map((g) => (
                      <BarraProporcional key={g.etapa} label={g.etapa} value={g.pct} max={100} formatted={fmtPct(g.pct)} />
                    ))}
                    {kpis.sucesso.s11_gargaloPorEtapaPct.every((g) => g.pct === 0) && (
                      <div style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>Nenhum card aberto neste período.</div>
                    )}
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Cards vencidos e cobertura de valor</h2>
                </div>
                <div className={styles.grid2}>
                  <div className={styles.panel}>
                    <h3>Cards com prazo vencido (S12)</h3>
                    <div className={styles.panelSub}>CLOSEDATE no passado, entre os cards abertos agora</div>
                    <div className={styles.kpi} style={{ padding: 0 }}>
                      <div className={`${styles.kpiValue} ${styles.num} ${kpis.sucesso.s12_cardsComPrazoVencido > 0 ? styles.warning : ""}`}>
                        {kpis.sucesso.s12_cardsComPrazoVencido}
                      </div>
                      <div className={styles.kpiSub}>{fmtPct(kpis.sucesso.s12_cardsComPrazoVencidoPct)} do estoque atual</div>
                    </div>
                  </div>
                  <div className={styles.panel}>
                    <h3>Cobertura de valor — OPPORTUNITY (S14)</h3>
                    <div className={styles.panelSub}>preenchimento do campo de valor, nunca somado como produção — ver rodapé</div>
                    <div className={styles.barlist}>
                      <BarraProporcional
                        label="Com valor preenchido"
                        value={kpis.sucesso.s14_coberturaValor.comValor}
                        max={kpis.sucesso.s2_estoqueAtual}
                        formatted={`${kpis.sucesso.s14_coberturaValor.comValor} (${fmtPct(kpis.sucesso.s14_coberturaValor.comValorPct)})`}
                      />
                      <BarraProporcional
                        label="Sem valor preenchido"
                        value={kpis.sucesso.s14_coberturaValor.semValor}
                        max={kpis.sucesso.s2_estoqueAtual}
                        formatted={`${kpis.sucesso.s14_coberturaValor.semValor} (${fmtPct(kpis.sucesso.s14_coberturaValor.semValorPct)})`}
                        warning
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Carteira e resultado por responsável — Sucesso (S16)</h2>
                  <div className={styles.note}>responsável atual do card, não quem executou a ação</div>
                </div>
                <div className={styles.panel}>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Responsável</th>
                          <th className={styles.numCol}>Cards Atuais + Ganhos</th>
                          <th className={styles.numCol}>Cards Alterados</th>
                          <th className={styles.numCol}>Ganhos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kpis.sucesso.s16_carteiraEResultadoPorResponsavel.map((r) => (
                          <tr key={r.responsavel}>
                            <td>{r.responsavel}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{r.cardsAtuaisMaisGanhos}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>{r.cardsAlterados}</td>
                            <td className={`${styles.numCol} ${styles.num}`}>
                              <span className={`${styles.pill} ${styles.pillPositive}`}>{r.ganhos}</span>
                            </td>
                          </tr>
                        ))}
                        {kpis.sucesso.s16_carteiraEResultadoPorResponsavel.length === 0 && (
                          <tr>
                            <td colSpan={4} style={{ color: "var(--ink-faint)" }}>
                              Nenhum card neste funil.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* ---------------------------------------------------------- */}
              {/* Por responsável (R1-R11)                                   */}
              {/* ---------------------------------------------------------- */}
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Por responsável — Ativação &amp; Sucesso (R1-R11)</h2>
                  <div className={styles.note}>
                    R8 (ligações) usa um TYPE_ID de atividade ainda não confirmado contra dados reais — tratar como estimativa. R9 (tarefas) depende de
                    escopo do webhook ainda não liberado (tasks.task.list) — hoje sempre 0. Ver nota completa no rodapé.
                  </div>
                </div>
                <div className={styles.panel} style={{ marginBottom: 18 }}>
                  <h3>Ativação Novos Clientes</h3>
                  <PorResponsavelTabela dados={kpis.porResponsavel.ativacao} />
                </div>
                <div className={styles.panel}>
                  <h3>Sucesso do Cliente</h3>
                  <PorResponsavelTabela dados={kpis.porResponsavel.sucesso} />
                </div>
              </section>

              {/* ---------------------------------------------------------- */}
              {/* Qualidade / Auditoria                                      */}
              {/* ---------------------------------------------------------- */}
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2>Qualidade / Auditoria</h2>
                </div>
                <div className={styles.panel}>
                  <div className={styles.kpis} style={{ marginBottom: 18 }}>
                    <Kpi
                      label="Eventos Descartados por Visualização (Q1)"
                      value={String(kpis.qualidade.q1_eventosDescartadosPorVisualizacao)}
                      sub="sempre 0 nesta versão — ver nota no rodapé"
                    />
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.data}>
                      <thead>
                        <tr>
                          <th>Cobertura de preenchimento</th>
                          <th className={styles.numCol}>Ativação</th>
                          <th className={styles.numCol}>Sucesso</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Responsável atribuído (Q3)</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(kpis.qualidade.q3_coberturaResponsavel.ativacao)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(kpis.qualidade.q3_coberturaResponsavel.sucesso)}</td>
                        </tr>
                        <tr>
                          <td>Empresa vinculada (Q4)</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(kpis.qualidade.q4_coberturaEmpresa.ativacao)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(kpis.qualidade.q4_coberturaEmpresa.sucesso)}</td>
                        </tr>
                        <tr>
                          <td>Data de término preenchida (Q5)</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(kpis.qualidade.q5_coberturaDataTermino.ativacao)}</td>
                          <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(kpis.qualidade.q5_coberturaDataTermino.sucesso)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.panelSub} style={{ marginTop: 12 }}>
                    Data de corte dos dados (Q6): {new Date(kpis.qualidade.q6_ultimaAtualizacao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.{" "}
                    {kpis.totalEventos} movimentações de etapa registradas no histórico nativo do CRM.
                  </div>
                </div>
              </section>

              <footer
                className={styles.footer}
                title="Q1 sempre retorna 0: nenhuma das APIs usadas (crm.deal.list, crm.activity.list, crm.stagehistory.list, tasks.task.list) expõe um log de visualização de card no Bitrix. R9 (e parte de R8) dependem do escopo tasks.task.list, hoje sem acesso (insufficient_scope) no webhook configurado — pendência de infraestrutura, não bug deste painel."
              >
                Fonte: Bitrix24, Deals (crm.deal.*), funis &quot;Ativação Novos Clientes&quot; (categoria 1) e &quot;Sucesso do Cliente&quot; (categoria 0), via webhook de leitura.
                &quot;Por responsável&quot; usa sempre o responsável ATUAL do card (ASSIGNED_BY_ID) — o CRM não guarda histórico de troca de responsável via API, só de troca de etapa.
                Valores de OPPORTUNITY nunca são somados como produção/receita, só usados pra medir cobertura de preenchimento (% com valor, % sem valor).
                <br />
                <strong>Limitações conhecidas:</strong> o KPI Q1 (eventos descartados por serem apenas visualização) sempre retorna 0 — nenhuma das 4 APIs usadas aqui expõe um
                log de visualização de card no Bitrix, não é possível reproduzir esse número com as fontes disponíveis. O KPI R9 (tarefas por responsável) e parte do R8
                (ligações) dependem do escopo tasks.task.list, que hoje não está liberado no webhook (insufficient_scope) — R9 fica sempre 0 até essa pendência de
                infraestrutura ser resolvida, e a subdivisão de R8 usa um TYPE_ID de atividade ainda não confirmado contra dados reais deste portal.
              </footer>
            </>
          )}
        </div>
      </div>
    </>
  );
}
