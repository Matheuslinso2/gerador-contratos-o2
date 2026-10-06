import styles from "./painel-capitalizacao.module.css";
import { competenciaAtual, type PainelCapitalizacao as PainelCapitalizacaoData } from "@/lib/capitalizacao/painel";
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

function rotuloMes(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const curto = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(ano, mes - 1, 1)));
  return `${curto.replace(".", "")}/${ano}`;
}

type ComparativoProps = {
  atual: number | null;
  anterior: number | null;
  tipo: "numero" | "moeda" | "pct";
  // Subir é ruim (ex: perdidos) -- inverte as cores.
  inverso?: boolean;
  mesAnterior: string;
};

// Linha de variação vs o mês anterior completo. Mês anterior zerado mostra
// só a diferença (sem %, pra não aparecer "+∞%"); taxa de conversão vem em
// pontos percentuais.
function Comparativo({ atual, anterior, tipo, inverso, mesAnterior }: ComparativoProps) {
  if (atual === null || anterior === null) {
    return <div className={styles.kpiSub}>— vs {mesAnterior}</div>;
  }
  const diff = tipo === "pct" ? (atual - anterior) * 100 : atual - anterior;
  const igual = Math.abs(diff) < (tipo === "moeda" ? 0.005 : tipo === "pct" ? 0.5 : 0.0001);
  const bom = !igual && diff > 0 !== !!inverso;
  const sinal = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const abs = Math.abs(diff);
  const texto =
    tipo === "moeda"
      ? `${sinal}${fmtBRL(abs)}`
      : tipo === "pct"
        ? `${sinal}${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} p.p.`
        : `${sinal}${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  const pct =
    tipo !== "pct" && anterior > 0
      ? ` (${sinal}${((abs / anterior) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)`
      : "";
  const cor = igual ? "var(--ink-muted, #5b6b7c)" : bom ? "var(--positive)" : "var(--negative)";
  return (
    <div className={styles.kpiSub} style={{ color: cor, fontWeight: 600 }}>
      {igual ? "＝ igual" : `${diff > 0 ? "▲" : "▼"} ${texto}${pct}`} <span style={{ fontWeight: 400 }}>vs {mesAnterior}</span>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  comparativo,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "positive" | "negative" | "warning" | "info";
  comparativo?: React.ReactNode;
}) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${styles.num} ${tone ? styles[tone] : ""}`}>{value}</div>
      <div className={styles.kpiSub}>{sub}</div>
      {comparativo}
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

  const ant = dados.kpisAnterior;
  const mesAnterior = ant ? rotuloMes(ant.competencia) : "";
  const mesEmAndamento = dados.competencia === competenciaAtual();
  const comp = (atual: number | null, anterior: number | null | undefined, tipo: ComparativoProps["tipo"], inverso?: boolean) =>
    ant && anterior !== undefined ? (
      <Comparativo atual={atual} anterior={anterior} tipo={tipo} inverso={inverso} mesAnterior={mesAnterior} />
    ) : null;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--ink)" }}>Novidades do mês</h2>
        <ExportarQuadro
          quadroId="quadro-cap-novidades"
          corFundo="#f7f8fa"
          nomeArquivo={arquivo("novidades")}
          dadosExcel={[
            { indicador: "Solicitações no mês", valor: kpis.total, mes_anterior: ant?.total ?? "" },
            { indicador: "Emitidos", valor: kpis.emitidos, mes_anterior: ant?.emitidos ?? "" },
            { indicador: "Perdidos", valor: kpis.perdidos, mes_anterior: ant?.perdidos ?? "" },
            { indicador: "Taxa de conversão", valor: fmtPct(kpis.taxaConversao), mes_anterior: ant ? fmtPct(ant.taxaConversao) : "" },
            { indicador: "Valor total emitido", valor: kpis.valorTotalEmitido, mes_anterior: ant?.valorTotalEmitido ?? "" },
            { indicador: "Comissão efetivada", valor: kpis.comissaoEfetivada, mes_anterior: ant?.comissaoEfetivada ?? "" },
            { indicador: "Comissão potencial", valor: kpis.comissaoPotencial, mes_anterior: ant?.comissaoPotencial ?? "" },
            { indicador: "Prêmio potencial", valor: kpis.premioPotencial, mes_anterior: ant?.premioPotencial ?? "" },
            { indicador: "Imobiliárias", valor: kpis.numeroImobiliarias, mes_anterior: ant?.numeroImobiliarias ?? "" },
            { indicador: "Ticket médio", valor: kpis.ticketMedioPremio, mes_anterior: ant?.ticketMedioPremio ?? "" },
          ]}
          nomeAbaExcel="Novidades do mês"
        />
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-muted, #5b6b7c)", margin: "0 0 8px" }}>
        Emitidos/Perdidos contam pelo mês em que o card foi criado, não pelo mês em que o Bitrix registrou a conclusão
        (evita atribuir ao mês errado um card que só teve a etapa atualizada depois, ex: esperando o Controle
        confirmar no Corp).
        {ant && mesEmAndamento && ` Variação vs ${mesAnterior} é contra o mês anterior completo; o mês atual ainda está em andamento.`}
      </p>
      <div id="quadro-cap-novidades" className={styles.kpis}>
        <Kpi label="Solicitações no mês" value={String(kpis.total)} sub="cards criados na competência" comparativo={comp(kpis.total, ant?.total, "numero")} />
        <Kpi label="Emitidos" value={String(kpis.emitidos)} sub="título emitido com sucesso" tone="positive" comparativo={comp(kpis.emitidos, ant?.emitidos, "numero")} />
        <Kpi label="Perdidos" value={String(kpis.perdidos)} sub="pagamento não realizado ou desistência" tone="negative" comparativo={comp(kpis.perdidos, ant?.perdidos, "numero", true)} />
        <Kpi
          label="Taxa de conversão"
          value={fmtPct(kpis.taxaConversao)}
          sub="emitidos ÷ (emitidos + perdidos)"
          tone={kpis.taxaConversao !== null && kpis.taxaConversao >= 0.5 ? "positive" : undefined}
          comparativo={comp(kpis.taxaConversao, ant?.taxaConversao, "pct")}
        />
        <Kpi label="Valor total emitido" value={fmtBRL(kpis.valorTotalEmitido)} sub="soma do prêmio dos emitidos" comparativo={comp(kpis.valorTotalEmitido, ant?.valorTotalEmitido, "moeda")} />
        <Kpi label="Comissão efetivada" value={fmtBRL(kpis.comissaoEfetivada)} sub="comissão dos emitidos" tone="positive" comparativo={comp(kpis.comissaoEfetivada, ant?.comissaoEfetivada, "moeda")} />
        <Kpi label="Comissão potencial" value={fmtBRL(kpis.comissaoPotencial)} sub="todos os cards novos com comissão preenchida" tone="info" comparativo={comp(kpis.comissaoPotencial, ant?.comissaoPotencial, "moeda")} />
        <Kpi label="Prêmio potencial" value={fmtBRL(kpis.premioPotencial)} sub="soma do prêmio de todos os cards novos" tone="info" comparativo={comp(kpis.premioPotencial, ant?.premioPotencial, "moeda")} />
        <Kpi label="Imobiliárias" value={String(kpis.numeroImobiliarias)} sub="imobiliárias distintas com cards novos" comparativo={comp(kpis.numeroImobiliarias, ant?.numeroImobiliarias, "numero")} />
        <Kpi label="Ticket médio" value={fmtBRL(kpis.ticketMedioPremio)} sub="prêmio médio por card novo" comparativo={comp(kpis.ticketMedioPremio, ant?.ticketMedioPremio, "moeda")} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: "var(--ink)" }}>Em andamento (novos + herdados)</h2>
        <ExportarQuadro
          quadroId="quadro-cap-andamento"
          corFundo="#f7f8fa"
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
      <p style={{ fontSize: 11.5, color: "var(--ink-muted, #5b6b7c)", margin: "0 0 8px" }}>
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
          sub="parados 3+ dias úteis sem mudar de etapa"
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
            corFundo="#f7f8fa"
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
          <div className={styles.note}>parados 3+ dias úteis sem mudar de etapa — todos os títulos ativos, sem filtro de mês</div>
          <ExportarQuadro
            quadroId="quadro-cap-alerta"
            corFundo="#f7f8fa"
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
            corFundo="#f7f8fa"
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
