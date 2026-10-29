import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { AnaliseGerencial, QuadroDiario } from "@/lib/bitrix/seguroFianca";
import type { PainelCapitalizacao } from "@/lib/capitalizacao/painel";
import type { PainelSeguroAuto } from "@/lib/seguroAuto/painel";
import { STATUS_TERMINAIS, type AnaliseRamosElementares, type ResumoPopulacao } from "@/lib/ramos-elementares/analise";
import type { ContagemDia } from "@/lib/contagemPorDia";
import { calcularPeriodoRelatorio, type PeriodoRelatorio } from "./periodo";

// Relatório diário do WhatsApp. É uma CÓPIA do que o Workspace já mostra:
// lê só os retratos que cada painel salva no Supabase toda vez que é aberto
// (e que os crons atualizar-paineis/congelar-paineis gravam) -- NUNCA
// consulta o Bitrix (pedido explícito do Matheus; testar ao vivo estourou o
// limite de taxa do Bitrix). Se ninguém abriu um painel depois do fim do
// período, os números daquele painel podem estar incompletos -- o rodapé
// avisa nesse caso.
//
// Conteúdo -- "visão de dono", definido com o Matheus em 06/10/2026: por
// produto, só documentos EFETIVADOS (ontem e no mês), TAXA DE CONVERSÃO e
// COMISSÃO EFETIVADA, mais a comissão total do mês. Conversão é sempre
// efetivados ÷ concluídos (efetivados + perdidos/recusados), só quem já
// teve desfecho -- mesma conta que Capitalização e Auto já mostravam.

type Secao<T> =
  | { ok: true; dados: T; atualizadoEm: string; parcial: boolean }
  | { ok: false; erro: string };

export type ResumoProduto = {
  ontemEfetivados: number | null; // null = retrato antigo, sem contagem por dia
  efetivados: number;
  conversao: number | null; // 0..1; null = nenhum card concluído no mês
  comissao: number;
  // Pedidos (cards criados) -- por enquanto só Capitalização: o Matheus
  // reclamou em 08/10/2026 que via 7 títulos no Workspace e o relatório
  // mostrava 0 (nenhum tinha chegado em "Emitido" ainda).
  // Fiança (09/10/2026): mesmo bloco, rotulado como "análises", e com o
  // total em andamento agora (novos + herdados de meses anteriores).
  solicitacoes?: { ontem: number | null; mes: number; rotulo?: [string, string]; rotuloMes?: [string, string]; emAndamento?: number };
  // Modelo 3: novos × renovações. renovacoes null = painel ainda não separa.
  novos?: BlocoMes;
  renovacoes?: BlocoMes | null;
};

// Bloco do mês (novos ou renovações) do "Relatório de Cotações" -- modelo 3.
export type BlocoMes = {
  cotacoes: number;
  efetivados: number;
  conversao: number | null;
  premio: number | null;
  comissao: number;
  itens?: { cotados: number; contratados: number | null }; // só Ramos (cards × itens)
};

// "Faturamento do mês" = aba Flash Report do Power BI (corp_painel_pronto,
// chave flash:AAAA-MM, gerada a cada importação do Corp).
export type FlashMes = {
  competencia: string;
  atualizadoEm: string | null;
  docs: number;
  comissao: number;
  ramos: { ramo: string; docs: number; pl: number; comissao: number }[];
};

export type RelatorioDiario = {
  flash?: Secao<FlashMes>;
  periodo: PeriodoRelatorio;
  fianca: Secao<ResumoProduto>;
  capitalizacao: Secao<ResumoProduto>;
  auto: Secao<ResumoProduto>;
  // Sem "ontem": renovações vêm da planilha, sem data confiável por dia.
  ramos: Secao<ResumoProduto & { novosEfetivados: number; renovacoesEfetivadas: number }>;
};

type Tabela = "seguro_fianca_snapshots" | "capitalizacao_snapshots" | "seguro_auto_snapshots" | "ramos_elementares_snapshots";

// Snapshot de cada competência envolvida no período -- na segunda, "sexta a
// domingo" pode atravessar a virada do mês.
async function lerRetratos<P>(tabela: Tabela, competencias: string[]) {
  const { data, error } = await createServiceClient()
    .from(tabela)
    .select("competencia, atualizado_em, payload")
    .in("competencia", competencias);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((l) => [l.competencia as string, { atualizadoEm: l.atualizado_em as string, payload: l.payload as P }]));
}

async function secao<P, T>(
  tabela: Tabela,
  periodo: PeriodoRelatorio,
  extrair: (doMes: P, porCompetencia: Map<string, P>) => T
): Promise<Secao<T>> {
  try {
    const competencias = [...new Set([...periodo.dias.map((d) => d.slice(0, 7)), periodo.competenciaMes])];
    const retratos = await lerRetratos<P>(tabela, competencias);
    const doMes = retratos.get(periodo.competenciaMes);
    if (!doMes) return { ok: false, erro: `nenhum retrato salvo de ${periodo.competenciaMes} -- o painel ainda não foi aberto neste mês` };
    const payloads = new Map([...retratos].map(([c, r]) => [c, r.payload]));
    // Retrato tirado antes do fim do período = pode faltar parte de "ontem".
    const parcial = [...retratos.values()].some((r) => new Date(r.atualizadoEm) < periodo.fim);
    return { ok: true, dados: extrair(doMes.payload, payloads), atualizadoEm: doMes.atualizadoEm, parcial };
  } catch (erro) {
    console.error(`Relatório diário: falha lendo ${tabela}:`, erro);
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

function somarQuadro(quadro: QuadroDiario | undefined, dias: string[]): number {
  return (quadro?.dias ?? []).filter((d) => dias.includes(d.data)).reduce((soma, d) => soma + d.total, 0);
}

// Concluídos (efetivados ou não) no mês -- null = retrato antigo, sem porDia.
function efetivadosNoPeriodo(payloads: { porDia?: ContagemDia[] }[], dias: string[]): number | null {
  if (payloads.some((p) => !p.porDia)) return null;
  return payloads
    .flatMap((p) => p.porDia!)
    .filter((l) => dias.includes(l.data))
    .reduce((s, l) => s + l.concluidos, 0);
}

// Cards criados no período -- null = retrato antigo, sem porDia.
function novosNoPeriodo(payloads: { porDia?: ContagemDia[] }[], dias: string[]): number | null {
  if (payloads.some((p) => !p.porDia)) return null;
  return payloads
    .flatMap((p) => p.porDia!)
    .filter((l) => dias.includes(l.data))
    .reduce((s, l) => s + l.novos, 0);
}

// "No mês" por data do EVENTO (09/10/2026, pedido do Matheus): conta tudo
// o que foi efetivado/perdido dentro da competência, qualquer que seja o mês
// do pedido -- coerente com o "Ontem". null = retrato anterior a essa
// mudança (sem comissão/perdas por dia): usa os kpis do painel.
function mesPorEvento(payload: { porDia?: ContagemDia[] }): Pick<ResumoProduto, "efetivados" | "conversao" | "comissao"> | null {
  const dias = payload.porDia;
  if (!dias || dias.some((d) => d.comissao === undefined || d.perdidos === undefined)) return null;
  const efetivados = dias.reduce((s, d) => s + d.concluidos, 0);
  const perdidos = dias.reduce((s, d) => s + (d.perdidos ?? 0), 0);
  return {
    efetivados,
    conversao: taxa(efetivados, efetivados + perdidos),
    comissao: dias.reduce((s, d) => s + (d.comissao ?? 0), 0),
  };
}

function taxa(efetivados: number, concluidos: number): number | null {
  return concluidos > 0 ? efetivados / concluidos : null;
}

// Ramos: um registro "concluído" é o que está num status terminal (ver
// STATUS_TERMINAIS em ramos-elementares/analise.ts).
function concluidosRamos(resumo: ResumoPopulacao): number {
  return resumo.porStatus
    .filter((s) => STATUS_TERMINAIS.has(s.nome.trim().toUpperCase()))
    .reduce((soma, s) => soma + s.total, 0);
}

export async function montarRelatorioDiario(agora = new Date()): Promise<RelatorioDiario> {
  return montarParaPeriodo(calcularPeriodoRelatorio(agora));
}

// Só o "No mês" de uma competência qualquer (sem "ontem") -- usado pela IA
// que responde perguntas pelo WhatsApp (lib/whatsappAssistente.ts) pra
// comparar meses. Mesmas contas do relatório.
export async function montarResumoCompetencia(competencia: string): Promise<RelatorioDiario> {
  const [ano, mes] = competencia.split("-").map(Number);
  const proximo = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 7);
  return montarParaPeriodo({
    dias: [],
    inicio: new Date(`${competencia}-01T00:00:00-03:00`),
    fim: new Date(`${proximo}-01T00:00:00-03:00`),
    competenciaMes: competencia,
    rotulo: competencia,
  });
}

async function montarParaPeriodo(periodo: PeriodoRelatorio): Promise<RelatorioDiario> {
  const [fianca, capitalizacao, auto, ramos] = await Promise.all([
    secao<AnaliseGerencial, ResumoProduto>("seguro_fianca_snapshots", periodo, (doMes, todos) => {
      const { convertidos, recusados, perdidos } = doMes.kpis;
      const conv = Object.values(doMes.convertidoPorSeguradora ?? {});
      const comissaoMes = conv.reduce((s, c) => s + c.comissao, 0);
      const conversaoMes = taxa(convertidos.total, convertidos.total + recusados.total + perdidos.total);
      return {
        novos: {
          cotacoes: doMes.kpis.total,
          efetivados: convertidos.total,
          conversao: conversaoMes,
          premio: conv.reduce((s, c) => s + c.premio, 0),
          comissao: comissaoMes,
        },
        renovacoes: null, // funil Renovação Fiança (cat. 32) ainda não entra no retrato
        ontemEfetivados: [...todos.values()].reduce((s, a) => s + somarQuadro(a.efetivacoesPorDia, periodo.dias), 0),
        efetivados: convertidos.total,
        conversao: conversaoMes,
        // Mesma soma do quadro "Convertido" do painel (mês do evento).
        comissao: comissaoMes,
        // Pedido do Matheus (09/10/2026): análises de ontem, recebidas no mês
        // e em andamento agora -- mesmos números dos quadros do painel.
        solicitacoes: {
          ontem: [...todos.values()].reduce((s, a) => s + somarQuadro(a.analisesDiariasPorResponsavel, periodo.dias), 0),
          mes: doMes.kpis.total,
          rotulo: ["análise", "análises"],
          rotuloMes: ["análise recebida", "análises recebidas"],
          emAndamento: doMes.kpis.emAndamento.total,
        },
      };
    }),
    // "No mês" = mesmos números do painel, que desde 15/10/2026 contam pelo
    // mês do pagamento (não pelo dia em que o Controle moveu pra Emitido).
    secao<PainelCapitalizacao, ResumoProduto>("capitalizacao_snapshots", periodo, (doMes, todos) => ({
      novos: {
        cotacoes: doMes.kpis.total,
        efetivados: doMes.kpis.emitidos,
        conversao: doMes.kpis.taxaConversao,
        premio: doMes.kpis.valorTotalEmitido,
        comissao: doMes.kpis.comissaoEfetivada,
      },
      renovacoes: null, // funil Renovação Capitalização ainda não entra no retrato
      ontemEfetivados: efetivadosNoPeriodo([...todos.values()], periodo.dias),
      efetivados: doMes.kpis.emitidos,
      conversao: doMes.kpis.taxaConversao,
      comissao: doMes.kpis.comissaoEfetivada,
      solicitacoes: { ontem: novosNoPeriodo([...todos.values()], periodo.dias), mes: doMes.kpis.total },
    })),
    secao<PainelSeguroAuto, ResumoProduto>("seguro_auto_snapshots", periodo, (doMes, todos) => {
      const mes = mesPorEvento(doMes) ?? {
        efetivados: doMes.kpis.convertidos,
        conversao: doMes.kpis.taxaConversao,
        comissao: doMes.kpis.comissaoGerada,
      };
      return {
        ontemEfetivados: efetivadosNoPeriodo([...todos.values()], periodo.dias),
        ...mes,
        novos: { cotacoes: doMes.kpis.total, ...mes, premio: doMes.kpis.premioEfetivado ?? null },
        renovacoes: null, // Auto: renovação ainda não separada no painel
      };
    }),
    secao<AnaliseRamosElementares, Extract<RelatorioDiario["ramos"], { ok: true }>["dados"]>(
      "ramos_elementares_snapshots",
      periodo,
      (doMes, todos) => {
        const { novosEfetivados, renovacoesEfetivadas, comissaoEfetivada } = doMes.visaoGeral;
        const efetivados = novosEfetivados + renovacoesEfetivadas;
        const bloco = (r: ResumoPopulacao): BlocoMes => ({
          cotacoes: r.total,
          efetivados: r.efetivados,
          conversao: taxa(r.efetivados, concluidosRamos(r)),
          premio: r.premioEfetivado ?? null,
          comissao: r.comissaoEfetivada ?? 0,
          itens: { cotados: r.itensCotados ?? 0, contratados: r.itensContratados ?? null },
        });
        return {
          novos: bloco(doMes.novos.consolidado),
          renovacoes: bloco(doMes.renovacoes.atual),
          ontemEfetivados: efetivadosNoPeriodo([...todos.values()], periodo.dias),
          solicitacoes: { ontem: novosNoPeriodo([...todos.values()], periodo.dias), mes: doMes.novos.consolidado.total + doMes.renovacoes.atual.total, rotulo: ["card", "cards"] },
          novosEfetivados,
          renovacoesEfetivadas,
          efetivados,
          conversao: taxa(efetivados, concluidosRamos(doMes.novos.consolidado) + concluidosRamos(doMes.renovacoes.atual)),
          comissao: comissaoEfetivada,
        };
      }
    ),
  ]);
  return { periodo, fianca, capitalizacao, auto, ramos, flash: await lerFlash(periodo.competenciaMes) };
}

async function lerFlash(competencia: string): Promise<Secao<FlashMes>> {
  try {
    const sb = createServiceClient();
    const [{ data: tela, error }, { data: imp }] = await Promise.all([
      sb.from("corp_painel_pronto").select("dados").eq("chave", `flash:${competencia}`).maybeSingle(),
      sb.from("corp_sp_arquivos").select("importado_em").order("importado_em", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    const f = tela?.dados as
      | { cartoes: { com_mes: number | null; docs_mes: number | null }; por_ramo: { ramo_flash: string; mes_com: number | null; docs: number | null; pl: number | null }[] }
      | undefined;
    if (!f) return { ok: false, erro: `Flash Report de ${competencia} ainda não gerado` };
    return {
      ok: true,
      atualizadoEm: (imp?.importado_em as string | undefined) ?? new Date().toISOString(),
      parcial: false,
      dados: {
        competencia,
        atualizadoEm: (imp?.importado_em as string | undefined) ?? null,
        docs: Number(f.cartoes.docs_mes ?? 0),
        comissao: Number(f.cartoes.com_mes ?? 0),
        ramos: f.por_ramo.map((l) => ({ ramo: l.ramo_flash, docs: Number(l.docs ?? 0), pl: Number(l.pl ?? 0), comissao: Number(l.mes_com ?? 0) })),
      },
    };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

// --- Texto: modelo cadastrado na Meta + os parâmetros que preenchem ele ---
//
// Mensagem que a plataforma INICIA no WhatsApp precisa ser um modelo
// aprovado pela Meta, com texto fixo e {{n}} no lugar do que muda. Regras
// da Meta: parâmetro não pode ter quebra de linha, e o corpo não pode
// começar nem terminar com parâmetro. Por isso cada LINHA que varia é um
// parâmetro inteiro, e a prévia (/admin/relatorio-diario) usa este mesmo
// modelo -- o que se vê lá é exatamente o que chega no celular.
//
// Se mudar este texto, precisa cadastrar um modelo NOVO na Meta (com o
// mesmo texto, nome novo) e esperar aprovação -- senão o envio falha.
// Histórico: relatorio_diario_o2 (01/10, volume) -> workspace_o2_modelo2
// (06/10, visão de dono -- nome escolhido na Meta pelo Matheus).

export const MODELO_WHATSAPP = {
  nome: "workspace_o2_modelo2",
  idioma: "pt_BR",
  corpo: [
    "📊 *Relatório O2 — {{1}}*",
    "",
    "🛡️ *SEGURO FIANÇA*",
    "{{2}}",
    "{{3}}",
    "",
    "💰 *CAPITALIZAÇÃO*",
    "{{4}}",
    "{{5}}",
    "",
    "🚗 *SEGURO AUTO*",
    "{{6}}",
    "{{7}}",
    "",
    "🏠 *RAMOS ELEMENTARES*",
    "{{8}}",
    "",
    "💵 *COMISSÃO TOTAL NO MÊS: {{9}}*",
    "",
    "{{10}}",
    "_Enviado automaticamente pelo Workspace O2._",
  ].join("\n"),
};

const fmtReais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function plural(n: number, singular: string, pluralTexto: string): string {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

function fmtConversao(c: number | null): string {
  return c === null ? "conversão —" : `conversão ${Math.round(c * 100)}%`;
}

const INDISPONIVEL = "⚠️ indisponível agora";

// Os 10 parâmetros do modelo, em ordem ({{1}} = índice 0).
export function parametrosModelo(r: RelatorioDiario): string[] {
  const rotuloOntem = r.periodo.dias.length === 1 ? "Ontem" : "Sex a dom";
  const avisos: string[] = [];
  let comissaoTotal = 0;
  const faltando: string[] = [];

  function linhas<T extends ResumoProduto>(
    nome: string,
    s: Secao<T>,
    doc: [string, string], // singular, plural -- ex: ["contrato efetivado", "contratos efetivados"]
    docMes: [string, string],
    mesEfetivados: (d: T) => string = (d) => plural(d.efetivados, docMes[0], docMes[1])
  ): [string, string] {
    if (!s.ok) {
      avisos.push(`${nome} indisponível`);
      faltando.push(nome);
      return [INDISPONIVEL, "—"];
    }
    if (s.parcial) avisos.push(`${nome} (foto de ${fmtHora.format(new Date(s.atualizadoEm))})`);
    const d = s.dados;
    comissaoTotal += d.comissao;
    const pedidos = d.solicitacoes;
    const [um, varios] = pedidos?.rotulo ?? ["solicitação", "solicitações"];
    const [umMes, variosMes] = pedidos?.rotuloMes ?? [um, varios];
    const pedidosOntem = pedidos ? `${pedidos.ontem === null ? "—" : plural(pedidos.ontem, um, varios)} · ` : "";
    const pedidosMes = pedidos
      ? `${plural(pedidos.mes, umMes, variosMes)} · ${pedidos.emAndamento !== undefined ? `${pedidos.emAndamento} em andamento · ` : ""}`
      : "";
    return [
      d.ontemEfetivados === null
        ? `${rotuloOntem}: ${pedidosOntem}—`
        : `${rotuloOntem}: ${pedidosOntem}${plural(d.ontemEfetivados, doc[0], doc[1])}`,
      `No mês: ${pedidosMes}${mesEfetivados(d)} · ${fmtConversao(d.conversao)} · ${fmtReais.format(d.comissao)} de comissão`,
    ];
  }

  const fianca = linhas("Fiança", r.fianca, ["contrato efetivado", "contratos efetivados"], ["efetivado", "efetivados"]);
  const capitalizacao = linhas("Capitalização", r.capitalizacao, ["título emitido", "títulos emitidos"], ["emitido", "emitidos"]);
  const auto = linhas("Auto", r.auto, ["apólice convertida", "apólices convertidas"], ["convertida", "convertidas"]);
  const [, ramos] = linhas(
    "Ramos",
    r.ramos,
    ["", ""],
    ["", ""],
    (d) => `${d.novosEfetivados} ${d.novosEfetivados === 1 ? "novo" : "novos"} + ${plural(d.renovacoesEfetivadas, "renovação", "renovações")} ${d.efetivados === 1 ? "efetivado" : "efetivados"}`
  );

  const total = fmtReais.format(comissaoTotal) + (faltando.length ? ` (sem ${faltando.join(", ")})` : "");
  const rodape = avisos.length
    ? `⚠️ Pode faltar algo: ${avisos.join(", ")}.`
    : "✅ Todos os painéis atualizados de madrugada.";

  return [r.periodo.rotulo, fianca[0], fianca[1], capitalizacao[0], capitalizacao[1], auto[0], auto[1], ramos, total, rodape];
}

export function textoRelatorio(r: RelatorioDiario): string {
  const params = parametrosModelo(r);
  return MODELO_WHATSAPP.corpo.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
}

// --- Modelo 3 (29/10/2026): "Relatório de Cotações" + "Faturamento do mês" ---
//
// Pedido do Matheus: cotações de ontem/mês, novos × renovações, prêmio e
// comissão efetivados, cards × itens em Ramos, e o faturamento do Power BI
// (aba Flash Report) por ramo macro, O2 Cap + O2 Seguros somados. Precisa ser
// cadastrado na Meta (nome novo) e aprovado antes de entrar no cron -- até lá
// o cron segue com MODELO_WHATSAPP. Ao aprovar: trocar o uso do cron para
// MODELO_WHATSAPP_V3 / parametrosModeloV3.

export const MODELO_WHATSAPP_V3 = {
  nome: "workspace_o2_modelo3",
  idioma: "pt_BR",
  corpo: [
    "📊 *Relatório O2 — {{1}}*",
    "",
    "📋 *RELATÓRIO DE COTAÇÕES*",
    "",
    "🛡️ *SEGURO FIANÇA*",
    "▪️ Dia anterior: {{2}}",
    "▪️ Novos no mês: {{3}}",
    "▪️ Renovações no mês: {{4}}",
    "",
    "💰 *CAPITALIZAÇÃO*",
    "▪️ Dia anterior: {{5}}",
    "▪️ Novos no mês: {{6}}",
    "▪️ Renovações no mês: {{7}}",
    "",
    "🚗 *SEGURO AUTO*",
    "▪️ Dia anterior: {{8}}",
    "▪️ Novos no mês: {{9}}",
    "▪️ Renovações no mês: {{10}}",
    "",
    "🏠 *RAMOS ELEMENTARES*",
    "▪️ Dia anterior: {{11}}",
    "▪️ Novos no mês: {{12}}",
    "▪️ Renovações no mês: {{13}}",
    "",
    "💵 *FATURAMENTO DO MÊS — {{14}}*",
    "🛡️ Fiança: {{15}}",
    "💰 Capitalização: {{16}}",
    "🔥 Incêndio: {{17}}",
    "🚗 Auto: {{18}}",
    "🏢 Condomínio: {{19}}",
    "🎁 Premiação: {{20}}",
    "*TOTAL: {{21}}*",
    "",
    "{{22}}",
    "_Enviado automaticamente pelo Workspace O2._",
  ].join("\n"),
};

const mesCurto = (c: string) => `${["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"][Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;

function linhaBloco(b: BlocoMes | null | undefined, ramos = false): string {
  if (b === undefined) return "—";
  if (b === null) return "ainda sem dados separados";
  const cards = ramos ? "cards" : "cotações";
  const itens = b.itens;
  const cot = ramos && itens ? `${b.cotacoes} cards (${itens.cotados} itens) cotados` : `${plural(b.cotacoes, "cotação", "cotações")}`;
  const efet =
    ramos && itens
      ? `${b.efetivados} efetivados${itens.contratados !== null ? ` (${itens.contratados} itens contratados)` : ""}`
      : `${b.efetivados} efetivados`;
  void cards;
  return `${cot} · ${efet} · ${fmtConversao(b.conversao)} · prêmio ${b.premio === null ? "—" : fmtReais.format(b.premio)} · comissão ${fmtReais.format(b.comissao)}`;
}

export function parametrosModeloV3(r: RelatorioDiario): string[] {
  const avisos: string[] = [];

  function produto(nome: string, s: Secao<ResumoProduto>, ramos = false): [string, string, string] {
    if (!s.ok) {
      avisos.push(`${nome} indisponível`);
      return [INDISPONIVEL, "—", "—"];
    }
    if (s.parcial) avisos.push(`${nome} (foto de ${fmtHora.format(new Date(s.atualizadoEm))})`);
    const d = s.dados;
    const p = d.solicitacoes;
    const ontem =
      d.ontemEfetivados === null && !p
        ? "—"
        : `${p ? `${p.ontem === null ? "—" : ramos ? plural(p.ontem, "card", "cards") : plural(p.ontem, "cotação", "cotações")} · ` : ""}${d.ontemEfetivados === null ? "—" : `${d.ontemEfetivados} efetivados`}`;
    return [ontem, linhaBloco(d.novos, ramos), linhaBloco(d.renovacoes, ramos)];
  }

  const fi = produto("Fiança", r.fianca);
  const ca = produto("Capitalização", r.capitalizacao);
  const au = produto("Auto", r.auto);
  const ra = produto("Ramos", r.ramos, true);

  const nomes = ["FIANÇA", "CAPITALIZAÇÃO", "INCÊNDIO", "AUTO", "CONDOMÍNIO", "PREMIAÇÃO"];
  let faturamentoTitulo = "indisponível";
  let total = INDISPONIVEL;
  const porRamo: string[] = nomes.map(() => "—");
  if (r.flash?.ok) {
    const f = r.flash.dados;
    faturamentoTitulo = `${mesCurto(f.competencia)} · Corp de ${f.atualizadoEm ? fmtHora.format(new Date(f.atualizadoEm)).replace(", ", " ") : "—"}`;
    nomes.forEach((n, i) => {
      const l = f.ramos.find((x) => x.ramo === n);
      if (l) porRamo[i] = `${l.docs} docs · PL ${fmtReais.format(l.pl)} · comissão ${fmtReais.format(l.comissao)}`;
    });
    const pl = f.ramos.reduce((s, l) => s + l.pl, 0);
    total = `${f.docs} docs · PL ${fmtReais.format(pl)} · comissão ${fmtReais.format(f.comissao)}`;
  } else avisos.push("Faturamento (Flash Report) indisponível");

  const rodape = avisos.length ? `⚠️ Pode faltar algo: ${avisos.join(", ")}.` : "✅ Todos os painéis atualizados de madrugada.";
  return [r.periodo.rotulo, ...fi, ...ca, ...au, ...ra, faturamentoTitulo, ...porRamo, total, rodape];
}

export function textoRelatorioV3(r: RelatorioDiario): string {
  const params = parametrosModeloV3(r);
  return MODELO_WHATSAPP_V3.corpo.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
}
