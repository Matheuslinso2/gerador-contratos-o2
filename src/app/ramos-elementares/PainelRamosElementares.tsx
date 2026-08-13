"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AnaliseRamosElementares, GrupoStatus, ItemAgrupado, RegistroNegociacao, ResumoPopulacao } from "@/lib/ramos-elementares/analise";
import styles from "./ramos-elementares.module.css";
import kanbanStyles from "./kanban.module.css";

type AbaPainel = "visao" | "novos" | "renovacoes" | "financeiro" | "endossos" | "alertas" | "emails";
type EmailConfirmacao = {
  aba: string | null;
  linha: number | null;
  tipo_confirmacao: "contratacao_confirmada" | "apolice_emitida" | "cancelamento_confirmado" | "outro" | "nao_identificado";
  recebido_em: string;
  divergencia: boolean;
  divergencia_tipo: "nao_encontrado" | "status_desatualizado" | null;
  divergencia_motivo: string | null;
  cliente_nome: string | null;
  e_lote: boolean;
};
type RecorteNovos = "consolidado" | "mes" | "pendentes";
type RecorteRenovacao = "atual" | "futura";

function brl(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(valor: number | null): string {
  return valor === null ? "Sem amostra" : `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function duracao(minutos: number | null): string {
  if (minutos === null) return "Sem amostra";
  const totalSegundos = Math.round(minutos * 60);
  const horas = Math.floor(totalSegundos / 3600);
  const mins = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;
  if (horas) return `${horas}h ${String(mins).padStart(2, "0")}min`;
  return `${mins}min ${String(segundos).padStart(2, "0")}s`;
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "ok" | "warning" | "danger" }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${tone ? styles[tone] : ""}`}>{value}</div>
      <div className={styles.kpiNote}>{note}</div>
    </div>
  );
}
function Barras({ dados, limite = 8 }: { dados: ItemAgrupado[]; limite?: number }) {
  const visiveis = dados.slice(0, limite);
  const maximo = Math.max(...visiveis.map((item) => item.total), 1);
  if (!visiveis.length) return <div className={styles.zeroState}>Nenhum registro — 0</div>;
  return (
    <div className={styles.barras}>
      {visiveis.map((item) => (
        <div className={styles.barraLinha} key={item.nome}>
          <div className={styles.barraNome}>{item.nome}</div>
          <div className={styles.trilho}>
            <div className={styles.preenchimento} style={{ width: `${Math.max(2, (item.total / maximo) * 100)}%` }} />
          </div>
          <div className={styles.barraValor}>{item.total}</div>
        </div>
      ))}
    </div>
  );
}

function ListaAgrupada({ dados, tituloVazio = "Nenhum registro" }: { dados: ItemAgrupado[]; tituloVazio?: string }) {
  const [expandida, setExpandida] = useState(false);
  const visiveis = expandida ? dados : dados.slice(0, 10);
  return (
    <div>
      <div className={styles.listaCabecalho} aria-hidden="true">
        <span>Nome</span><span>Total</span><span>Efetivados</span><span>Conversão</span>
      </div>
      <div className={styles.listaDados}>
        {visiveis.map((item) => (
          <div className={styles.listaLinha} key={item.nome}>
            <strong>{item.nome}</strong>
            <span><small>Total</small>{item.total}</span>
            <span><small>Efetivados</small>{item.efetivados}</span>
            <span><small>Conversão</small>{pct(item.conversao)}</span>
          </div>
        ))}
        {!dados.length && <div className={styles.zeroState}>{tituloVazio} — 0</div>}
      </div>
      {dados.length > 10 && (
        <button type="button" className={styles.expandir} onClick={() => setExpandida((valor) => !valor)}>
          {expandida ? "Mostrar apenas as 10 maiores" : `Mostrar todas (mais ${dados.length - 10})`}
        </button>
      )}
    </div>
  );
}

function ResumoStatus({ resumo }: { resumo: ResumoPopulacao }) {
  return <Barras dados={resumo.porStatus} limite={12} />;
}

function PainelVisao({ analise }: { analise: AnaliseRamosElementares }) {
  const atencao = [...analise.alertasOperacionais, ...analise.qualidade].filter((item) => item.quantidade > 0).slice(0, 5);
  return (
    <>
      <div className={styles.kpis}>
        <Kpi label="Novas entradas" value={String(analise.visaoGeral.novasEntradas)} note="NOVOS MÊS" />
        <Kpi label="Pendências anteriores" value={String(analise.visaoGeral.pendenciasAnteriores)} note="Carteira de entrada" />
        <Kpi label="Renovações da competência" value={String(analise.visaoGeral.renovacoesCompetencia)} note="Competência selecionada" />
        <Kpi label="Novos efetivados" value={String(analise.visaoGeral.novosEfetivados)} note="Mês + pendências" tone="ok" />
        <Kpi label="Renovações efetivadas" value={String(analise.visaoGeral.renovacoesEfetivadas)} note={pct(analise.renovacoes.atual.conversao)} tone="ok" />
        <Kpi label="Comissão dos efetivados" value={brl(analise.visaoGeral.comissaoEfetivada)} note="Valor estimado" tone="ok" />
      </div>
      <div className={styles.duasColunas}>
        <section className={styles.panel}>
          <h2>Novos negócios — situação atual</h2>
          <p>{analise.novos.consolidado.total} registros entre novos do mês e pendências anteriores</p>
          <ResumoStatus resumo={analise.novos.consolidado} />
        </section>
        <section className={styles.panel}>
          <h2>Renovações — competência atual</h2>
          <p>A próxima competência não entra nesta conversão</p>
          <ResumoStatus resumo={analise.renovacoes.atual} />
        </section>
      </div>
      <div className={styles.duasColunas}>
        <section className={styles.panel}>
          <h2>Ramos com maior volume</h2>
          <p>Produtos somados, mantendo a SUSEP como dimensão operacional</p>
          <Barras
            dados={[
              ...analise.novos.consolidado.porRamo,
              ...analise.renovacoes.atual.porRamo,
            ].reduce<ItemAgrupado[]>((acumulado, item) => {
              const existente = acumulado.find((atual) => atual.nome === item.nome);
              if (existente) {
                existente.total += item.total;
                existente.efetivados += item.efetivados;
                existente.comissao += item.comissao;
                existente.comissaoEfetivada += item.comissaoEfetivada;
                existente.conversao = existente.total ? (existente.efetivados / existente.total) * 100 : null;
              } else acumulado.push({ ...item });
              return acumulado;
            }, []).sort((a, b) => b.total - a.total)}
          />
        </section>
        <section className={styles.panel}>
          <h2>Pontos que exigem atenção</h2>
          <p>Somente ocorrências reais encontradas na leitura</p>
          <div className={styles.alertasCompactos}>
            {atencao.map((item) => (
              <div className={styles.alertaCompacto} key={item.codigo}>
                <div><strong>{item.titulo}</strong><span>{item.descricao}</span></div>
                <b className={item.gravidade === "alta" ? styles.danger : styles.warning}>{item.quantidade}</b>
              </div>
            ))}
            {!atencao.length && <div className={styles.zeroState}>Nenhum alerta ativo — 0</div>}
          </div>
        </section>
      </div>
    </>
  );
}

function PainelNovos({ analise }: { analise: AnaliseRamosElementares }) {
  const [recorte, setRecorte] = useState<RecorteNovos>("consolidado");
  const resumo = analise.novos[recorte];
  return (
    <>
      <div className={styles.filtros}>
        {(["consolidado", "mes", "pendentes"] as RecorteNovos[]).map((item) => (
          <button key={item} type="button" className={recorte === item ? styles.filtroAtivo : styles.filtro} onClick={() => setRecorte(item)}>
            {item === "consolidado" ? "Consolidado" : item === "mes" ? "Novos do mês" : "Pendências anteriores"}
          </button>
        ))}
      </div>
      <div className={styles.kpis}>
        <Kpi label="Total" value={String(resumo.total)} note="Registros com status" />
        <Kpi label="Efetivados" value={String(resumo.efetivados)} note={pct(resumo.conversao)} tone="ok" />
        <Kpi label="Comissão potencial" value={brl(resumo.comissaoPotencial)} note="Carteira selecionada" />
        <Kpi label="Comissão dos efetivados" value={brl(resumo.comissaoEfetivada)} note="Somente efetivados" tone="ok" />
        <Kpi label="Resultado estimado O2" value={brl(resumo.resultadoEstimado)} note="Comissão menos repasse" tone="ok" />
        <Kpi label="Tempo médio" value={duracao(resumo.tempoMedioMinutos)} note={`${resumo.temposValidos} tempos válidos`} />
      </div>
      <div className={styles.duasColunas}>
        <section className={styles.panel}><h2>Status</h2><p>Distribuição atual dos registros</p><ResumoStatus resumo={resumo} /></section>
        <section className={styles.panel}><h2>Produção por cotador ou origem</h2><p>Produção direta permanece separada das pessoas</p><Barras dados={resumo.porCotador} limite={12} /></section>
      </div>
      <div className={styles.duasColunas}>
        <section className={styles.panel}><h2>Ramos</h2><p>Quantidade, efetivação e conversão</p><ListaAgrupada dados={resumo.porRamo} /></section>
        <section className={styles.panel}><h2>Seguradoras</h2><p>Segimob é apresentado como origem sem seguradora informada</p><ListaAgrupada dados={resumo.porSeguradora} /></section>
      </div>
      <section className={styles.panel}>
        <h2>Imobiliárias — 100% da produção</h2>
        <p>As 10 maiores aparecem primeiro; o botão revela todas com pelo menos um registro</p>
        <ListaAgrupada dados={resumo.porImobiliaria} tituloVazio="Nenhuma imobiliária" />
      </section>
    </>
  );
}

function PainelRenovacoes({ analise }: { analise: AnaliseRamosElementares }) {
  const [recorte, setRecorte] = useState<RecorteRenovacao>("atual");
  const resumo = analise.renovacoes[recorte];
  return (
    <>
      <div className={styles.filtros}>
        <button type="button" className={recorte === "atual" ? styles.filtroAtivo : styles.filtro} onClick={() => setRecorte("atual")}>Competência atual</button>
        <button type="button" className={recorte === "futura" ? styles.filtroAtivo : styles.filtro} onClick={() => setRecorte("futura")}>Próxima competência</button>
      </div>
      <div className={styles.kpis}>
        <Kpi label="Carteira" value={String(resumo.total)} note={recorte === "atual" ? "Resultado atual" : "Previsão operacional"} />
        <Kpi label="Efetivados" value={String(resumo.efetivados)} note={recorte === "atual" ? pct(resumo.conversao) : "Não misturar com o mês atual"} tone="ok" />
        <Kpi label="Comissão anterior" value={brl(resumo.comissaoAnterior)} note="Referência registrada" />
        <Kpi label="Comissão atual prevista" value={brl(resumo.comissaoPotencial)} note="Carteira total" />
        <Kpi label="Comissão dos efetivados" value={brl(resumo.comissaoEfetivada)} note="Somente efetivados" tone="ok" />
        <Kpi label="Resultado estimado O2" value={brl(resumo.resultadoEstimado)} note="Comissão menos repasse" tone="ok" />
      </div>
      <div className={styles.duasColunas}>
        <section className={styles.panel}><h2>Status da carteira</h2><p>{recorte === "atual" ? "Conversão calculada na competência" : "Preparação do próximo período"}</p><ResumoStatus resumo={resumo} /></section>
        <section className={styles.panel}><h2>Produção por cotador</h2><p>Registros atribuídos a cada responsável</p><Barras dados={resumo.porCotador} limite={12} /></section>
      </div>
      <div className={styles.duasColunas}>
        <section className={styles.panel}><h2>Ramos</h2><ListaAgrupada dados={resumo.porRamo} /></section>
        <section className={styles.panel}><h2>Seguradoras</h2><ListaAgrupada dados={resumo.porSeguradora} /></section>
      </div>
      <section className={styles.panel}><h2>Imobiliárias — carteira completa</h2><ListaAgrupada dados={resumo.porImobiliaria} tituloVazio="Nenhuma imobiliária" /></section>
    </>
  );
}

function LinhaFinanceira({ nome, resumo }: { nome: string; resumo: ResumoPopulacao }) {
  const conversao = resumo.comissaoPotencial > 0 ? (resumo.comissaoEfetivada / resumo.comissaoPotencial) * 100 : null;
  return (
    <div className={styles.financeRow}>
      <strong>{nome}</strong>
      <span><small>Potencial</small>{brl(resumo.comissaoPotencial)}</span>
      <span><small>Efetivada</small>{brl(resumo.comissaoEfetivada)}</span>
      <span><small>Conversão financeira</small>{pct(conversao)}</span>
    </div>
  );
}

function PainelFinanceiro({ analise }: { analise: AnaliseRamosElementares }) {
  return (
    <>
      <div className={styles.avisoNeutro}>Valores operacionais estimados. Não representam receita recebida ou lucro realizado.</div>
      <div className={styles.kpis}>
        <Kpi label="Comissão potencial" value={brl(analise.financeiro.comissaoPotencial)} note="Carteira total atual" />
        <Kpi label="Comissão dos efetivados" value={brl(analise.financeiro.comissaoEfetivada)} note="Status EFETIVADO" tone="ok" />
        <Kpi label="Repasse estimado" value={brl(analise.financeiro.repasseEstimado)} note="Somente efetivados" />
        <Kpi label="Resultado estimado O2" value={brl(analise.financeiro.resultadoEstimado)} note="Comissão menos repasse" tone="ok" />
        <Kpi label="Conversão financeira" value={pct(analise.financeiro.conversaoFinanceira)} note="Efetivada ÷ potencial" />
      </div>
      <section className={styles.panel}>
        <h2>Comissão potencial versus efetivada</h2>
        <p>As populações permanecem separadas</p>
        <div className={styles.financeHeader}><span>Origem</span><span>Potencial</span><span>Efetivada</span><span>Conversão</span></div>
        <LinhaFinanceira nome="Novos do mês" resumo={analise.novos.mes} />
        <LinhaFinanceira nome="Pendências anteriores" resumo={analise.novos.pendentes} />
        <LinhaFinanceira nome="Renovações da competência" resumo={analise.renovacoes.atual} />
      </section>
    </>
  );
}

function PainelEndossos({ analise }: { analise: AnaliseRamosElementares }) {
  const dados = analise.endossos;
  const fonteBitrix = analise.fonte.tipo === "bitrix24" || analise.fonte.id.startsWith("bitrix-spa-");
  return (
    <>
      <div className={styles.kpis}>
        <Kpi label="Solicitações" value={String(dados.total)} note="Linhas operacionais" />
        <Kpi label="Cancelados" value={String(dados.cancelados)} note="Fluxo concluído" tone="ok" />
        <Kpi label="Pendentes" value={String(dados.pendentes)} note="Exigem acompanhamento" tone={dados.pendentes ? "warning" : "ok"} />
        <Kpi label="Tempos válidos" value={String(dados.temposValidos)} note={`${dados.temposInvalidos} inválidos`} />
        <Kpi label="Tempo médio" value={duracao(dados.tempoMedioMinutos)} note="Somente durações válidas" />
        <Kpi label="Restituição informada" value={brl(dados.restituicaoInformada)} note="Sinal mantido da fonte" />
      </div>
      <div className={styles.duasColunas}>
        <section className={styles.panel}><h2>Status</h2><p>Não entra na conversão comercial</p><Barras dados={dados.porStatus} /></section>
        <section className={styles.panel}><h2>Ramos</h2><Barras dados={dados.porRamo} /></section>
      </div>
      <div className={styles.duasColunas}>
        <section className={styles.panel}><h2>Responsáveis</h2><Barras dados={dados.porResponsavel} /></section>
        <section className={styles.panel}><h2>Seguradoras</h2><Barras dados={dados.porSeguradora} /></section>
      </div>
      <div className={styles.avisoNeutro}>
        {fonteBitrix
          ? "O tipo de movimentação é registrado em campo estruturado no CRM, sem classificação por texto livre."
          : "A aba não possui um campo estruturado para o tipo de movimentação. O painel não tenta adivinhar essa classificação pelas observações."}
      </div>
    </>
  );
}

function ListaAlertas({ titulo, itens }: { titulo: string; itens: AnaliseRamosElementares["qualidade"] }) {
  return (
    <section className={styles.panel}>
      <h2>{titulo}</h2>
      <div className={styles.alertasLista}>
        {itens.map((item) => (
          <div className={styles.alertaLinha} key={item.codigo}>
            <div><strong>{item.titulo}</strong><span>{item.descricao}</span></div>
            <b className={item.quantidade === 0 ? styles.ok : item.gravidade === "alta" ? styles.danger : styles.warning}>{item.quantidade}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function PainelAlertas({ analise }: { analise: AnaliseRamosElementares }) {
  const totalQualidade = analise.qualidade.reduce((soma, item) => soma + item.quantidade, 0);
  const totalOperacional = analise.alertasOperacionais.reduce((soma, item) => soma + item.quantidade, 0);
  return (
    <>
      <div className={styles.kpis}>
        <Kpi label="Alertas operacionais" value={String(totalOperacional)} note="Itens que pedem ação" tone={totalOperacional ? "warning" : "ok"} />
        <Kpi label="Ocorrências de qualidade" value={String(totalQualidade)} note="Categorias podem se sobrepor" tone={totalQualidade ? "warning" : "ok"} />
        <Kpi label="Correções automáticas" value="0" note="A fonte nunca é alterada" tone="ok" />
      </div>
      <div className={styles.duasColunas}>
        <ListaAlertas titulo="Central de alertas operacionais" itens={analise.alertasOperacionais} />
        <ListaAlertas titulo="Qualidade dos dados" itens={analise.qualidade} />
      </div>
    </>
  );
}

const LIMITE_CARD_COLUNA = 12;

// Estágios amplos pra visão geral do Kanban não fragmentar em 8-10 colunas
// finas (a planilha usa muitos valores de status diferentes) -- o status
// detalhado da planilha continua exposto em cada card.
const ORDEM_GRUPOS: GrupoStatus[] = ["andamento", "fechado", "nao_fechou", "cancelado"];
const ROTULOS_GRUPO: Record<GrupoStatus, string> = {
  andamento: "Em andamento",
  fechado: "Fechado",
  nao_fechou: "Não fechou",
  cancelado: "Cancelado",
};

// Limiares de "dias sem contato" -- mesmo corte de 6 dias já usado em outros
// alertas operacionais deste painel (ex: "cotações paradas").
function chipContato(dias: number | null): { texto: string; tone: "ok" | "atencao" | "critico" | "neutro" } {
  if (dias === null) return { texto: "Sem registro de contato", tone: "neutro" };
  if (dias < 0) return { texto: "Contato futuro registrado", tone: "neutro" };
  if (dias <= 3) return { texto: `${dias}d sem contato`, tone: "ok" };
  if (dias <= 6) return { texto: `${dias}d sem contato`, tone: "atencao" };
  return { texto: `${dias}d sem contato`, tone: "critico" };
}

function ChipDiasContato({ dias }: { dias: number | null }) {
  const info = chipContato(dias);
  const classeTone =
    info.tone === "ok"
      ? kanbanStyles.chipOk
      : info.tone === "atencao"
        ? kanbanStyles.chipAtencao
        : info.tone === "critico"
          ? kanbanStyles.chipCritico
          : kanbanStyles.chipNeutro;
  return <span className={`${kanbanStyles.chip} ${classeTone}`}>{info.texto}</span>;
}

function ColunaKanban({
  grupo,
  itens,
  emailPorId,
}: {
  grupo: GrupoStatus;
  itens: RegistroNegociacao[];
  emailPorId: Map<string, EmailConfirmacao[]>;
}) {
  const [expandida, setExpandida] = useState(false);
  const visiveis = expandida ? itens : itens.slice(0, LIMITE_CARD_COLUNA);
  return (
    <div className={kanbanStyles.coluna}>
      <div className={kanbanStyles.colunaHead}>
        <span className={kanbanStyles.colunaTitulo}>{ROTULOS_GRUPO[grupo]}</span>
        <span className={kanbanStyles.colunaContagem}>{itens.length}</span>
      </div>
      <div className={kanbanStyles.colunaLista}>
        {visiveis.map((item) => {
          const emails = emailPorId.get(item.id) ?? [];
          // "Não encontrado" nunca chega aqui (não tem aba/linha pra virar
          // card), então toda divergência neste mapa é status desatualizado
          // de verdade -- mas filtramos por divergencia_tipo mesmo assim
          // por clareza/robustez.
          const divergenciasReais = emails.filter((email) => email.divergencia && email.divergencia_tipo === "status_desatualizado");
          const divergenciaUrgente = divergenciasReais.some((email) => email.tipo_confirmacao === "cancelamento_confirmado");
          const temDivergencia = divergenciasReais.length > 0;
          const temConfirmacao = emails.some(
            (email) => !email.divergencia && email.tipo_confirmacao !== "nao_identificado" && email.tipo_confirmacao !== "outro"
          );
          return (
            <div key={item.id} className={kanbanStyles.card}>
              <div className={kanbanStyles.cardTopo}>
                <span className={kanbanStyles.cardNome}>{item.nomePrincipal}</span>
                <span className={kanbanStyles.cardStatus}>{item.status}</span>
              </div>
              <span className={kanbanStyles.cardMeta}>
                {item.ramo}
                {item.seguradora && item.seguradora !== "NÃO INFORMADA" ? ` · ${item.seguradora}` : ""}
                {item.apolice ? ` · Apólice ${item.apolice}` : ""}
                {item.negociador ? ` · ${item.negociador}` : ""}
              </span>
              {grupo === "andamento" && (
                <div className={kanbanStyles.cardBadges}>
                  <ChipDiasContato dias={item.diasSemContato} />
                </div>
              )}
              {item.observacoes && <span className={kanbanStyles.cardObservacao}>{item.observacoes}</span>}
              {(temDivergencia || temConfirmacao) && (
                <div className={kanbanStyles.cardBadges}>
                  {divergenciaUrgente && (
                    <span className={`${kanbanStyles.badge} ${kanbanStyles.badgeUrgente}`}>
                      🔴 cancelado por e-mail, planilha não reflete
                    </span>
                  )}
                  {temDivergencia && !divergenciaUrgente && (
                    <span className={`${kanbanStyles.badge} ${kanbanStyles.badgeAlerta}`}>⚠ status desatualizado na planilha</span>
                  )}
                  {temConfirmacao && !temDivergencia && (
                    <span className={`${kanbanStyles.badge} ${kanbanStyles.badgeOk}`}>✓ confirmado por e-mail</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {itens.length === 0 && <div className={kanbanStyles.vazio}>Nenhum registro</div>}
      </div>
      {itens.length > LIMITE_CARD_COLUNA && (
        <button type="button" className={kanbanStyles.mostrarMais} onClick={() => setExpandida((valor) => !valor)}>
          {expandida ? "Mostrar menos" : `+${itens.length - LIMITE_CARD_COLUNA}`}
        </button>
      )}
    </div>
  );
}

const LIMITE_ATENCAO = 10;

function SecaoAtencao({ negociacoes }: { negociacoes: RegistroNegociacao[] }) {
  const [expandida, setExpandida] = useState(false);
  const parados = useMemo(
    () =>
      negociacoes
        .filter((item) => item.grupoStatus === "andamento" && item.diasSemContato !== null && item.diasSemContato >= 4)
        .sort((a, b) => (b.diasSemContato ?? 0) - (a.diasSemContato ?? 0)),
    [negociacoes]
  );
  if (parados.length === 0) return null;
  const visiveis = expandida ? parados : parados.slice(0, LIMITE_ATENCAO);
  return (
    <section className={styles.panel} style={{ marginBottom: 16 }}>
      <h2>⚠ Atenção — negócios em andamento sem contato recente</h2>
      <p>Ordenado do mais parado pro mais recente. Considera só negócios que ainda não fecharam nem cancelaram.</p>
      <div className={styles.listaCabecalho} aria-hidden="true">
        <span>Nome</span><span>Status</span><span>Negociador</span><span>Sem contato</span>
      </div>
      <div className={styles.listaDados}>
        {visiveis.map((item) => (
          <div className={styles.listaLinha} key={item.id}>
            <strong>{item.nomePrincipal}</strong>
            <span><small>Status</small>{item.status}</span>
            <span><small>Negociador</small>{item.negociador ?? "Não informado"}</span>
            <span><small>Sem contato</small><ChipDiasContato dias={item.diasSemContato} /></span>
          </div>
        ))}
      </div>
      {parados.length > LIMITE_ATENCAO && (
        <button type="button" className={styles.expandir} onClick={() => setExpandida((valor) => !valor)}>
          {expandida ? "Mostrar apenas os 10 mais parados" : `Mostrar todos (mais ${parados.length - LIMITE_ATENCAO})`}
        </button>
      )}
    </section>
  );
}

function PainelEmails({ analise, emailsConfirmacao }: { analise: AnaliseRamosElementares; emailsConfirmacao: EmailConfirmacao[] }) {
  const emailPorId = useMemo(() => {
    const mapa = new Map<string, EmailConfirmacao[]>();
    for (const email of emailsConfirmacao) {
      if (!email.aba || !email.linha) continue;
      const id = `${email.aba}|${email.linha}`;
      const lista = mapa.get(id) ?? [];
      lista.push(email);
      mapa.set(id, lista);
    }
    return mapa;
  }, [emailsConfirmacao]);

  const colunas = useMemo(() => {
    const grupos = new Map<GrupoStatus, RegistroNegociacao[]>();
    for (const item of analise.negociacoes) {
      const lista = grupos.get(item.grupoStatus) ?? [];
      lista.push(item);
      grupos.set(item.grupoStatus, lista);
    }
    return ORDEM_GRUPOS.map((grupo): [GrupoStatus, RegistroNegociacao[]] => [grupo, grupos.get(grupo) ?? []]);
  }, [analise.negociacoes]);

  const divergenciasReais = emailsConfirmacao.filter((email) => email.divergencia && email.divergencia_tipo === "status_desatualizado");
  const cancelamentosNaoRefletidos = divergenciasReais.filter((email) => email.tipo_confirmacao === "cancelamento_confirmado");
  const emailsLote = emailsConfirmacao.filter((email) => email.e_lote);
  const paradosCriticos = analise.negociacoes.filter(
    (item) => item.grupoStatus === "andamento" && item.diasSemContato !== null && item.diasSemContato >= 7
  ).length;

  return (
    <>
      <div className={styles.kpis}>
        <Kpi label="Negociações na planilha" value={String(analise.negociacoes.length)} note="Novos + renovações + endossos do mês" tone="ok" />
        <Kpi
          label="Sem contato há 7d+"
          value={String(paradosCriticos)}
          note="Em andamento, sem registro de contato recente"
          tone={paradosCriticos ? "danger" : "ok"}
        />
        <Kpi
          label="Status desatualizado na planilha"
          value={String(divergenciasReais.length)}
          note="E-mail confirma algo que a planilha ainda não reflete"
          tone={divergenciasReais.length ? "warning" : "ok"}
        />
        <Kpi
          label="Cancelamentos não refletidos"
          value={String(cancelamentosNaoRefletidos.length)}
          note="Cancelado por e-mail, planilha ainda mostra ativo"
          tone={cancelamentosNaoRefletidos.length ? "danger" : "ok"}
        />
      </div>
      <p className={styles.avisoNeutro} style={{ marginBottom: 12 }}>
        A planilha é a fonte oficial dos negócios, agrupados abaixo em 4 estágios (o status detalhado aparece em cada
        card). Cards com ⚠ ou 🔴 têm um e-mail cujo status não bate com o que está na planilha; o chip de dias mostra
        há quanto tempo não há registro de "ÚLTIMO CONTATO" na planilha (só disponível pra novos e renovações —
        endossos não têm essa coluna). E-mails "não encontrados" (geralmente lote) ficam à parte, abaixo do quadro.
      </p>
      <SecaoAtencao negociacoes={analise.negociacoes} />
      {colunas.every(([, itens]) => itens.length === 0) ? (
        <div className={styles.zeroState}>Nenhuma negociação encontrada nesta competência.</div>
      ) : (
        <div className={kanbanStyles.board}>
          {colunas.map(([grupo, itens]) => (
            <ColunaKanban key={grupo} grupo={grupo} itens={itens} emailPorId={emailPorId} />
          ))}
        </div>
      )}
      {emailsLote.length > 0 && (
        <section className={styles.panel} style={{ marginTop: 16 }}>
          <h2>E-mails de lote — conferir manualmente</h2>
          <p>
            Cobrem várias apólices/clientes de uma vez (renovação em bloco de uma imobiliária inteira). Não são casados
            automaticamente linha a linha — confira o e-mail original pra ver quais itens já fecharam.
          </p>
          <div className={styles.listaDados}>
            {emailsLote.map((email, indice) => (
              <div className={styles.listaLinha} key={`${email.recebido_em}-${indice}`}>
                <strong>{email.cliente_nome ?? "Sem descrição"}</strong>
                <span><small>Tipo</small>{email.tipo_confirmacao.replace(/_/g, " ")}</span>
                <span><small>Recebido</small>{new Date(email.recebido_em).toLocaleDateString("pt-BR")}</span>
                <span><small>Na planilha</small>{email.aba ? `${email.aba} L${email.linha}` : "Não localizado"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default function PainelRamosElementares({
  analise,
  competencia,
  origem,
  erroFonte,
  emailsConfirmacao,
}: {
  analise: AnaliseRamosElementares;
  competencia: string;
  origem: "planilha" | "bitrix" | "snapshot" | "indisponivel";
  erroFonte: string | null;
  emailsConfirmacao: EmailConfirmacao[];
}) {
  const router = useRouter();
  const [aba, setAba] = useState<AbaPainel>("visao");
  const [atualizando, iniciarAtualizacao] = useTransition();
  const fonteBitrix = analise.fonte.tipo === "bitrix24" || analise.fonte.id.startsWith("bitrix-spa-");

  useEffect(() => {
    const intervalo = window.setInterval(() => router.refresh(), 120_000);
    return () => window.clearInterval(intervalo);
  }, [router]);

  const tituloCompetencia = useMemo(() => {
    const [ano, mes] = competencia.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(ano, mes - 1, 1)));
  }, [competencia]);

  const conteudo = {
    visao: <PainelVisao analise={analise} />,
    novos: <PainelNovos analise={analise} />,
    renovacoes: <PainelRenovacoes analise={analise} />,
    financeiro: <PainelFinanceiro analise={analise} />,
    endossos: <PainelEndossos analise={analise} />,
    alertas: <PainelAlertas analise={analise} />,
    emails: <PainelEmails analise={analise} emailsConfirmacao={emailsConfirmacao} />,
  }[aba];

  function atualizarAgora() {
    iniciarAtualizacao(() => router.refresh());
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.topo}>
        <div>
          <div className={styles.eyebrow}>O2 Seguros · Uso interno · Fonte {fonteBitrix ? "CRM Bitrix24" : "Google Sheets"}</div>
          <h1>Ramos Elementares</h1>
          <p>Painel de produção — {tituloCompetencia}</p>
        </div>
        <div className={styles.controles}>
          <label>
            <span>Competência</span>
            <input type="month" value={competencia} onChange={(evento) => router.push(`/ramos-elementares?competencia=${evento.target.value}`)} />
          </label>
          <button type="button" onClick={atualizarAgora} disabled={atualizando}>{atualizando ? "Atualizando…" : "Atualizar agora"}</button>
          <small>Atualização automática a cada 2 minutos</small>
        </div>
      </div>

      <div className={`${styles.estadoFonte} ${origem === "snapshot" || origem === "indisponivel" ? styles.estadoFonteAlerta : ""}`}>
        <div>
          <strong>
            {origem === "bitrix"
              ? "Dados lidos diretamente do CRM Bitrix24"
              : origem === "planilha"
                ? "Dados lidos diretamente da planilha"
                : origem === "snapshot"
                  ? "Exibindo o último retrato salvo"
                  : "Fonte indisponível"}
          </strong>
          <span>Última leitura: {new Date(analise.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
        </div>
        {analise.fonte.url ? <a href={analise.fonte.url} target="_blank" rel="noreferrer">{fonteBitrix ? "Abrir CRM" : "Abrir planilha fonte"}</a> : null}
      </div>

      {erroFonte && <div className={styles.erroFonte}>{erroFonte}</div>}
      {analise.semAmostra && <div className={styles.avisoNeutro}>Não há amostra operacional nesta competência. Todos os quadros permanecem visíveis com valores zerados.</div>}
      {analise.avisosFonte.length > 0 && (
        <details className={styles.avisosFonte}>
          <summary>Avisos sobre a estrutura da fonte ({analise.avisosFonte.length})</summary>
          <ul>{analise.avisosFonte.map((aviso) => <li key={aviso}>{aviso}</li>)}</ul>
        </details>
      )}

      <nav className={styles.abas} aria-label="Seções de Ramos Elementares">
        {([
          ["visao", "Visão geral"],
          ["novos", "Novos negócios"],
          ["renovacoes", "Renovações"],
          ["financeiro", "Financeiro estimado"],
          ["endossos", "Endossos"],
          ["alertas", "Alertas e qualidade"],
          ["emails", "Verificação por E-mail"],
        ] as [AbaPainel, string][]).map(([valor, rotulo]) => (
          <button key={valor} type="button" aria-current={aba === valor ? "page" : undefined} onClick={() => setAba(valor)}>{rotulo}</button>
        ))}
      </nav>

      <div className={styles.conteudo}>{conteudo}</div>
      <footer className={styles.rodape}>
        <span>
          Fonte primária: {fonteBitrix ? "SPA Produção Incêndio no Bitrix24." : "abas operacionais da planilha mensal."}
        </span>
        <span>
          {fonteBitrix
            ? "A planilha auxiliar permanece como detalhamento operacional; o painel usa os totais do CRM."
            : "A CONTAGEM verif. é usada somente como referência de conferência."}
        </span>
      </footer>
    </main>
  );
}
