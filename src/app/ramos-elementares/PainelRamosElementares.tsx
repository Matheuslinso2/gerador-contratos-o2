"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AnaliseRamosElementares, ItemAgrupado, RegistroNegociacao, ResumoPopulacao } from "@/lib/ramos-elementares/analise";
import styles from "./ramos-elementares.module.css";

type AbaPainel = "visao" | "novos" | "renovacoes" | "financeiro" | "endossos" | "alertas" | "emails";
type EmailConfirmacao = {
  aba: string | null;
  linha: number | null;
  tipo_confirmacao:
    | "contratacao_confirmada"
    | "apolice_emitida"
    | "cancelamento_confirmado"
    | "autorizacao_cliente"
    | "outro"
    | "nao_identificado";
  recebido_em: string;
  divergencia: boolean;
  divergencia_tipo: "nao_encontrado" | "status_desatualizado" | null;
  divergencia_motivo: string | null;
  cliente_nome: string | null;
  e_lote: boolean;
  gmail_thread_id: string | null;
};
type RecorteNovos = "consolidado" | "mes" | "pendentes";
type RecorteRenovacao = "atual" | "futura";

function tipoFonteExibicao(fonte: AnaliseRamosElementares["fonte"]): "bitrix" | "hibrida" | "planilha" {
  if (fonte.tipo === "hibrido") return "hibrida";
  if (fonte.tipo === "bitrix24" || fonte.id.startsWith("bitrix-spa-")) return "bitrix";
  return "planilha";
}

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
  // Endossos vêm da planilha tanto no modo "planilha" quanto no "hibrida"
  // (só o modo 100% Bitrix, hoje sem uso, tem endossos estruturados no CRM).
  const endossosDoBitrix = tipoFonteExibicao(analise.fonte) === "bitrix";
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
        {endossosDoBitrix
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

const ROTULOS_TIPO_EMAIL: Record<string, string> = {
  contratacao_confirmada: "Contratação confirmada",
  apolice_emitida: "Apólice emitida",
  cancelamento_confirmado: "Cancelamento confirmado",
};

// A partir de quantos dias sem a O2 confirmar depois que o cliente já
// autorizou é que vira um aviso -- os exemplos reais mostram a O2
// respondendo no mesmo dia ou no dia seguinte, então 2 dias já é sinal de
// atraso, não só normal demora operacional.
const LIMIAR_DIAS_AUTORIZACAO_PENDENTE = 2;

// Só o que precisa de ação: um e-mail confirmou algo (apólice emitida,
// contratação efetivada, cancelamento) que o status atual do negócio na
// planilha ainda não reflete, OU o cliente já autorizou e a O2 ainda não
// fechou o loop. Exclui endossos por pedido explícito -- aqui é só pra
// negócios (novo/renovação).
function PainelEmails({ analise, emailsConfirmacao }: { analise: AnaliseRamosElementares; emailsConfirmacao: EmailConfirmacao[] }) {
  const negociacaoPorId = useMemo(() => {
    const mapa = new Map<string, RegistroNegociacao>();
    for (const item of analise.negociacoes) mapa.set(item.id, item);
    return mapa;
  }, [analise.negociacoes]);

  const emailsPorNegociacao = useMemo(() => {
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

  // Cancelamento cujo mesmo e-mail/thread também tem uma contratação ou
  // apólice emitida (achado real nos exemplos: pedem cancelar uma apólice
  // com endereço errado e reemitir a certa, no mesmo atendimento) -- isso é
  // uma correção administrativa, não um negócio perdido de verdade, então
  // não deve entrar como alerta "urgente".
  function ehReemissao(email: EmailConfirmacao): boolean {
    if (email.tipo_confirmacao !== "cancelamento_confirmado" || !email.gmail_thread_id) return false;
    return emailsConfirmacao.some(
      (outro) =>
        outro.gmail_thread_id === email.gmail_thread_id &&
        (outro.tipo_confirmacao === "contratacao_confirmada" || outro.tipo_confirmacao === "apolice_emitida")
    );
  }

  const pendencias = useMemo(() => {
    const porNegociacao = new Map<string, { negociacao: RegistroNegociacao; email: EmailConfirmacao }>();
    for (const email of emailsConfirmacao) {
      if (!email.divergencia || email.divergencia_tipo !== "status_desatualizado") continue;
      if (!email.aba || !email.linha) continue;
      const negociacao = negociacaoPorId.get(`${email.aba}|${email.linha}`);
      if (!negociacao || negociacao.tipo === "endosso") continue;
      const atual = porNegociacao.get(negociacao.id);
      if (!atual || new Date(email.recebido_em) > new Date(atual.email.recebido_em)) {
        porNegociacao.set(negociacao.id, { negociacao, email });
      }
    }
    return [...porNegociacao.values()]
      .map((item) => ({ ...item, reemissao: ehReemissao(item.email) }))
      .sort((a, b) => {
        const urgenteA = a.email.tipo_confirmacao === "cancelamento_confirmado" && !a.reemissao ? 0 : 1;
        const urgenteB = b.email.tipo_confirmacao === "cancelamento_confirmado" && !b.reemissao ? 0 : 1;
        if (urgenteA !== urgenteB) return urgenteA - urgenteB;
        return new Date(b.email.recebido_em).getTime() - new Date(a.email.recebido_em).getTime();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailsConfirmacao, negociacaoPorId]);

  const cancelamentosNaoRefletidos = pendencias.filter(
    (item) => item.email.tipo_confirmacao === "cancelamento_confirmado" && !item.reemissao
  );

  // Cliente já deu o aval ("pode seguir com a contratação") mas nenhum
  // e-mail de confirmação da O2 (contratação/apólice/cancelamento) chegou
  // depois disso pra mesma linha -- o loop ficou aberto.
  const autorizacoesPendentes = useMemo(() => {
    const resultado: { negociacao: RegistroNegociacao; autorizacao: EmailConfirmacao; dias: number }[] = [];
    for (const [id, emails] of emailsPorNegociacao) {
      const negociacao = negociacaoPorId.get(id);
      if (!negociacao || negociacao.tipo === "endosso") continue;
      const autorizacoes = emails
        .filter((email) => email.tipo_confirmacao === "autorizacao_cliente")
        .sort((a, b) => new Date(b.recebido_em).getTime() - new Date(a.recebido_em).getTime());
      if (autorizacoes.length === 0) continue;
      const ultimaAutorizacao = autorizacoes[0];
      const jaConfirmouDepois = emails.some(
        (email) =>
          (email.tipo_confirmacao === "contratacao_confirmada" ||
            email.tipo_confirmacao === "apolice_emitida" ||
            email.tipo_confirmacao === "cancelamento_confirmado") &&
          new Date(email.recebido_em) > new Date(ultimaAutorizacao.recebido_em)
      );
      if (jaConfirmouDepois) continue;
      const dias = Math.floor((Date.now() - new Date(ultimaAutorizacao.recebido_em).getTime()) / 86_400_000);
      if (dias < LIMIAR_DIAS_AUTORIZACAO_PENDENTE) continue;
      resultado.push({ negociacao, autorizacao: ultimaAutorizacao, dias });
    }
    return resultado.sort((a, b) => b.dias - a.dias);
  }, [emailsPorNegociacao, negociacaoPorId]);

  return (
    <>
      <div className={styles.kpis}>
        <Kpi
          label="Negócios com atualização pendente"
          value={String(pendencias.length)}
          note="E-mail confirma algo que a planilha ainda não reflete"
          tone={pendencias.length ? "warning" : "ok"}
        />
        <Kpi
          label="Cancelamentos não refletidos"
          value={String(cancelamentosNaoRefletidos.length)}
          note="Cancelado por e-mail, planilha ainda mostra ativo"
          tone={cancelamentosNaoRefletidos.length ? "danger" : "ok"}
        />
        <Kpi
          label="Cliente autorizou, sem confirmação"
          value={String(autorizacoesPendentes.length)}
          note={`Aval do cliente há ${LIMIAR_DIAS_AUTORIZACAO_PENDENTE}d+ sem a O2 fechar o loop`}
          tone={autorizacoesPendentes.length ? "danger" : "ok"}
        />
      </div>

      {autorizacoesPendentes.length > 0 && (
        <section className={styles.panel} style={{ marginBottom: 16 }}>
          <h2>⏳ Cliente autorizou — aguardando confirmação da O2</h2>
          <p>
            A imobiliária/cliente já deu o aval (ex: "pode seguir com a contratação") e nenhum e-mail de contratação,
            apólice emitida ou cancelamento chegou depois disso pra esse negócio.
          </p>
          <div className={styles.tabelaWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Imobiliária</th>
                  <th>Cliente na apólice</th>
                  <th>Status na planilha</th>
                  <th>Autorizado em</th>
                  <th>Dias sem confirmação</th>
                </tr>
              </thead>
              <tbody>
                {autorizacoesPendentes.map(({ negociacao, autorizacao, dias }) => (
                  <tr key={negociacao.id}>
                    <td>{negociacao.imobiliaria && negociacao.imobiliaria !== "NÃO INFORMADA" ? negociacao.imobiliaria : "—"}</td>
                    <td>{negociacao.segurado || "—"}</td>
                    <td>{negociacao.status}</td>
                    <td>{new Date(autorizacao.recebido_em).toLocaleDateString("pt-BR")}</td>
                    <td>
                      <span className={`${styles.badge} ${styles.badgeUrgente}`}>{dias}d</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className={styles.avisoNeutro} style={{ marginBottom: 12 }}>
        Abaixo, só negócio (novo ou renovação — endossos ficam de fora) onde um e-mail recebido em
        incendio@o2seguros.com.br confirmou apólice emitida, contratação efetivada ou cancelamento, e o status na
        planilha ainda não foi atualizado pra refletir isso. Cancelamento que é reemissão (mesmo atendimento cancelou
        uma apólice errada e emitiu a correta) aparece marcado como "reemissão", não como urgente.
      </p>
      {pendencias.length === 0 ? (
        <div className={styles.zeroState}>Nenhuma pendência encontrada — 0</div>
      ) : (
        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Imobiliária</th>
                <th>Cliente na apólice</th>
                <th>Seguradora</th>
                <th>Produto</th>
                <th>Status na planilha</th>
                <th>E-mail confirma</th>
                <th>Lote</th>
                <th>Recebido</th>
              </tr>
            </thead>
            <tbody>
              {pendencias.map(({ negociacao, email, reemissao }) => (
                <tr key={negociacao.id}>
                  <td>
                    {negociacao.imobiliaria && negociacao.imobiliaria !== "NÃO INFORMADA" ? negociacao.imobiliaria : "—"}
                    {(negociacao.negociador || (negociacao.diasSemContato !== null && negociacao.diasSemContato >= 0)) && (
                      <>
                        <br />
                        <small className={styles.tabelaSub}>
                          {negociacao.negociador ?? ""}
                          {negociacao.negociador && negociacao.diasSemContato !== null && negociacao.diasSemContato >= 0 ? " · " : ""}
                          {negociacao.diasSemContato !== null && negociacao.diasSemContato >= 0
                            ? `${negociacao.diasSemContato}d sem contato`
                            : ""}
                        </small>
                      </>
                    )}
                  </td>
                  <td>{negociacao.segurado || "—"}</td>
                  <td>{negociacao.seguradora}</td>
                  <td>{negociacao.ramo}</td>
                  <td>{negociacao.status}</td>
                  <td>
                    {ROTULOS_TIPO_EMAIL[email.tipo_confirmacao] ?? email.tipo_confirmacao}
                    {email.tipo_confirmacao === "cancelamento_confirmado" && (
                      <span
                        className={`${styles.badge} ${reemissao ? styles.badgeNeutro : styles.badgeUrgente}`}
                        style={{ marginLeft: 6 }}
                      >
                        {reemissao ? "reemissão" : "urgente"}
                      </span>
                    )}
                  </td>
                  <td>{email.e_lote ? email.cliente_nome || "Lote (sem descrição)" : "—"}</td>
                  <td>{new Date(email.recebido_em).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  origem: "planilha" | "hibrida" | "snapshot" | "indisponivel";
  erroFonte: string | null;
  emailsConfirmacao: EmailConfirmacao[];
}) {
  const router = useRouter();
  const [aba, setAba] = useState<AbaPainel>("visao");
  const [atualizando, iniciarAtualizacao] = useTransition();
  const tipoFonte = tipoFonteExibicao(analise.fonte);

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
          <div className={styles.eyebrow}>
            O2 Seguros · Uso interno · Fonte{" "}
            {tipoFonte === "hibrida" ? "Bitrix24 (novos) + Planilha (renovações/endossos)" : tipoFonte === "bitrix" ? "CRM Bitrix24" : "Google Sheets"}
          </div>
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
            {origem === "hibrida"
              ? "Dados lidos diretamente do Bitrix24 (novos) e da planilha (renovações/endossos)"
              : origem === "planilha"
                ? "Dados lidos diretamente da planilha"
                : origem === "snapshot"
                  ? "Exibindo o último retrato salvo"
                  : "Fonte indisponível"}
          </strong>
          <span>Última leitura: {new Date(analise.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
        </div>
        <div className={styles.linksFonte}>
          {analise.fonte.url ? (
            <a href={analise.fonte.url} target="_blank" rel="noreferrer">{tipoFonte === "planilha" ? "Abrir planilha fonte" : "Abrir CRM"}</a>
          ) : null}
          {tipoFonte === "hibrida" && analise.fonte.urlSecundaria ? (
            <a href={analise.fonte.urlSecundaria} target="_blank" rel="noreferrer">Abrir planilha fonte</a>
          ) : null}
        </div>
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
          Fonte primária:{" "}
          {tipoFonte === "hibrida"
            ? "Novos negócios e pendências no SPA Produção Incêndio (Bitrix24); renovações e endossos nas abas operacionais da planilha mensal."
            : tipoFonte === "bitrix"
              ? "SPA Produção Incêndio no Bitrix24."
              : "abas operacionais da planilha mensal."}
        </span>
        <span>
          {tipoFonte === "bitrix"
            ? "A planilha auxiliar permanece como detalhamento operacional; o painel usa os totais do CRM."
            : "A CONTAGEM verif. da planilha é usada somente como referência de conferência para renovações e endossos."}
        </span>
      </footer>
    </main>
  );
}
