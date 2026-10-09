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
};

export type RelatorioDiario = {
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
      return {
        ontemEfetivados: [...todos.values()].reduce((s, a) => s + somarQuadro(a.efetivacoesPorDia, periodo.dias), 0),
        efetivados: convertidos.total,
        conversao: taxa(convertidos.total, convertidos.total + recusados.total + perdidos.total),
        // Mesma soma do quadro "Convertido" do painel (mês do evento).
        comissao: Object.values(doMes.convertidoPorSeguradora ?? {}).reduce((s, c) => s + c.comissao, 0),
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
    secao<PainelCapitalizacao, ResumoProduto>("capitalizacao_snapshots", periodo, (doMes, todos) => ({
      ontemEfetivados: efetivadosNoPeriodo([...todos.values()], periodo.dias),
      ...(mesPorEvento(doMes) ?? {
        efetivados: doMes.kpis.emitidos,
        conversao: doMes.kpis.taxaConversao,
        comissao: doMes.kpis.comissaoEfetivada,
      }),
      solicitacoes: { ontem: novosNoPeriodo([...todos.values()], periodo.dias), mes: doMes.kpis.total },
    })),
    secao<PainelSeguroAuto, ResumoProduto>("seguro_auto_snapshots", periodo, (doMes, todos) => ({
      ontemEfetivados: efetivadosNoPeriodo([...todos.values()], periodo.dias),
      ...(mesPorEvento(doMes) ?? {
        efetivados: doMes.kpis.convertidos,
        conversao: doMes.kpis.taxaConversao,
        comissao: doMes.kpis.comissaoGerada,
      }),
    })),
    secao<AnaliseRamosElementares, Extract<RelatorioDiario["ramos"], { ok: true }>["dados"]>(
      "ramos_elementares_snapshots",
      periodo,
      (doMes) => {
        const { novosEfetivados, renovacoesEfetivadas, comissaoEfetivada } = doMes.visaoGeral;
        const efetivados = novosEfetivados + renovacoesEfetivadas;
        return {
          ontemEfetivados: null,
          novosEfetivados,
          renovacoesEfetivadas,
          efetivados,
          conversao: taxa(efetivados, concluidosRamos(doMes.novos.consolidado) + concluidosRamos(doMes.renovacoes.atual)),
          comissao: comissaoEfetivada,
        };
      }
    ),
  ]);
  return { periodo, fianca, capitalizacao, auto, ramos };
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
