import styles from "./painel-capitalizacao.module.css";
import type { KpisGrupoReaplicacao, PainelReaplicacao } from "@/lib/capitalizacao/reaplicacao";
import type { LinhaStatusCapUnificada } from "@/lib/capitalizacao/statusUnificado";
import { Comparativo, Kpi } from "./PainelCapitalizacao";
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

type LinhaOrigem = {
  rotulo: string;
  valor: string;
  sub: string;
  div: string | null;
  tone?: "positive" | "negative" | "warning" | "info";
  c: React.ReactNode;
  excel: number | string;
  excelAnt: number | string;
};

// Quadros "Geral do mês (novos + herança)" e "Herança" da aba Reaplicação (pedido do Matheus,
// 04/11/2026; mesmo padrão da Capitalização nova). No geral, cada indicador mostra de onde vem:
// novos + herança.
function QuadroOrigemReap({
  id,
  titulo,
  legenda,
  nota,
  arquivo,
  k,
  ant,
  partes,
  mesAnterior,
  vigencia,
}: {
  id: string;
  titulo: string;
  legenda: React.ReactNode;
  nota: string;
  arquivo: string;
  k: KpisGrupoReaplicacao;
  ant?: KpisGrupoReaplicacao;
  partes?: { novos: KpisGrupoReaplicacao; heranca: KpisGrupoReaplicacao };
  mesAnterior: string;
  vigencia?: { total: number; renovadas: number; outros: number; outrosRenovadas: number };
}) {
  const comp = (atual: number | null, anterior: number | null | undefined, tipo: "numero" | "moeda" | "pct", inverso?: boolean) =>
    ant && anterior !== undefined ? <Comparativo atual={atual} anterior={anterior} tipo={tipo} inverso={inverso} mesAnterior={mesAnterior} /> : null;
  const divisao = (campo: keyof KpisGrupoReaplicacao, moeda = false) => {
    if (!partes) return null;
    const f = (v: number | null) => (moeda ? brl(v ?? 0) : n(v ?? 0));
    return `${f(partes.novos[campo])} novos + ${f(partes.heranca[campo])} herança`;
  };
  const linhas: LinhaOrigem[] = [
    { rotulo: "Cards", valor: n(k.cards), sub: "reaplicações do grupo", div: divisao("cards"), c: comp(k.cards, ant?.cards, "numero"), excel: k.cards, excelAnt: ant?.cards ?? "" },
    { rotulo: "Renovadas", valor: n(k.renovadas), sub: "chegaram em Renovado no mês", div: divisao("renovadas"), tone: "positive", c: comp(k.renovadas, ant?.renovadas, "numero"), excel: k.renovadas, excelAnt: ant?.renovadas ?? "" },
    { rotulo: "Não renovaram", valor: n(k.naoRenovaram), sub: "chegaram em Não renovou no mês", div: divisao("naoRenovaram"), tone: k.naoRenovaram > 0 ? "negative" : undefined, c: comp(k.naoRenovaram, ant?.naoRenovaram, "numero", true), excel: k.naoRenovaram, excelAnt: ant?.naoRenovaram ?? "" },
    { rotulo: "Em andamento", valor: n(k.emAndamento), sub: "ainda sem Renovado ou Não renovou", div: divisao("emAndamento"), tone: "warning", c: comp(k.emAndamento, ant?.emAndamento, "numero"), excel: k.emAndamento, excelAnt: ant?.emAndamento ?? "" },
    { rotulo: "Taxa de renovação", valor: pct(k.taxaRenovacao), sub: "renovadas ÷ (renovadas + não renovaram)", div: null, c: comp(k.taxaRenovacao, ant?.taxaRenovacao, "pct"), excel: pct(k.taxaRenovacao), excelAnt: ant ? pct(ant.taxaRenovacao) : "" },
    { rotulo: "Valor renovado", valor: brl(k.valorRenovado), sub: "valor atualizado do título quando houver", div: divisao("valorRenovado", true), c: comp(k.valorRenovado, ant?.valorRenovado, "moeda"), excel: k.valorRenovado, excelAnt: ant?.valorRenovado ?? "" },
    { rotulo: "Comissão renovada", valor: brl(k.comissaoRenovada), sub: "dos cards renovados no mês", div: divisao("comissaoRenovada", true), tone: "positive", c: comp(k.comissaoRenovada, ant?.comissaoRenovada, "moeda"), excel: k.comissaoRenovada, excelAnt: ant?.comissaoRenovada ?? "" },
    { rotulo: "Valor dos títulos", valor: brl(k.valorTitulos), sub: "de todos os cards, em qualquer situação", div: divisao("valorTitulos", true), tone: "info", c: comp(k.valorTitulos, ant?.valorTitulos, "moeda"), excel: k.valorTitulos, excelAnt: ant?.valorTitulos ?? "" },
    { rotulo: "Comissão potencial", valor: brl(k.comissaoPotencial), sub: "todos os cards (comissão preenchida)", div: divisao("comissaoPotencial", true), tone: "info", c: comp(k.comissaoPotencial, ant?.comissaoPotencial, "moeda"), excel: k.comissaoPotencial, excelAnt: ant?.comissaoPotencial ?? "" },
  ];
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>
          {titulo}
          <InfoLegenda titulo={titulo}>{legenda}</InfoLegenda>
        </h2>
        <ExportarQuadro
          quadroId={`${id}-kpis`}
          corFundo="#f7f8fa"
          nomeArquivo={arquivo}
          dadosExcel={linhas.map((l) => ({ indicador: l.rotulo, valor: l.excel, ...(partes ? { novos_mais_heranca: l.div ?? "" } : {}), mes_anterior: l.excelAnt }))}
          nomeAbaExcel={titulo.slice(0, 31)}
        />
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-muted, #5b6b7c)", margin: "0 0 8px" }}>
        {nota}
        {vigencia && (
          <>
            {" "}
            Vigência neste mês: {n(vigencia.total)} ({n(vigencia.renovadas)} renovadas); com vigência em outros meses (negociação antecipada): {n(vigencia.outros)} ({n(vigencia.outrosRenovadas)} renovadas).
          </>
        )}
      </p>
      <div id={`${id}-kpis`} className={styles.kpis}>
        {linhas.map((l) => (
          <Kpi key={l.rotulo} label={l.rotulo} value={l.valor} sub={l.div ?? l.sub} tone={l.tone} comparativo={l.c} />
        ))}
      </div>
    </section>
  );
}

// Aba "Reaplicação" do painel de Capitalização (funil Reaplicações, categoria 38). Competência =
// mês da vigência do título; o fluxo do mês é fatiado em vigência neste mês x outros meses.
export default function PainelReaplicacaoView({ painel, imobiliarias }: { painel: PainelReaplicacao; imobiliarias?: LinhaStatusCapUnificada[] }) {
  const { kpis, kpisAnterior, funil, statusSeguradoras, titulos, porOrigem: po, porOrigemAnterior: poAnt, porVigencia } = painel;
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
      {po ? (
        <>
          <QuadroOrigemReap
            id="quadro-reap-geral"
            titulo="Geral do mês (novos + herança)"
            arquivo={arquivo("geral")}
            k={po.geral}
            ant={poAnt?.geral}
            partes={po}
            mesAnterior={mesAnterior}
            vigencia={{ total: kpis.vigenciaNoMes.total, renovadas: kpis.vigenciaNoMes.renovadas, outros: kpis.vigenciaOutrosMeses.total, outrosRenovadas: kpis.vigenciaOutrosMeses.renovadas }}
            nota={`Tudo o que foi trabalhado no mês: as ${n(po.novos.cards)} reaplicações criadas no mês mais as ${n(po.heranca.cards)} criadas antes que ainda estavam em aberto no começo do mês. Cada indicador soma os dois e mostra a divisão.`}
            legenda={
              <>
                Funil Reaplicações da Capitalização: cada card é um título que vence e precisa ser reaplicado. Soma dos cards NOVOS (criados no mês) com a HERANÇA (criados em meses anteriores e ainda sem Renovado nem Não renovou no começo do mês — seguem como herança até o fechamento). Cards: {n(po.novos.cards)} novos + {n(po.heranca.cards)} herança = {n(po.geral.cards)}. Renovadas: chegaram em Renovado no mês — {n(po.novos.renovadas)} + {n(po.heranca.renovadas)} = {n(po.geral.renovadas)}. Não renovaram: chegaram em Não renovou no mês — {n(po.novos.naoRenovaram)} + {n(po.heranca.naoRenovaram)} = {n(po.geral.naoRenovaram)}. Em andamento: sem desfecho até o fim do mês — {n(po.novos.emAndamento)} + {n(po.heranca.emAndamento)} = {n(po.geral.emAndamento)}. Taxa = renovadas ÷ (renovadas + não renovaram). Valor = valor atualizado do título, quando preenchido, senão o valor do título. Valor dos títulos e comissão potencial somam todos os cards do grupo, em qualquer situação. As setas comparam com o mês anterior completo. Competência = mês da vigência: a nota separa o que vence neste mês do que vence em outros meses.
              </>
            }
          />
          <QuadroOrigemReap
            id="quadro-reap-heranca"
            titulo="Herança (cards de meses anteriores)"
            arquivo={arquivo("heranca")}
            k={po.heranca}
            ant={poAnt?.heranca}
            mesAnterior={mesAnterior}
            nota="Só as reaplicações criadas em meses anteriores que ainda estavam em aberto no começo do mês: o que delas foi renovado, não renovou ou continua em andamento neste mês."
            legenda={
              <>
                Mesmos indicadores do quadro geral, só da herança: reaplicações criadas antes deste mês e ainda sem Renovado nem Não renovou no começo dele ({n(po.heranca.cards)} cards). Renovadas ({n(po.heranca.renovadas)}) e não renovaram ({n(po.heranca.naoRenovaram)}) contam pelo mês em que o card chegou à etapa; em andamento ({n(po.heranca.emAndamento)}) são os que seguem sem desfecho e continuam como herança no mês seguinte. As setas comparam com a herança do mês anterior.
              </>
            }
          />
        </>
      ) : (
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
      )}

      {porVigencia && porVigencia.length > 0 && (
        <section id="quadro-reap-vigencia" className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>
              Reaplicações por mês de vigência
              <InfoLegenda titulo="Reaplicações por mês de vigência">
                Os mesmos cards do quadro geral (novos + herança), separados pelo mês em que o título vence e será reaplicado (o &ldquo;VENCE dd/mm/aaaa&rdquo; do card). Cada linha é um lote: renovadas + não renovaram + em andamento = cards, pela situação no fim do mês. Os cards são lançados antes do vencimento: a planilha do lote é enviada às imobiliárias cerca de um mês antes e o controle começa aí, até a reaplicação acontecer. A meta consolida por vigência, então some as linhas do mês que interessa. Valor = valor atualizado do título, quando preenchido, senão o valor do título.
              </InfoLegenda>
            </h2>
            <ExportarQuadro
              quadroId="quadro-reap-vigencia-tabela"
              corFundo="#f7f8fa"
              nomeArquivo={arquivo("vigencia")}
              dadosExcel={porVigencia.map((l) => ({
                vigencia: l.mes ?? "sem data",
                lancados_em: l.criadosEm.join(", "),
                cards: l.cards,
                renovadas: l.renovadas,
                nao_renovaram: l.naoRenovaram,
                em_andamento: l.emAndamento,
                taxa_renovacao: pct(l.taxaRenovacao),
                valor_dos_titulos: l.valorTitulos,
                valor_renovado: l.valorRenovado,
                comissao_potencial: l.comissaoPotencial,
                comissao_renovada: l.comissaoRenovada,
              }))}
              nomeAbaExcel="Por vigência"
            />
          </div>
          <p style={{ fontSize: 11.5, color: "var(--ink-muted, #5b6b7c)", margin: "0 0 8px" }}>
            Quando cada lote de reaplicações será (ou deveria ter sido) reaplicado, e como ele está. Os cards já são controlados antes do vencimento porque a planilha do lote é enviada às imobiliárias com antecedência.
          </p>
          <div className={styles.panel}>
            <div id="quadro-reap-vigencia-tabela" className={styles.tableWrap}>
              <table className={styles.data}>
                <thead>
                  <tr>
                    <th>Vigência</th>
                    <th>Situação do lote</th>
                    <th>Lançados em</th>
                    <th className={styles.numCol}>Cards</th>
                    <th className={styles.numCol}>Renovadas</th>
                    <th className={styles.numCol}>Não renovaram</th>
                    <th className={styles.numCol}>Em andamento</th>
                    <th className={styles.numCol}>Taxa</th>
                    <th className={styles.numCol}>Valor dos títulos</th>
                    <th className={styles.numCol}>Valor renovado</th>
                    <th className={styles.numCol}>Comissão potencial</th>
                  </tr>
                </thead>
                <tbody>
                  {porVigencia.map((l) => {
                    const situacao =
                      l.mes === null
                        ? "Sem data de vencimento"
                        : l.mes < painel.competencia
                          ? "Vigência já passou"
                          : l.mes === painel.competencia
                            ? "Vence neste mês"
                            : `Antecipado — vence em ${rotuloMes(l.mes)}`;
                    const atrasado = l.mes !== null && l.mes < painel.competencia && l.emAndamento > 0;
                    return (
                      <tr key={l.mes ?? "sem-data"}>
                        <td>
                          <strong>{l.mes ? rotuloMes(l.mes) : "—"}</strong>
                        </td>
                        <td className={atrasado ? styles.warning : undefined}>{situacao}</td>
                        <td>{l.criadosEm.map(rotuloMes).join(", ")}</td>
                        <td className={`${styles.numCol} ${styles.num}`}>{n(l.cards)}</td>
                        <td className={`${styles.numCol} ${styles.num}`}>{n(l.renovadas)}</td>
                        <td className={`${styles.numCol} ${styles.num}`}>{n(l.naoRenovaram)}</td>
                        <td className={`${styles.numCol} ${styles.num}`}>{n(l.emAndamento)}</td>
                        <td className={`${styles.numCol} ${styles.num}`}>{pct(l.taxaRenovacao)}</td>
                        <td className={`${styles.numCol} ${styles.num}`}>{brl(l.valorTitulos)}</td>
                        <td className={`${styles.numCol} ${styles.num}`}>{brl(l.valorRenovado)}</td>
                        <td className={`${styles.numCol} ${styles.num}`}>{brl(l.comissaoPotencial)}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td />
                    <td />
                    <td className={`${styles.numCol} ${styles.num}`}>
                      <strong>{n(porVigencia.reduce((s, l) => s + l.cards, 0))}</strong>
                    </td>
                    <td className={`${styles.numCol} ${styles.num}`}>
                      <strong>{n(porVigencia.reduce((s, l) => s + l.renovadas, 0))}</strong>
                    </td>
                    <td className={`${styles.numCol} ${styles.num}`}>
                      <strong>{n(porVigencia.reduce((s, l) => s + l.naoRenovaram, 0))}</strong>
                    </td>
                    <td className={`${styles.numCol} ${styles.num}`}>
                      <strong>{n(porVigencia.reduce((s, l) => s + l.emAndamento, 0))}</strong>
                    </td>
                    <td />
                    <td className={`${styles.numCol} ${styles.num}`}>
                      <strong>{brl(porVigencia.reduce((s, l) => s + l.valorTitulos, 0))}</strong>
                    </td>
                    <td className={`${styles.numCol} ${styles.num}`}>
                      <strong>{brl(porVigencia.reduce((s, l) => s + l.valorRenovado, 0))}</strong>
                    </td>
                    <td className={`${styles.numCol} ${styles.num}`}>
                      <strong>{brl(porVigencia.reduce((s, l) => s + l.comissaoPotencial, 0))}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

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
