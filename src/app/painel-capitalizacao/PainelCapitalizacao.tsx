import styles from "./painel-capitalizacao.module.css";
import type { PainelCapitalizacao as PainelCapitalizacaoData } from "@/lib/capitalizacao/painel";
import TitulosTabela from "./TitulosTabela";

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

  return (
    <>
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--ink)" }}>Novidades do mês</h2>
      <div className={styles.kpis}>
        <Kpi label="Solicitações no mês" value={String(kpis.total)} sub="cards criados na competência" />
        <Kpi label="Em andamento" value={String(kpis.emAndamento.mesAtual)} sub="deste mês, ainda sendo trabalhados" tone="info" />
        <Kpi label="Emitidos" value={String(kpis.emitidos.mesAtual)} sub="deste mês, título emitido com sucesso" tone="positive" />
        <Kpi label="Perdidos" value={String(kpis.perdidos.mesAtual)} sub="deste mês, pagamento não realizado ou desistência" tone="negative" />
        <Kpi label="Comissão potencial" value={fmtBRL(kpis.comissaoPotencial)} sub="todos os cards novos com comissão preenchida" tone="info" />
        <Kpi label="Prêmio potencial" value={fmtBRL(kpis.premioPotencial)} sub="soma do prêmio de todos os cards novos" tone="info" />
        <Kpi label="Imobiliárias" value={String(kpis.numeroImobiliarias)} sub="imobiliárias distintas com cards novos" />
        <Kpi label="Ticket médio" value={fmtBRL(kpis.ticketMedioPremio)} sub="prêmio médio por card novo" />
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: "var(--ink)" }}>Herdado de meses anteriores</h2>
      <div className={styles.kpis}>
        <Kpi label="Em andamento" value={String(kpis.emAndamento.herdado)} sub="ainda em aberto, de outros meses" tone="info" />
        <Kpi label="Emitidos" value={String(kpis.emitidos.herdado)} sub="emitidos este mês, criados antes" tone="positive" />
        <Kpi label="Perdidos" value={String(kpis.perdidos.herdado)} sub="perdidos este mês, criados antes" tone="negative" />
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: "var(--ink)" }}>Total do mês (novidades + herdado)</h2>
      <div className={styles.kpis}>
        <Kpi label="Em andamento" value={String(kpis.emAndamento.total)} sub="soma, todos ainda em aberto" tone="info" />
        <Kpi label="Emitidos" value={String(kpis.emitidos.total)} sub="soma, fecharam este mês" tone="positive" />
        <Kpi label="Perdidos" value={String(kpis.perdidos.total)} sub="soma, fecharam este mês" tone="negative" />
        <Kpi
          label="Taxa de conversão"
          value={fmtPct(kpis.taxaConversao)}
          sub="emitidos ÷ (emitidos + perdidos), soma do mês"
          tone={kpis.taxaConversao !== null && kpis.taxaConversao >= 0.5 ? "positive" : undefined}
        />
        <Kpi label="Valor total emitido" value={fmtBRL(kpis.valorTotalEmitido)} sub="soma do prêmio dos emitidos este mês" />
        <Kpi label="Comissão efetivada" value={fmtBRL(kpis.comissaoEfetivada)} sub="comissão dos emitidos este mês" tone="positive" />
        <Kpi
          label="Cards com alerta"
          value={String(kpis.cardsComAlerta)}
          sub="parados 3+ dias sem mudar de etapa"
          tone={kpis.cardsComAlerta > 0 ? "warning" : "positive"}
        />
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Funil e tempo por etapa</h2>
          <div className={styles.note}>
            &ldquo;Pagamento concluído (cartão)&rdquo; e &ldquo;Boleto pago&rdquo; são caminhos alternativos do mesmo
            passo — cada card passa só por um dos dois
          </div>
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

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Cards que pedem atenção</h2>
          <div className={styles.note}>parados 3+ dias sem mudar de etapa — todos os títulos ativos, sem filtro de mês</div>
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

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Títulos solicitados</h2>
          <div className={styles.note}>todos os títulos ativos, sem filtro de mês</div>
        </div>
        <div className={styles.panel}>
          {titulos.length === 0 ? <div className={styles.panelSub}>Nenhum título encontrado.</div> : <TitulosTabela titulos={titulos} />}
        </div>
      </section>
    </>
  );
}
