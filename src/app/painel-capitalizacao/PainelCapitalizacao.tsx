import styles from "./painel-capitalizacao.module.css";
import type { PainelCapitalizacao as PainelCapitalizacaoData } from "@/lib/capitalizacao/painel";
import TitulosTabela from "./TitulosTabela";
import ExportarQuadro from "@/components/ExportarQuadro";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPct(v: number | null): string {
  return `${((v ?? 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

function fmtDias(v: number | null): string {
  if (v === null) return "sem histórico";
  return `média ${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "positive" | "negative" | "warning" | "info";
}) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${styles.num} ${tone ? styles[tone] : ""}`}>{value}</div>
      <div className={styles.kpiSub}>{sub}</div>
    </div>
  );
}

const CLASSE_FILL: Record<string, string> = {
  P: styles.fill,
  S: styles.fillPositive,
  F: styles.fillNegative,
};

export default function PainelCapitalizacao({ dados }: { dados: PainelCapitalizacaoData }) {
  const { kpis, funil, cardsAlerta, titulos } = dados;
  const maiorQuantidade = Math.max(1, ...funil.map((e) => e.quantidadeAtual));

  const arquivo = (sufixo: string) => `capitalizacao-${sufixo}-${dados.competencia}`;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--ink)" }}>Novidades do mês</h2>
        <ExportarQuadro
          quadroId="quadro-cap-novidades"
          nomeArquivo={arquivo("novidades")}
          dadosExcel={[
            { indicador: "Solicitações no mês", valor: kpis.total },
            { indicador: "Emitidos", valor: kpis.emitidos },
            { indicador: "Perdidos", valor: kpis.perdidos },
            { indicador: "Taxa de conversão", valor: fmtPct(kpis.taxaConversao) },
            { indicador: "Valor total emitido", valor: kpis.valorTotalEmitido },
            { indicador: "Comissão efetivada", valor: kpis.comissaoEfetivada },
            { indicador: "Comissão potencial", valor: kpis.comissaoPotencial },
            { indicador: "Prêmio potencial", valor: kpis.premioPotencial },
            { indicador: "Imobiliárias", valor: kpis.numeroImobiliarias },
            { indicador: "Ticket médio", valor: kpis.ticketMedioPremio },
          ]}
          nomeAbaExcel="Novidades do mês"
        />
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-muted, #93a2b5)", margin: "0 0 8px" }}>
        Emitidos/Perdidos contam pelo mês em que o card foi criado, não pelo mês em que o Bitrix registrou a conclusão
        (evita atribuir ao mês errado um card que só teve a etapa atualizada depois, ex: esperando o Controle
        confirmar no Corp).
      </p>
      <div id="quadro-cap-novidades" className={styles.kpis}>
        <Kpi label="Solicitações no mês" value={String(kpis.total)} sub="cards criados na competência" />
        <Kpi label="Emitidos" value={String(kpis.emitidos)} sub="título emitido com sucesso" tone="positive" />
        <Kpi label="Perdidos" value={String(kpis.perdidos)} sub="pagamento não realizado ou desistência" tone="negative" />
        <Kpi
          label="Taxa de conversão"
          value={fmtPct(kpis.taxaConversao)}
          sub="emitidos ÷ (emitidos + perdidos)"
          tone={kpis.taxaConversao !== null && kpis.taxaConversao >= 0.5 ? "positive" : undefined}
        />
        <Kpi label="Valor total emitido" value={fmtBRL(kpis.valorTotalEmitido)} sub="soma do prêmio dos emitidos" />
        <Kpi label="Comissão efetivada" value={fmtBRL(kpis.comissaoEfetivada)} sub="comissão dos emitidos" tone="positive" />
        <Kpi label="Comissão potencial" value={fmtBRL(kpis.comissaoPotencial)} sub="todos os cards novos com comissão preenchida" tone="info" />
        <Kpi label="Prêmio potencial" value={fmtBRL(kpis.premioPotencial)} sub="soma do prêmio de todos os cards novos" tone="info" />
        <Kpi label="Imobiliárias" value={String(kpis.numeroImobiliarias)} sub="imobiliárias distintas com cards novos" />
        <Kpi label="Ticket médio" value={fmtBRL(kpis.ticketMedioPremio)} sub="prêmio médio por card novo" />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: "var(--ink)" }}>Em andamento (novos + herdados)</h2>
        <ExportarQuadro
          quadroId="quadro-cap-andamento"
          nomeArquivo={arquivo("em-andamento")}
          dadosExcel={[
            { indicador: "Novos", valor: kpis.emAndamento.mesAtual },
            { indicador: "Herdados", valor: kpis.emAndamento.herdado },
            { indicador: "Total", valor: kpis.emAndamento.total },
            { indicador: "Cards com alerta", valor: kpis.cardsComAlerta },
          ]}
          nomeAbaExcel="Em andamento"
        />
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-muted, #93a2b5)", margin: "0 0 8px" }}>
        Único quadro que herda de meses anteriores — assim que o card conclui (emitido/perdido), ele deixa de ser
        herdado e passa a contar no mês em que nasceu, acima.
      </p>
      <div id="quadro-cap-andamento" className={styles.kpis}>
        <Kpi label="Novos" value={String(kpis.emAndamento.mesAtual)} sub="criados neste mês, ainda em aberto" tone="info" />
        <Kpi label="Herdados" value={String(kpis.emAndamento.herdado)} sub="criados antes, ainda em aberto" tone="info" />
        <Kpi label="Total" value={String(kpis.emAndamento.total)} sub="soma, todos ainda em aberto" tone="info" />
        <Kpi
          label="Cards com alerta"
          value={String(kpis.cardsComAlerta)}
          sub="parados 3+ dias sem mudar de etapa"
          tone={kpis.cardsComAlerta > 0 ? "warning" : "positive"}
        />
      </div>

      <section id="quadro-cap-funil" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Funil e tempo por etapa</h2>
          <div className={styles.note}>
            &ldquo;Pagamento concluído (cartão)&rdquo; e &ldquo;Boleto pago&rdquo; são caminhos alternativos do mesmo
            passo — cada card passa só por um dos dois
          </div>
          <ExportarQuadro
            quadroId="quadro-cap-funil"
            nomeArquivo={arquivo("funil")}
            dadosExcel={funil.map((e) => ({
              etapa: e.nome,
              cards: e.quantidadeAtual,
              tempo_medio_dias: e.tempoMedioDiasFechado ?? "",
            }))}
            nomeAbaExcel="Funil"
          />
        </div>
        <div className={styles.panel}>
          <div className={styles.barlist}>
            {funil.map((etapa) => (
              <div key={etapa.statusId} className={styles.barrow}>
                <div className={styles.rlabel}>{etapa.nome}</div>
                <div className={styles.track}>
                  <div
                    className={CLASSE_FILL[etapa.semantica]}
                    style={{ width: `${(etapa.quantidadeAtual / maiorQuantidade) * 100}%`, height: "100%" }}
                  />
                </div>
                <div className={`${styles.rvalue} ${styles.num}`}>
                  {etapa.quantidadeAtual} card{etapa.quantidadeAtual === 1 ? "" : "s"} · {fmtDias(etapa.tempoMedioDiasFechado)}
                </div>
              </div>
            ))}
          </div>
          <div className={styles.legendRow}>
            <div className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: "var(--accent)" }} /> Em andamento
            </div>
            <div className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: "var(--positive)" }} /> Emitido
            </div>
            <div className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: "var(--negative)" }} /> Pagamento não realizado / Desistência
            </div>
          </div>
        </div>
      </section>

      <section id="quadro-cap-alerta" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Cards que pedem atenção</h2>
          <div className={styles.note}>parados 3+ dias sem mudar de etapa — todos os títulos ativos, sem filtro de mês</div>
          <ExportarQuadro
            quadroId="quadro-cap-alerta"
            nomeArquivo={arquivo("cards-alerta")}
            dadosExcel={cardsAlerta.map((c) => ({
              card: c.titulo || `Card #${c.id}`,
              etapa: c.etapaNome,
              dias_parado: c.diasParado,
            }))}
            nomeAbaExcel="Cards com alerta"
          />
        </div>
        <div className={styles.panel}>
          {cardsAlerta.length === 0 ? (
            <div className={styles.panelSub}>Nenhum card parado no momento.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.data}>
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Etapa</th>
                    <th className={styles.numCol}>Dias parado</th>
                  </tr>
                </thead>
                <tbody>
                  {cardsAlerta.map((card) => (
                    <tr key={card.id}>
                      <td>{card.titulo || `Card #${card.id}`}</td>
                      <td>{card.etapaNome}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{card.diasParado}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section id="quadro-cap-titulos" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Títulos solicitados</h2>
          <div className={styles.note}>novidades do mês + em andamento herdados — mesma lógica dos KPIs acima</div>
          <ExportarQuadro
            quadroId="quadro-cap-titulos"
            nomeArquivo={arquivo("titulos")}
            dadosExcel={titulos.map((t) => ({
              titular: t.titular,
              imobiliaria: t.imobiliaria,
              etapa: t.etapaNome,
              valor_titulo: t.valorTitulo,
              comissao: t.comissao,
            }))}
            nomeAbaExcel="Títulos"
          />
        </div>
        <div className={styles.panel}>
          {titulos.length === 0 ? <div className={styles.panelSub}>Nenhum título encontrado.</div> : <TitulosTabela titulos={titulos} />}
        </div>
      </section>
    </>
  );
}
