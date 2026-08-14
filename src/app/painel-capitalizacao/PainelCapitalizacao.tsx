import styles from "./painel-capitalizacao.module.css";
import type { PainelCapitalizacao as PainelCapitalizacaoData } from "@/lib/capitalizacao/painel";

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
      <div className={styles.kpis}>
        <Kpi label="Solicitações no mês" value={String(kpis.total)} sub="cards criados na competência" />
        <Kpi label="Em andamento" value={String(kpis.emAndamento)} sub="ainda sendo trabalhados" tone="info" />
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
        <Kpi label="Comissão potencial" value={fmtBRL(kpis.comissaoPotencial)} sub="todos os cards com comissão preenchida" tone="info" />
        <Kpi
          label="Cards com alerta"
          value={String(kpis.cardsComAlerta)}
          sub="parados 3+ dias sem mudar de etapa"
          tone={kpis.cardsComAlerta > 0 ? "warning" : "positive"}
        />
        <Kpi label="Prêmio potencial" value={fmtBRL(kpis.premioPotencial)} sub="soma do prêmio de todos os cards do mês" tone="info" />
        <Kpi label="Imobiliárias" value={String(kpis.numeroImobiliarias)} sub="imobiliárias distintas com cards no mês" />
        <Kpi label="Ticket médio" value={fmtBRL(kpis.ticketMedioPremio)} sub="prêmio médio por card no mês" />
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
          {titulos.length === 0 ? (
            <div className={styles.panelSub}>Nenhum título encontrado.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.data}>
                <thead>
                  <tr>
                    <th>Titular</th>
                    <th>Imobiliária</th>
                    <th>Status</th>
                    <th className={styles.numCol}>Prêmio</th>
                    <th className={styles.numCol}>Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {titulos.map((t) => (
                    <tr key={t.id}>
                      <td>{t.titular}</td>
                      <td>{t.imobiliaria}</td>
                      <td>{t.etapaNome}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(t.valorTitulo)}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(t.comissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
