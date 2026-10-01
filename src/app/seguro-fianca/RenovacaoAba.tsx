import styles from "./seguro-fianca.module.css";
import ExportarQuadro from "@/components/ExportarQuadro";
import type { EstatisticaTempoRenovacao, PainelRenovacao } from "@/lib/bitrix/renovacaoFianca";

// Conteúdo da aba "Renovação" do painel /seguro-fianca -- só o funil de
// Renovação (categoria 32). Os números vêm prontos de
// src/lib/bitrix/renovacaoFianca.ts (ao vivo no mês atual, retrato salvo
// nos meses fechados), igual às outras abas.

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
}
function fmtDuracao(minutosTotais: number): string {
  const min = Math.round(minutosTotais);
  const horas = Math.floor(min / 60);
  const minutos = min % 60;
  if (horas === 0) return `${minutos}min`;
  return `${horas}h${String(minutos).padStart(2, "0")}min`;
}
function fmtData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}
function fmtMes(mes: string): string {
  if (!/^\d{4}-\d{2}$/.test(mes)) return mes;
  const [ano, m] = mes.split("-");
  return `${m}/${ano}`;
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

function Barra({ label, value, max, formatted }: { label: string; value: number; max: number; formatted?: string }) {
  const pct = Math.max(2, (value / Math.max(max, 1)) * 100);
  return (
    <div className={styles.barrow}>
      <div className={styles.rlabel}>{label}</div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <div className={`${styles.rvalue} ${styles.num}`}>{formatted ?? value}</div>
    </div>
  );
}

function TabelaTempos({ titulo, sub, dados }: { titulo: string; sub: string; dados: Record<string, EstatisticaTempoRenovacao> }) {
  const linhas = Object.entries(dados).sort((a, b) => b[1].n - a[1].n);
  return (
    <div className={styles.panel}>
      <h3>{titulo}</h3>
      <div className={styles.panelSub}>{sub}</div>
      <div className={styles.tableWrap}>
        <table className={styles.data}>
          <thead>
            <tr>
              <th>Responsável</th>
              <th className={styles.numCol}>Cards</th>
              <th className={styles.numCol}>Média</th>
              <th className={styles.numCol}>Mediana</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(([nome, e]) => (
              <tr key={nome}>
                <td>{nome}</td>
                <td className={`${styles.numCol} ${styles.num}`}>{e.n}</td>
                <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(e.media)}</td>
                <td className={`${styles.numCol} ${styles.num}`}>{fmtDuracao(e.mediana)}</td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: "var(--ink-faint)" }}>
                  Nenhum registro neste período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RenovacaoAba({ dados, competencia }: { dados: PainelRenovacao; competencia: string }) {
  const { kpis } = dados;
  const maxEtapa = Math.max(...dados.porEtapa.map((e) => e.quantidade), 1);
  const maxMotivo = Math.max(...dados.perdasPorMotivo.map((m) => m.quantidade), 1);
  const totaisDiario = dados.controleDiario.reduce(
    (t, d) => ({
      valores: t.valores + d.valoresAtualizados,
      contratos: t.contratos + d.contratosRecebidos,
      efetivacoes: t.efetivacoes + d.efetivacoes,
    }),
    { valores: 0, contratos: 0, efetivacoes: 0 }
  );

  return (
    <>
      {/* ---------- Visão geral e funil ---------- */}
      <section id="quadro-renovacao-visao-geral" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Renovações do mês</h2>
          <div className={styles.note}>
            novos = entraram no funil neste mês · herdados = de meses anteriores ainda em andamento ou resolvidos neste mês
          </div>
          <ExportarQuadro
            quadroId="quadro-renovacao-visao-geral"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-renovacao-visao-geral-${competencia}`}
            dadosExcel={[
              { indicador: "Total do mês", valor: kpis.total },
              { indicador: "Novos", valor: kpis.novos },
              { indicador: "Herdados", valor: kpis.herdados },
              { indicador: "Em andamento", valor: kpis.emAndamento },
              { indicador: "Renovados", valor: kpis.renovados },
              { indicador: "Perdidos", valor: kpis.perdidos },
              { indicador: "Taxa de renovação (%)", valor: kpis.taxaRenovacao ?? "" },
              ...dados.porEtapa.map((e) => ({ indicador: `Em andamento — ${e.etapa}`, valor: e.quantidade })),
            ]}
            nomeAbaExcel="Renovação"
          />
        </div>
        <div className={styles.kpis}>
          <Kpi label="Total do mês" value={String(kpis.total)} sub={`${kpis.novos} novos + ${kpis.herdados} herdados`} tone="info" />
          <Kpi label="Em andamento" value={String(kpis.emAndamento)} sub="ainda sem resultado" />
          <Kpi label="Renovados" value={String(kpis.renovados)} sub="entraram em Sucesso neste mês" tone="positive" />
          <Kpi label="Perdidos" value={String(kpis.perdidos)} sub="entraram em Perdido neste mês" tone="negative" />
          <Kpi
            label="Taxa de renovação"
            value={fmtPct(kpis.taxaRenovacao)}
            sub={kpis.taxaRenovacao === null ? "sem renovados nem perdidos ainda" : "renovados ÷ (renovados + perdidos)"}
            tone="info"
          />
        </div>
        <div className={styles.panel} style={{ marginTop: 16 }}>
          <h3>Em andamento por etapa</h3>
          <div className={styles.panelSub}>onde estão hoje os {kpis.emAndamento} cards em aberto</div>
          {dados.porEtapa.map((e) => (
            <Barra key={e.etapa} label={e.etapa} value={e.quantidade} max={maxEtapa} />
          ))}
        </div>
      </section>

      {/* ---------- Controle diário ---------- */}
      <section id="quadro-renovacao-controle-diario" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Controle diário</h2>
          <div className={styles.note}>
            Valores atualizados = dia em que o card foi liberado para cotação com os valores novos da imobiliária ·
            Contratos/aditivos = campo &quot;Data E Hora do Recebimento de Contrato&quot; · Efetivações = entrada em Sucesso
          </div>
          <ExportarQuadro
            quadroId="quadro-renovacao-controle-diario"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-renovacao-controle-diario-${competencia}`}
            dadosExcel={dados.controleDiario.map((d) => ({
              data: fmtData(d.data),
              valores_atualizados_recebidos: d.valoresAtualizados,
              contratos_aditivos_recebidos: d.contratosRecebidos,
              efetivacoes: d.efetivacoes,
            }))}
            nomeAbaExcel="Controle diário"
          />
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.data}>
            <thead>
              <tr>
                <th>Data</th>
                <th className={styles.numCol}>Valores de locação atualizados recebidos</th>
                <th className={styles.numCol}>Contratos / aditivos recebidos</th>
                <th className={styles.numCol}>Efetivações de renovação</th>
              </tr>
            </thead>
            <tbody>
              {dados.controleDiario.map((d) => (
                <tr key={d.data}>
                  <td>{fmtData(d.data)}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{d.valoresAtualizados || "—"}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{d.contratosRecebidos || "—"}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{d.efetivacoes || "—"}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td className={`${styles.numCol} ${styles.num}`}>
                  <strong>{totaisDiario.valores}</strong>
                </td>
                <td className={`${styles.numCol} ${styles.num}`}>
                  <strong>{totaisDiario.contratos}</strong>
                </td>
                <td className={`${styles.numCol} ${styles.num}`}>
                  <strong>{totaisDiario.efetivacoes}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Perdas e reajuste ---------- */}
      <section id="quadro-renovacao-perdas-reajuste" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Perdas, reajuste e seguradoras</h2>
          <div className={styles.note}>perdas e valores contam pelo mês do resultado (Sucesso/Perdido)</div>
          <ExportarQuadro
            quadroId="quadro-renovacao-perdas-reajuste"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-renovacao-perdas-reajuste-${competencia}`}
            dadosExcel={[
              ...dados.perdasPorMotivo.map((m) => ({ indicador: `Perda — ${m.motivo}`, valor: m.quantidade })),
              { indicador: "Reajuste médio — todos (%)", valor: dados.reajuste.mediaGeral ?? "" },
              { indicador: "Reajuste médio — renovados (%)", valor: dados.reajuste.mediaRenovados ?? "" },
              { indicador: "Prêmio líquido renovado (R$)", valor: dados.financeiro.premioLiquidoRenovado },
              { indicador: "Comissão renovada (R$)", valor: dados.financeiro.comissaoRenovada },
              { indicador: "Renovou na mesma seguradora", valor: dados.seguradoras.mesmaSeguradora },
              { indicador: "Trocou de seguradora", valor: dados.seguradoras.trocouSeguradora },
              { indicador: "Sem seguradora informada", valor: dados.seguradoras.semInformacao },
            ]}
            nomeAbaExcel="Perdas e reajuste"
          />
        </div>
        <div className={styles.kpis}>
          <Kpi
            label="Reajuste médio"
            value={fmtPct(dados.reajuste.mediaGeral)}
            sub={`${dados.reajuste.nGeral} card(s) com reajuste calculado`}
            tone="info"
          />
          <Kpi
            label="Reajuste médio dos renovados"
            value={fmtPct(dados.reajuste.mediaRenovados)}
            sub={`${dados.reajuste.nRenovados} renovado(s) no mês`}
          />
          <Kpi label="Prêmio líquido renovado" value={fmtBRL(dados.financeiro.premioLiquidoRenovado)} sub="soma dos renovados no mês" tone="positive" />
          <Kpi label="Comissão renovada" value={fmtBRL(dados.financeiro.comissaoRenovada)} sub="prêmio × comissão trabalhada (%)" tone="positive" />
        </div>
        <div className={styles.grid2} style={{ marginTop: 16 }}>
          <div className={styles.panel}>
            <h3>Perdas por motivo</h3>
            <div className={styles.panelSub}>{kpis.perdidos} perdido(s) no mês</div>
            {dados.perdasPorMotivo.map((m) => (
              <Barra key={m.motivo} label={m.motivo} value={m.quantidade} max={maxMotivo} />
            ))}
          </div>
          <div className={styles.panel}>
            <h3>Seguradora na renovação</h3>
            <div className={styles.panelSub}>Seguradora anterior × Seguradora Escolhida, só renovados no mês</div>
            <Barra label="Mesma seguradora" value={dados.seguradoras.mesmaSeguradora} max={Math.max(kpis.renovados, 1)} />
            <Barra label="Trocou de seguradora" value={dados.seguradoras.trocouSeguradora} max={Math.max(kpis.renovados, 1)} />
            {dados.seguradoras.semInformacao > 0 && (
              <Barra label="Sem informação" value={dados.seguradoras.semInformacao} max={Math.max(kpis.renovados, 1)} />
            )}
            <div className={styles.panelSub} style={{ marginTop: 12 }}>
              Renovados por seguradora nova
            </div>
            {dados.seguradoras.porSeguradoraNova.map((s) => (
              <Barra key={s.seguradora} label={s.seguradora} value={s.renovados} max={Math.max(kpis.renovados, 1)} />
            ))}
            {dados.seguradoras.porSeguradoraNova.length === 0 && (
              <div className={styles.panelSub}>Nenhuma renovação no mês.</div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Imobiliárias ---------- */}
      <section id="quadro-renovacao-imobiliarias" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Renovações por imobiliária</h2>
          <div className={styles.note}>cards do mês (novos + herdados) agrupados pela imobiliária do card</div>
          <ExportarQuadro
            quadroId="quadro-renovacao-imobiliarias"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-renovacao-imobiliarias-${competencia}`}
            dadosExcel={dados.imobiliarias.map((im) => ({
              imobiliaria: im.nome,
              total: im.total,
              novos: im.novos,
              em_andamento: im.emAndamento,
              renovados: im.renovados,
              perdidos: im.perdidos,
              taxa_renovacao: im.taxaRenovacao ?? "",
            }))}
            nomeAbaExcel="Imobiliárias"
          />
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.data}>
            <thead>
              <tr>
                <th>Imobiliária</th>
                <th className={styles.numCol}>Total</th>
                <th className={styles.numCol}>Novos</th>
                <th className={styles.numCol}>Em andamento</th>
                <th className={styles.numCol}>Renovados</th>
                <th className={styles.numCol}>Perdidos</th>
                <th className={styles.numCol}>Taxa de renovação</th>
              </tr>
            </thead>
            <tbody>
              {dados.imobiliarias.map((im) => (
                <tr key={im.nome}>
                  <td>{im.nome}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{im.total}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{im.novos}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{im.emAndamento}</td>
                  <td className={styles.numCol}>
                    <span className={`${styles.pill} ${styles.pillPositive}`}>{im.renovados}</span>
                  </td>
                  <td className={styles.numCol}>
                    <span className={`${styles.pill} ${styles.pillNegative}`}>{im.perdidos}</span>
                  </td>
                  <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(im.taxaRenovacao)}</td>
                </tr>
              ))}
              {dados.imobiliarias.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--ink-faint)" }}>
                    Nenhum card de renovação neste período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Equipe e tempos ---------- */}
      <section id="quadro-renovacao-equipe" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Equipe e tempos</h2>
          <div className={styles.note}>
            horário comercial (seg–sex, 9h–18h) · conferência, cotação e negociação pelos campos de início/fim preenchidos à mão,
            no mês do fim · efetivação = tempo em Liberado para renovar + Concluir + Pendente (sem contar a espera de Renovar dia 01)
          </div>
          <ExportarQuadro
            quadroId="quadro-renovacao-equipe"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-renovacao-equipe-${competencia}`}
            dadosExcel={[
              ...(
                [
                  ["Conferência", dados.equipe.conferencia],
                  ["Cotação", dados.equipe.cotacao],
                  ["Negociação", dados.equipe.negociacao],
                  ["Efetivação", dados.equipe.efetivacao],
                ] as const
              ).flatMap(([fase, r]) =>
                Object.entries(r).map(([nome, e]) => ({
                  fase,
                  responsavel: nome,
                  cards: e.n,
                  media_min: Math.round(e.media),
                  mediana_min: Math.round(e.mediana),
                }))
              ),
              ...dados.tempoPorEtapa.map((t) => ({
                fase: `Etapa — ${t.etapa}`,
                responsavel: "",
                cards: t.estatistica.n,
                media_min: Math.round(t.estatistica.media),
                mediana_min: Math.round(t.estatistica.mediana),
              })),
            ]}
            nomeAbaExcel="Equipe e tempos"
          />
        </div>
        <div className={styles.grid2}>
          <TabelaTempos titulo="Conferência (entrada)" sub="Responsável pelo Cadastro · início → fim do preenchimento" dados={dados.equipe.conferencia} />
          <TabelaTempos titulo="Cotação" sub="Responsáveis pela Cotação · HORA INICIO → HORA FIM" dados={dados.equipe.cotacao} />
          <TabelaTempos titulo="Negociação" sub="Responsáveis pela Negociação · início → fim da negociação" dados={dados.equipe.negociacao} />
          <TabelaTempos titulo="Efetivação" sub="Responsável pela Efetivação · renovados no mês" dados={dados.equipe.efetivacao} />
        </div>
        <div className={styles.panel} style={{ marginTop: 16 }}>
          <h3>Tempo médio por etapa</h3>
          <div className={styles.panelSub}>
            permanência em cada etapa (inclui espera na fila) · &quot;Renovar dia 01&quot; é espera pedida pela imobiliária
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.data}>
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th className={styles.numCol}>Passagens</th>
                  <th className={styles.numCol}>Média</th>
                  <th className={styles.numCol}>Mediana</th>
                </tr>
              </thead>
              <tbody>
                {dados.tempoPorEtapa.map((t) => (
                  <tr key={t.etapa}>
                    <td>{t.etapa}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{t.estatistica.n}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{t.estatistica.n ? fmtDuracao(t.estatistica.media) : "—"}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{t.estatistica.n ? fmtDuracao(t.estatistica.mediana) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- Carteira por vencimento ---------- */}
      <section id="quadro-renovacao-vencimento" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Carteira por mês de vencimento</h2>
          <div className={styles.note}>
            todos os cards do funil, agrupados pelo &quot;Fim da vigência anterior&quot; — situação atual de cada lote
          </div>
          <ExportarQuadro
            quadroId="quadro-renovacao-vencimento"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-renovacao-vencimento-${competencia}`}
            dadosExcel={dados.porVencimento.map((v) => ({
              mes_vencimento: fmtMes(v.mes),
              total: v.total,
              em_andamento: v.emAndamento,
              renovados: v.renovados,
              perdidos: v.perdidos,
            }))}
            nomeAbaExcel="Vencimentos"
          />
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.data}>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th className={styles.numCol}>Total</th>
                <th className={styles.numCol}>Em andamento</th>
                <th className={styles.numCol}>Renovados</th>
                <th className={styles.numCol}>Perdidos</th>
                <th className={styles.numCol}>Taxa de renovação</th>
              </tr>
            </thead>
            <tbody>
              {dados.porVencimento.map((v) => (
                <tr key={v.mes}>
                  <td>{fmtMes(v.mes)}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{v.total}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{v.emAndamento}</td>
                  <td className={styles.numCol}>
                    <span className={`${styles.pill} ${styles.pillPositive}`}>{v.renovados}</span>
                  </td>
                  <td className={styles.numCol}>
                    <span className={`${styles.pill} ${styles.pillNegative}`}>{v.perdidos}</span>
                  </td>
                  <td className={`${styles.numCol} ${styles.num}`}>
                    {fmtPct(v.renovados + v.perdidos > 0 ? (v.renovados / (v.renovados + v.perdidos)) * 100 : null)}
                  </td>
                </tr>
              ))}
              {dados.porVencimento.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--ink-faint)" }}>
                    Nenhum card no funil de Renovação.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className={styles.footer}>
        Fonte: Bitrix24, SPA &quot;Seguro Fiança&quot;, funil &quot;Renovação&quot; (categoria 32). {dados.totalCardsFunil} card(s)
        no funil. Cards de renovação não entram nas outras abas deste painel.
      </footer>
    </>
  );
}
