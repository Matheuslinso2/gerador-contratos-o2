import styles from "./painel-seguro-auto.module.css";
import type { PainelSeguroAuto as PainelSeguroAutoData } from "@/lib/seguroAuto/painel";

function fmtPct(v: number | null): string {
  return `${((v ?? 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// % de comissão vem preenchido como número puro (ex: 15 = 15%), não fração
// -- diferente de taxaConversao, que já é fração (0.5 = 50%).
function fmtPctDireto(v: number | null): string {
  if (v === null) return "—";
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function fmtDias(v: number | null): string {
  if (v === null) return "sem histórico";
  return `média ${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}

function fmtData(v: Date): string {
  return v.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
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

function Check({ ok }: { ok: boolean }) {
  return <span className={ok ? styles.positive : styles.negative}>{ok ? "✓" : "—"}</span>;
}

const CLASSE_FILL: Record<string, string> = {
  P: styles.fill,
  S: styles.fillPositive,
  F: styles.fillNegative,
};

export default function PainelSeguroAuto({ dados }: { dados: PainelSeguroAutoData }) {
  const { kpis, funil, distribuicaoUtilizacao, distribuicaoGaragem, cardsAlerta, convertidasFinanceiro, fichas } = dados;
  const maiorQuantidadeFunil = Math.max(1, ...funil.map((e) => e.quantidadeAtual));
  const maiorUtilizacao = Math.max(1, ...distribuicaoUtilizacao.map((d) => d.quantidade));
  const totalGaragem = Math.max(1, distribuicaoGaragem.comGaragem + distribuicaoGaragem.semGaragem);

  return (
    <>
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--ink)" }}>Novidades do mês</h2>
      <div className={styles.kpis}>
        <Kpi label="Fichas no mês" value={String(kpis.total)} sub="cards criados na competência" />
        <Kpi label="Em andamento" value={String(kpis.emAndamento.mesAtual)} sub="deste mês, ainda sendo trabalhadas" tone="info" />
        <Kpi label="Convertidas" value={String(kpis.convertidos.mesAtual)} sub="deste mês, cotação fechada com sucesso" tone="positive" />
        <Kpi label="Perdidas" value={String(kpis.perdidos.mesAtual)} sub="deste mês, não fechou" tone="negative" />
        <Kpi
          label="Com CNH anexada"
          value={fmtPct(kpis.percentualComCnh)}
          sub="fichas novas com documento do condutor"
          tone={kpis.percentualComCnh >= 0.8 ? "positive" : "warning"}
        />
        <Kpi
          label="Com CRLV anexado"
          value={fmtPct(kpis.percentualComCrlv)}
          sub="fichas novas com documento do veículo"
          tone={kpis.percentualComCrlv >= 0.8 ? "positive" : "warning"}
        />
        <Kpi label="Com apólice anterior" value={String(kpis.comApoliceAnterior)} sub="já tinham seguro vigente — possível troca de seguradora" tone="info" />
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: "var(--ink)" }}>Herdado de meses anteriores</h2>
      <div className={styles.kpis}>
        <Kpi label="Em andamento" value={String(kpis.emAndamento.herdado)} sub="ainda em aberto, de outros meses" tone="info" />
        <Kpi label="Convertidas" value={String(kpis.convertidos.herdado)} sub="convertidas este mês, criadas antes" tone="positive" />
        <Kpi label="Perdidas" value={String(kpis.perdidos.herdado)} sub="perdidas este mês, criadas antes" tone="negative" />
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: "var(--ink)" }}>Total do mês (novidades + herdado)</h2>
      <div className={styles.kpis}>
        <Kpi label="Em andamento" value={String(kpis.emAndamento.total)} sub="soma, todas ainda em aberto" tone="info" />
        <Kpi label="Convertidas" value={String(kpis.convertidos.total)} sub="soma, fecharam este mês" tone="positive" />
        <Kpi label="Perdidas" value={String(kpis.perdidos.total)} sub="soma, fecharam este mês" tone="negative" />
        <Kpi
          label="Taxa de conversão"
          value={fmtPct(kpis.taxaConversao)}
          sub="convertidas ÷ (convertidas + perdidas), soma do mês"
          tone={kpis.taxaConversao !== null && kpis.taxaConversao >= 0.5 ? "positive" : undefined}
        />
        <Kpi label="Prêmio efetivado" value={fmtBRL(kpis.premioEfetivado)} sub="soma do prêmio das convertidas este mês" tone="positive" />
        <Kpi label="Comissão gerada" value={fmtBRL(kpis.comissaoGerada)} sub="soma da comissão das convertidas este mês" tone="positive" />
        <Kpi label="% de comissão médio" value={fmtPctDireto(kpis.percentualComissaoMedio)} sub="média entre as convertidas este mês com % preenchido" />
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
        </div>
        <div className={styles.panel}>
          <div className={styles.barlist}>
            {funil.map((etapa) => (
              <div key={etapa.statusId} className={styles.barrow}>
                <div className={styles.rlabel}>{etapa.nome}</div>
                <div className={styles.track}>
                  <div
                    className={CLASSE_FILL[etapa.semantica]}
                    style={{ width: `${(etapa.quantidadeAtual / maiorQuantidadeFunil) * 100}%`, height: "100%" }}
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
              <span className={styles.swatch} style={{ background: "var(--positive)" }} /> Sucesso
            </div>
            <div className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: "var(--negative)" }} /> Perda
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Perfil das fichas do mês</h2>
          <div className={styles.note}>utilização declarada do veículo e presença de garagem</div>
        </div>
        <div className={styles.panel}>
          {distribuicaoUtilizacao.length === 0 ? (
            <div className={styles.panelSub}>Nenhuma ficha registrada neste período.</div>
          ) : (
            <div className={styles.barlist}>
              {distribuicaoUtilizacao.map((d) => (
                <div key={d.rotulo} className={styles.barrow}>
                  <div className={styles.rlabel}>{d.rotulo}</div>
                  <div className={styles.track}>
                    <div className={styles.fill} style={{ width: `${(d.quantidade / maiorUtilizacao) * 100}%`, height: "100%" }} />
                  </div>
                  <div className={`${styles.rvalue} ${styles.num}`}>{d.quantidade}</div>
                </div>
              ))}
            </div>
          )}
          <div className={styles.panelSub} style={{ marginTop: 14 }}>
            Garagem: {distribuicaoGaragem.comGaragem} de {totalGaragem} ({fmtPct(distribuicaoGaragem.comGaragem / totalGaragem)}) têm garagem na residência.
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Cards que pedem atenção</h2>
          <div className={styles.note}>parados 3+ dias sem mudar de etapa — todas as fichas ativas, sem filtro de mês</div>
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
          <h2>Convertidas — prêmio e comissão</h2>
          <div className={styles.note}>preenchido manualmente pelo time depois do fechamento, só nas fichas da competência selecionada</div>
        </div>
        <div className={styles.panel}>
          {convertidasFinanceiro.length === 0 ? (
            <div className={styles.panelSub}>Nenhuma conversão com prêmio/comissão registrados neste período.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.data}>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className={styles.numCol}>Prêmio efetivado</th>
                    <th className={styles.numCol}>Comissão gerada</th>
                    <th className={styles.numCol}>% comissão</th>
                    <th className={styles.numCol}>Parcelas</th>
                  </tr>
                </thead>
                <tbody>
                  {convertidasFinanceiro.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nome || `Card #${c.id}`}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(c.premioEfetivado)}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{fmtBRL(c.comissaoGerada)}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{fmtPctDireto(c.percentualComissao || null)}</td>
                      <td className={`${styles.numCol} ${styles.num}`}>{c.numeroParcelas || "—"}</td>
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
          <h2>Fichas recebidas</h2>
          <div className={styles.note}>{fichas.length} ficha(s) na competência</div>
        </div>
        <div className={styles.panel}>
          {fichas.length === 0 ? (
            <div className={styles.panelSub}>Nenhuma ficha recebida neste período.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.data}>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Telefone</th>
                    <th>E-mail</th>
                    <th>Etapa</th>
                    <th className={styles.numCol}>CNH</th>
                    <th className={styles.numCol}>CRLV</th>
                    <th>Recebida em</th>
                  </tr>
                </thead>
                <tbody>
                  {fichas.map((f) => (
                    <tr key={f.id}>
                      <td>{f.nome || "—"}</td>
                      <td>{f.telefone || "—"}</td>
                      <td>{f.email || "—"}</td>
                      <td>{f.etapaNome}</td>
                      <td className={styles.numCol}>
                        <Check ok={f.temCnh} />
                      </td>
                      <td className={styles.numCol}>
                        <Check ok={f.temCrlv} />
                      </td>
                      <td>{fmtData(f.criadoEm)}</td>
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
