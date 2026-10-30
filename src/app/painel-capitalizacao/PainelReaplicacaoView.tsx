import styles from "./painel-capitalizacao.module.css";
import type { PainelReaplicacao } from "@/lib/capitalizacao/reaplicacao";
import type { LinhaStatusCapUnificada } from "@/lib/capitalizacao/statusUnificado";
import StatusCardsTabela, { type LinhaStatus, type RotulosStatus } from "./StatusCardsTabela";
import TitulosTabela from "./TitulosTabela";
import ExportarQuadro from "@/components/ExportarQuadro";
import InfoLegenda from "@/components/InfoLegenda";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`);

function rotuloMes(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const curto = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(ano, mes - 1, 1)));
  return `${curto.replace(".", "")}/${ano}`;
}

const ROTULOS_REAPLICACAO: RotulosStatus = {
  solicitacoes: "Cards",
  naoPagas: "Não renovaram",
  fechadas: "Renovadas",
  premioSolicitado: "Valor dos títulos",
  premioFechado: "Valor renovado",
  comissao: "Comissão",
  legendaNaoPagas: "Reaplicações que terminaram em Não renovou no mês — quantidade · % sobre os cards",
  legendaFechadas: "Reaplicações concluídas (Renovado) no mês — quantidade · % sobre os cards",
};

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "positive" | "negative" | "warning" | "info" }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${styles.num} ${tone ? styles[tone] : ""}`}>{value}</div>
      <div className={styles.kpiSub}>{sub}</div>
    </div>
  );
}

// Aba "Reaplicação" do painel de Capitalização (funil Reaplicações, categoria 38). Competência =
// mês da vigência do título; o fluxo do mês é fatiado em vigência neste mês x outros meses.
export default function PainelReaplicacaoView({ painel, imobiliarias }: { painel: PainelReaplicacao; imobiliarias?: LinhaStatusCapUnificada[] }) {
  const { kpis, kpisAnterior, funil, statusSeguradoras, titulos } = painel;
  const linhasImob: LinhaStatus[] = imobiliarias ?? painel.statusImobiliarias;
  const mesAnterior = rotuloMes(kpisAnterior.competencia);
  const maior = Math.max(1, ...funil.map((e) => e.quantidadeAtual));
  const arquivo = (s: string) => `capitalizacao-reaplicacao-${s}-${painel.competencia}`;
  const classeBarra = (semantica: "P" | "S" | "F") => (semantica === "S" ? styles.fillPositive : semantica === "F" ? styles.fillNegative : styles.fill);

  const linhaExcel = (l: LinhaStatus, chave: string) => ({
    [chave]: l.nome,
    cards: l.solicitacoes,
    cards_mes_anterior: l.solicitacoesMesAnterior,
    em_andamento: l.emAndamento,
    nao_renovaram: l.naoPagas,
    renovadas: l.fechadas,
    valor_dos_titulos: l.premioSolicitado,
    valor_renovado: l.premioFechado,
    comissao: l.comissaoFechada,
  });

  return (
    <>
      <section id="quadro-reap-resumo" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>
            Reaplicações do mês
            <InfoLegenda titulo="Reaplicações do mês">
              Funil Reaplicações da Capitalização: cada card é um título que vence e precisa ser reaplicado. Cards = criados no mês mais os herdados ainda em aberto. Renovadas = chegaram em Renovado no mês; Não renovaram = chegaram em Não renovou no mês; taxa = renovadas ÷ (renovadas + não renovaram). Valor = valor atualizado do título, quando preenchido, senão o valor do título. Competência = mês da vigência: a linha de vigência separa o que vence neste mês do que vence em outros meses (negociação antecipada).
            </InfoLegenda>
          </h2>
          <div className={styles.note}>competência = mês da vigência do título</div>
        </div>
        <div className={styles.kpis}>
          <Kpi label="Entradas no mês" value={n(kpis.entradas)} sub={`cards criados · ${n(kpisAnterior.entradas)} em ${mesAnterior}`} tone="info" />
          <Kpi label="Renovadas" value={n(kpis.renovadas)} sub={`${n(kpisAnterior.renovadas)} em ${mesAnterior}`} tone="positive" />
          <Kpi label="Não renovaram" value={n(kpis.naoRenovaram)} sub={`${n(kpisAnterior.naoRenovaram)} em ${mesAnterior}`} tone={kpis.naoRenovaram > 0 ? "negative" : undefined} />
          <Kpi label="Taxa de renovação" value={pct(kpis.taxaRenovacao)} sub="renovadas ÷ (renovadas + não renovaram)" />
          <Kpi label="Em andamento" value={n(kpis.emAndamento)} sub="ainda sem Renovado ou Não renovou" tone="warning" />
          <Kpi label="Valor renovado" value={brl(kpis.valorRenovado)} sub="valor atualizado do título quando houver" />
          <Kpi label="Comissão renovada" value={brl(kpis.comissaoRenovada)} sub="dos cards renovados no mês" tone="positive" />
          <Kpi
            label="Vigência neste mês"
            value={n(kpis.vigenciaNoMes.total)}
            sub={`${n(kpis.vigenciaNoMes.renovadas)} renovadas · ${n(kpis.vigenciaOutrosMeses.total)} com vigência em outros meses (${n(kpis.vigenciaOutrosMeses.renovadas)} renovadas)`}
            tone="info"
          />
        </div>
      </section>

      <section id="quadro-reap-funil" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>
            Funil das reaplicações
            <InfoLegenda titulo="Funil das reaplicações">Quantos cards estão em cada etapa agora. Renovado e Não renovou contam só os concluídos neste mês.</InfoLegenda>
          </h2>
          <ExportarQuadro
            quadroId="quadro-reap-funil"
            corFundo="#f7f8fa"
            nomeArquivo={arquivo("funil")}
            dadosExcel={funil.map((e) => ({ etapa: e.nome, cards: e.quantidadeAtual }))}
            nomeAbaExcel="Funil"
          />
        </div>
        <div className={styles.panel}>
          <div className={styles.barlist}>
            {funil.map((e) => (
              <div key={e.statusId} className={styles.barrow}>
                <div className={styles.rlabel}>{e.nome}</div>
                <div className={styles.track}>
                  <div className={classeBarra(e.semantica)} style={{ width: `${(e.quantidadeAtual / maior) * 100}%`, height: "100%" }} />
                </div>
                <div className={`${styles.rvalue} ${styles.num}`}>
                  {e.quantidadeAtual} card{e.quantidadeAtual === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {linhasImob.length > 0 && (
        <section id="quadro-reap-status-imobiliarias" className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>
              Status de todos os cards — por imobiliária
              <InfoLegenda titulo="Status por imobiliária (reaplicação)">
                Uma linha por imobiliária, pela base única de imobiliárias. Cards = reaplicações do mês (criadas no mês + herança); a tendência compara com o mês anterior. Renovadas e Não renovaram contam no mês do desfecho. O ⓥ marca nome ainda sem vínculo confirmado na base.
              </InfoLegenda>
            </h2>
            <ExportarQuadro
              quadroId="quadro-reap-status-imobiliarias"
              corFundo="#f7f8fa"
              nomeArquivo={arquivo("status-imobiliarias")}
              dadosExcel={linhasImob.map((l) => linhaExcel(l, "imobiliaria"))}
              nomeAbaExcel="Imobiliárias"
            />
          </div>
          <div className={styles.panel}>
            <StatusCardsTabela linhas={linhasImob} rotuloPrimeiraColuna="Imobiliária" comBusca rotulos={ROTULOS_REAPLICACAO} />
          </div>
        </section>
      )}

      {statusSeguradoras.length > 0 && (
        <section id="quadro-reap-status-seguradoras" className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>
              Status de todos os cards — por seguradora
              <InfoLegenda titulo="Status por seguradora (reaplicação)">Mesmos números, agrupados pela seguradora do card.</InfoLegenda>
            </h2>
            <ExportarQuadro
              quadroId="quadro-reap-status-seguradoras"
              corFundo="#f7f8fa"
              nomeArquivo={arquivo("status-seguradoras")}
              dadosExcel={statusSeguradoras.map((l) => linhaExcel(l, "seguradora"))}
              nomeAbaExcel="Seguradoras"
            />
          </div>
          <div className={styles.panel}>
            <StatusCardsTabela linhas={statusSeguradoras} rotuloPrimeiraColuna="Seguradora" comBusca={false} rotulos={ROTULOS_REAPLICACAO} />
          </div>
        </section>
      )}

      <section id="quadro-reap-titulos" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>
            Títulos a reaplicar
            <InfoLegenda titulo="Títulos a reaplicar">Os cards do fluxo do mês, com a etapa atual. Dá para filtrar por imobiliária. O valor é o valor atualizado do título, quando preenchido.</InfoLegenda>
          </h2>
          <ExportarQuadro
            quadroId="quadro-reap-titulos"
            corFundo="#f7f8fa"
            nomeArquivo={arquivo("titulos")}
            dadosExcel={titulos.map((t) => ({ titular: t.titular, imobiliaria: t.imobiliaria, etapa: t.etapaNome, vigencia: t.vigencia ?? "", valor: t.valorTitulo, comissao: t.comissao }))}
            nomeAbaExcel="Títulos"
          />
        </div>
        <div className={styles.panel}>
          {titulos.length === 0 ? <div className={styles.panelSub}>Nenhuma reaplicação neste mês.</div> : <TitulosTabela titulos={titulos} />}
        </div>
      </section>
    </>
  );
}
