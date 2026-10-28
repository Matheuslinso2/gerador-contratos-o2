import styles from "./seguro-fianca.module.css";
import ExportarQuadro from "@/components/ExportarQuadro";
import InfoLegenda from "@/components/InfoLegenda";
import type { EstatisticaTempoEndosso, LinhaAgrupadaEndosso, PainelEndosso } from "@/lib/bitrix/endossoFianca";

// Conteúdo da aba "Endossos" do painel /seguro-fianca -- só o funil Endossos
// (categoria 42, 28/10/2026). Indicadores do desenho da equipe (quantidade
// por etapa, tempo médio por etapa, volume por tipo, cadastrados, sem retorno,
// pendências documentos × seguradora) no mesmo formato da aba Renovação.
// Números prontos de src/lib/bitrix/endossoFianca.ts (ao vivo no mês atual,
// retrato salvo nos meses fechados).

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
function fmtTempo(e: EstatisticaTempoEndosso): string {
  return e.n ? fmtDuracao(e.media) : "—";
}
function fmtData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
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

function TabelaAgrupada({ id, titulo, legenda, coluna, linhas, competencia, arquivo }: {
  id: string; titulo: string; legenda: string; coluna: string; linhas: LinhaAgrupadaEndosso[]; competencia: string; arquivo: string;
}) {
  const soma = linhas.reduce((t, l) => ({ total: t.total + l.total, novos: t.novos + l.novos, emAndamento: t.emAndamento + l.emAndamento, cadastrados: t.cadastrados + l.cadastrados, semRetorno: t.semRetorno + l.semRetorno }), { total: 0, novos: 0, emAndamento: 0, cadastrados: 0, semRetorno: 0 });
  const taxaTotal = soma.cadastrados + soma.semRetorno > 0 ? (soma.cadastrados / (soma.cadastrados + soma.semRetorno)) * 100 : null;
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{titulo}<InfoLegenda titulo={titulo}>{legenda}</InfoLegenda></h2>
        <ExportarQuadro
          quadroId={id}
          corFundo="#f7f8fa"
          nomeArquivo={`seguro-fianca-endossos-${arquivo}-${competencia}`}
          dadosExcel={linhas.map((l) => ({ [coluna]: l.nome, total: l.total, novos: l.novos, emAndamento: l.emAndamento, cadastrados: l.cadastrados, semRetorno: l.semRetorno, taxaConclusao: l.taxaConclusao ?? "" }))}
          nomeAbaExcel={titulo.slice(0, 30)}
        />
      </div>
      <div className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.data}>
            <thead>
              <tr>
                <th>{coluna}</th>
                <th className={styles.numCol}>Total do mês</th>
                <th className={styles.numCol}>Novos</th>
                <th className={styles.numCol}>Em andamento</th>
                <th className={styles.numCol}>Cadastrados</th>
                <th className={styles.numCol}>Sem retorno</th>
                <th className={styles.numCol}>Taxa de conclusão</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.nome}>
                  <td>{l.nome}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{l.total}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{l.novos}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{l.emAndamento}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{l.cadastrados}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{l.semRetorno}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(l.taxaConclusao)}</td>
                </tr>
              ))}
              {soma.total === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--ink-faint)" }}>Nenhum endosso neste período.</td>
                </tr>
              )}
              {soma.total > 0 && (
                <tr style={{ fontWeight: 600 }}>
                  <td>Total</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{soma.total}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{soma.novos}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{soma.emAndamento}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{soma.cadastrados}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{soma.semRetorno}</td>
                  <td className={`${styles.numCol} ${styles.num}`}>{fmtPct(taxaTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function EndossoAba({ dados, competencia }: { dados: PainelEndosso; competencia: string }) {
  const { kpis, pendencias } = dados;
  const maxEtapa = Math.max(...dados.porEtapa.map((e) => e.quantidade), 1);
  const maxTempo = Math.max(...dados.tempoPorEtapa.map((e) => e.estatistica.media), 1);
  const diasComMovimento = dados.controleDiario.filter((d) => d.novos || d.liberadosCadastro || d.cadastrados || d.semRetorno);
  const totaisDiario = dados.controleDiario.reduce(
    (t, d) => ({ novos: t.novos + d.novos, liberados: t.liberados + d.liberadosCadastro, cadastrados: t.cadastrados + d.cadastrados, semRetorno: t.semRetorno + d.semRetorno }),
    { novos: 0, liberados: 0, cadastrados: 0, semRetorno: 0 }
  );

  return (
    <>
      {/* ---------- Visão geral e funil ---------- */}
      <section id="quadro-endosso-visao-geral" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Endossos do mês<InfoLegenda titulo="Endossos do mês">Funil Endossos (categoria 42 do Bitrix). Novos = cards criados neste mês; Herdados = de meses anteriores, ainda em andamento ou resolvidos neste mês. Cadastrados = entraram em Cadastrado neste mês (sucesso: o endosso vai ao ERP como endosso em emissão). Sem retorno = entraram em Sem retorno de documentos neste mês (encerrado sem cadastro). Taxa de conclusão = cadastrados ÷ (cadastrados + sem retorno).</InfoLegenda></h2>
          <div className={styles.note}>novos = criados neste mês · herdados = de meses anteriores ainda em andamento ou resolvidos neste mês</div>
          <ExportarQuadro
            quadroId="quadro-endosso-visao-geral"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-endossos-visao-geral-${competencia}`}
            dadosExcel={[
              { indicador: "Total do mês", valor: kpis.total },
              { indicador: "Novos", valor: kpis.novos },
              { indicador: "Herdados", valor: kpis.herdados },
              { indicador: "Em andamento", valor: kpis.emAndamento },
              { indicador: "Cadastrados", valor: kpis.cadastrados },
              { indicador: "Sem retorno de documentos", valor: kpis.semRetorno },
              { indicador: "Taxa de conclusão (%)", valor: kpis.taxaConclusao ?? "" },
              ...dados.porEtapa.map((e) => ({ indicador: `Em andamento — ${e.etapa}`, valor: e.quantidade })),
            ]}
            nomeAbaExcel="Endossos"
          />
        </div>
        <div className={styles.kpis}>
          <Kpi label="Total do mês" value={String(kpis.total)} sub={`${kpis.novos} novos + ${kpis.herdados} herdados`} tone="info" />
          <Kpi label="Em andamento" value={String(kpis.emAndamento)} sub="ainda sem resultado" />
          <Kpi label="Cadastrados" value={String(kpis.cadastrados)} sub="entraram em Cadastrado neste mês" tone="positive" />
          <Kpi label="Sem retorno de documentos" value={String(kpis.semRetorno)} sub="encerrados sem cadastro neste mês" tone="negative" />
          <Kpi
            label="Taxa de conclusão"
            value={fmtPct(kpis.taxaConclusao)}
            sub={kpis.taxaConclusao === null ? "sem cadastrados nem encerrados ainda" : "cadastrados ÷ (cadastrados + sem retorno)"}
            tone="info"
          />
          <Kpi
            label="Tempo médio até o cadastro"
            value={fmtTempo(dados.cicloCadastrados)}
            sub={dados.cicloCadastrados.n ? `mediana ${fmtDuracao(dados.cicloCadastrados.mediana)} · ${dados.cicloCadastrados.n} cadastrado(s), horário comercial` : "nenhum cadastrado neste mês"}
          />
        </div>
        <div className={styles.panel} style={{ marginTop: 16 }}>
          <h3>Quantidade por etapa<InfoLegenda titulo="Quantidade por etapa">Onde estão hoje os endossos ainda sem resultado, etapa por etapa.</InfoLegenda></h3>
          <div className={styles.panelSub}>onde estão hoje os {kpis.emAndamento} cards em aberto</div>
          {dados.porEtapa.map((e) => (
            <Barra key={e.etapa} label={e.etapa} value={e.quantidade} max={maxEtapa} />
          ))}
        </div>
      </section>

      {/* ---------- Pendências: documentos × seguradora ---------- */}
      <section id="quadro-endosso-pendencias" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Principais pendências — documentos × seguradora<InfoLegenda titulo="Pendências">Pendente documento = aguardando documentação da imobiliária ou do cliente. Pendência seguradora = aguardando regularização ou resposta da seguradora. Agora = cards parados hoje na etapa. Entraram no mês = cards que passaram pela etapa neste mês (cada card conta uma vez). Tempo médio = tempo em horário comercial nas passagens pela etapa que terminaram neste mês ou ainda estão abertas.</InfoLegenda></h2>
          <ExportarQuadro
            quadroId="quadro-endosso-pendencias"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-endossos-pendencias-${competencia}`}
            dadosExcel={[
              { pendencia: "Documentos (imobiliária/cliente)", agora: pendencias.documento.agora, entraramNoMes: pendencias.documento.entradasNoMes, tempoMedioMin: Math.round(pendencias.documento.tempo.media) },
              { pendencia: "Seguradora", agora: pendencias.seguradora.agora, entraramNoMes: pendencias.seguradora.entradasNoMes, tempoMedioMin: Math.round(pendencias.seguradora.tempo.media) },
            ]}
            nomeAbaExcel="Pendências"
          />
        </div>
        <div className={styles.kpis}>
          <Kpi label="Pendente documento — agora" value={String(pendencias.documento.agora)} sub={`${pendencias.documento.entradasNoMes} entraram no mês · tempo médio ${fmtTempo(pendencias.documento.tempo)}`} tone="warning" />
          <Kpi label="Pendência seguradora — agora" value={String(pendencias.seguradora.agora)} sub={`${pendencias.seguradora.entradasNoMes} entraram no mês · tempo médio ${fmtTempo(pendencias.seguradora.tempo)}`} tone="warning" />
        </div>
      </section>

      {/* ---------- Tempo médio por etapa ---------- */}
      <section id="quadro-endosso-tempo" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Tempo médio em cada etapa<InfoLegenda titulo="Tempo médio em cada etapa">Pelo histórico de mudança de etapa do Bitrix, em horário comercial. Conta cada passagem pela etapa que terminou neste mês ou que ainda está aberta (card parado nela hoje).</InfoLegenda></h2>
          <ExportarQuadro
            quadroId="quadro-endosso-tempo"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-endossos-tempo-${competencia}`}
            dadosExcel={dados.tempoPorEtapa.map((e) => ({ etapa: e.etapa, passagens: e.estatistica.n, mediaMin: Math.round(e.estatistica.media), medianaMin: Math.round(e.estatistica.mediana) }))}
            nomeAbaExcel="Tempo por etapa"
          />
        </div>
        <div className={styles.panel}>
          {dados.tempoPorEtapa.map((e) => (
            <Barra
              key={e.etapa}
              label={e.etapa}
              value={e.estatistica.media}
              max={maxTempo}
              formatted={e.estatistica.n ? `${fmtDuracao(e.estatistica.media)} (${e.estatistica.n})` : "—"}
            />
          ))}
          <div className={styles.panelSub} style={{ marginTop: 8 }}>média em horário comercial · entre parênteses, quantas passagens</div>
        </div>
      </section>

      {/* ---------- Volume por tipo, seguradora e imobiliária ---------- */}
      <TabelaAgrupada
        id="quadro-endosso-tipo"
        titulo="Volume por tipo de endosso"
        legenda="Campo Tipo de endosso do card. Total do mês = novos + herdados. Cadastrados e Sem retorno contam só os resolvidos neste mês."
        coluna="Tipo de endosso"
        linhas={dados.porTipo}
        competencia={competencia}
        arquivo="tipo"
      />
      <TabelaAgrupada
        id="quadro-endosso-seguradora"
        titulo="Endossos por seguradora"
        legenda="Campo Seguradora Escolhida do card. Mesmas regras de contagem do quadro por tipo."
        coluna="Seguradora"
        linhas={dados.porSeguradora}
        competencia={competencia}
        arquivo="seguradora"
      />
      <TabelaAgrupada
        id="quadro-endosso-imobiliaria"
        titulo="Endossos por imobiliária"
        legenda={`Empresa do card ligada à ficha do banco único de imobiliárias. "(sem ficha)" = Empresa do Bitrix ainda sem vínculo com uma ficha${dados.imobiliariasSemVinculo ? ` (${dados.imobiliariasSemVinculo} card(s) neste mês)` : ""}. Mesmas regras de contagem do quadro por tipo.`}
        coluna="Imobiliária"
        linhas={dados.imobiliarias}
        competencia={competencia}
        arquivo="imobiliaria"
      />

      {/* ---------- Controle diário ---------- */}
      <section id="quadro-endosso-diario" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Controle diário<InfoLegenda titulo="Controle diário">Por dia do mês: Novas solicitações = cards criados; Liberados para cadastro = 1ª entrada em Liberado para cadastro no mês; Cadastrados = 1ª entrada em Cadastrado no mês; Sem retorno = 1ª entrada em Sem retorno de documentos no mês. Só aparecem os dias com movimento.</InfoLegenda></h2>
          <ExportarQuadro
            quadroId="quadro-endosso-diario"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-endossos-diario-${competencia}`}
            dadosExcel={dados.controleDiario.map((d) => ({ data: fmtData(d.data), novasSolicitacoes: d.novos, liberadosCadastro: d.liberadosCadastro, cadastrados: d.cadastrados, semRetorno: d.semRetorno }))}
            nomeAbaExcel="Controle diário"
          />
        </div>
        <div className={styles.panel}>
          <div className={styles.tableWrap}>
            <table className={styles.data}>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th className={styles.numCol}>Novas solicitações</th>
                  <th className={styles.numCol}>Liberados para cadastro</th>
                  <th className={styles.numCol}>Cadastrados</th>
                  <th className={styles.numCol}>Sem retorno</th>
                </tr>
              </thead>
              <tbody>
                {diasComMovimento.map((d) => (
                  <tr key={d.data}>
                    <td>{fmtData(d.data)}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{d.novos}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{d.liberadosCadastro}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{d.cadastrados}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{d.semRetorno}</td>
                  </tr>
                ))}
                {diasComMovimento.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--ink-faint)" }}>Nenhum movimento neste período.</td>
                  </tr>
                )}
                {diasComMovimento.length > 0 && (
                  <tr style={{ fontWeight: 600 }}>
                    <td>Total</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{totaisDiario.novos}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{totaisDiario.liberados}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{totaisDiario.cadastrados}</td>
                    <td className={`${styles.numCol} ${styles.num}`}>{totaisDiario.semRetorno}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- Equipe ---------- */}
      <section id="quadro-endosso-equipe" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Equipe<InfoLegenda titulo="Equipe">Responsável pelo processo = responsável do card (todos do setor podem executar). Cards = endossos do mês com essa pessoa; tempo até o cadastro = da criação do card à entrada em Cadastrado, em horário comercial. Responsável pelo cadastro = campo do card; espera = tempo em Liberado para cadastro até ser cadastrado.</InfoLegenda></h2>
          <ExportarQuadro
            quadroId="quadro-endosso-equipe"
            corFundo="#f7f8fa"
            nomeArquivo={`seguro-fianca-endossos-equipe-${competencia}`}
            dadosExcel={[
              ...dados.equipe.processo.map((p) => ({ papel: "Processo", responsavel: p.nome, cards: p.cards, cadastrados: p.cadastrados, tempoMedioMin: Math.round(p.ciclo.media) })),
              ...dados.equipe.cadastro.map((p) => ({ papel: "Cadastro", responsavel: p.nome, cards: "", cadastrados: p.cadastrados, tempoMedioMin: Math.round(p.espera.media) })),
            ]}
            nomeAbaExcel="Equipe"
          />
        </div>
        <div className={styles.grid2}>
          <div className={styles.panel}>
            <h3>Responsável pelo processo</h3>
            <div className={styles.tableWrap}>
              <table className={styles.data}>
                <thead>
                  <tr>
                    <th>Responsável</th>
                    <th className={styles.numCol}>Cards</th>
                    <th className={styles.numCol}>Cadastrados</th>
                    <th className={styles.numCol}>Tempo até o cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.equipe.processo.map((p) => (
                    <tr key={p.nome}>
                      <td>{p.nome}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{p.cards}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{p.cadastrados}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{fmtTempo(p.ciclo)}</td>
                    </tr>
                  ))}
                  {dados.equipe.processo.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ color: "var(--ink-faint)" }}>Nenhum registro neste período.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className={styles.panel}>
            <h3>Responsável pelo cadastro</h3>
            <div className={styles.tableWrap}>
              <table className={styles.data}>
                <thead>
                  <tr>
                    <th>Responsável</th>
                    <th className={styles.numCol}>Cadastrados</th>
                    <th className={styles.numCol}>Espera em Liberado para cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.equipe.cadastro.map((p) => (
                    <tr key={p.nome}>
                      <td>{p.nome}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{p.cadastrados}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{fmtTempo(p.espera)}</td>
                    </tr>
                  ))}
                  {dados.equipe.cadastro.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ color: "var(--ink-faint)" }}>Nenhum cadastrado neste período.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
