import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { AnaliseGerencial } from "@/lib/bitrix/seguroFianca";
import type { PainelCapitalizacao } from "@/lib/capitalizacao/painel";
import type { PainelSeguroAuto } from "@/lib/seguroAuto/painel";
import { montarRanking, type LinhaRanking } from "@/lib/rankingImobiliarias";
import { STATUS_TERMINAIS, type AnaliseRamosElementares } from "@/lib/ramos-elementares/analise";

// Dashboard "Produção do mês" da página inicial (pedido do Matheus,
// 09/10/2026, só pra quem tem login @o2seguros.com.br). Nível COTAÇÃO, e
// SÓ lê os retratos mensais que cada painel já salva no Supabase (mesma
// fonte do relatório diário do WhatsApp) -- nunca consulta o Bitrix e não
// calcula nada que o painel correspondente não mostre. As contas daqui são
// só somas e divisões dos números dos painéis:
//   conversão = efetivadas ÷ concluídas (efetivadas + recusadas/perdidas),
//   a mesma de cada painel (ver relatorioDiario/montar.ts).
//
// Ramos Elementares entra só com os "novos" (renovações ficam de fora: são
// outro nível, centenas de itens vindos da planilha, e distorceriam a
// comparação com cotações dos outros produtos).

export type ProdutoDashboard = "fianca" | "capitalizacao" | "auto" | "ramos";

export type NumerosMes = {
  cotacoes: number;
  efetivadas: number;
  concluidas: number; // efetivadas + recusadas/perdidas (base da conversão)
  comissao: number;
  emAndamento: number;
  atualizadoEm: string;
};

export type LinhaProduto = {
  produto: ProdutoDashboard;
  nome: string;
  atual: NumerosMes | null; // null = painel sem retrato salvo nesse mês
  anterior: NumerosMes | null;
};

export type DashboardProducao = {
  competenciaAtual: string; // "YYYY-MM"
  competenciaAnterior: string;
  diaAtual: number; // dia do mês em Brasília
  diasMesAtual: number;
  diasMesAnterior: number;
  produtos: LinhaProduto[];
};

type Tabela = "seguro_fianca_snapshots" | "capitalizacao_snapshots" | "seguro_auto_snapshots" | "ramos_elementares_snapshots";

const FUSO = "America/Sao_Paulo";

function hojeEmBrasilia(agora: Date): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(agora)
    .split("-")
    .map(Number);
  return { ano, mes, dia };
}

function competenciaDe(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

async function lerRetratos<P>(tabela: Tabela, competencias: string[]): Promise<Map<string, { atualizadoEm: string; payload: P }>> {
  const { data, error } = await createServiceClient().from(tabela).select("competencia, atualizado_em, payload").in("competencia", competencias);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((l) => [l.competencia as string, { atualizadoEm: l.atualizado_em as string, payload: l.payload as P }]));
}

function numerosFianca(p: AnaliseGerencial, atualizadoEm: string): NumerosMes {
  const { convertidos, recusados, perdidos, emAndamento, total } = p.kpis;
  return {
    cotacoes: total,
    efetivadas: convertidos.total,
    concluidas: convertidos.total + recusados.total + perdidos.total,
    comissao: Object.values(p.convertidoPorSeguradora ?? {}).reduce((s, c) => s + c.comissao, 0),
    emAndamento: emAndamento.total,
    atualizadoEm,
  };
}

function numerosCapitalizacao(p: PainelCapitalizacao, atualizadoEm: string): NumerosMes {
  const { total, emitidos, perdidos, comissaoEfetivada, emAndamento } = p.kpis;
  return { cotacoes: total, efetivadas: emitidos, concluidas: emitidos + perdidos, comissao: comissaoEfetivada, emAndamento: emAndamento.total, atualizadoEm };
}

function numerosAuto(p: PainelSeguroAuto, atualizadoEm: string): NumerosMes {
  const { total, convertidos, perdidos, comissaoGerada, emAndamento } = p.kpis;
  return { cotacoes: total, efetivadas: convertidos, concluidas: convertidos + perdidos, comissao: comissaoGerada, emAndamento: emAndamento.total, atualizadoEm };
}

function numerosRamos(p: AnaliseRamosElementares, atualizadoEm: string): NumerosMes {
  const consolidado = p.novos.consolidado;
  const concluidas = consolidado.porStatus.filter((s) => STATUS_TERMINAIS.has(s.nome.trim().toUpperCase())).reduce((s, x) => s + x.total, 0);
  return {
    cotacoes: p.visaoGeral.novasEntradas,
    efetivadas: p.visaoGeral.novosEfetivados,
    concluidas,
    comissao: consolidado.comissaoEfetivada,
    emAndamento: consolidado.total - concluidas,
    atualizadoEm,
  };
}

async function linha<P>(
  produto: ProdutoDashboard,
  nome: string,
  tabela: Tabela,
  competencias: [string, string],
  extrair: (payload: P, atualizadoEm: string) => NumerosMes
): Promise<LinhaProduto> {
  try {
    const retratos = await lerRetratos<P>(tabela, competencias);
    const ler = (c: string) => {
      const r = retratos.get(c);
      return r ? extrair(r.payload, r.atualizadoEm) : null;
    };
    return { produto, nome, atual: ler(competencias[0]), anterior: ler(competencias[1]) };
  } catch (erro) {
    console.error(`Dashboard de produção: falha lendo ${tabela}:`, erro);
    return { produto, nome, atual: null, anterior: null };
  }
}

export async function montarDashboardProducao(agora = new Date()): Promise<DashboardProducao> {
  const { ano, mes, dia } = hojeEmBrasilia(agora);
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const competencias: [string, string] = [competenciaDe(ano, mes), competenciaDe(anoAnt, mesAnt)];

  const produtos = await Promise.all([
    linha<AnaliseGerencial>("fianca", "Seguro Fiança", "seguro_fianca_snapshots", competencias, numerosFianca),
    linha<PainelCapitalizacao>("capitalizacao", "Capitalização", "capitalizacao_snapshots", competencias, numerosCapitalizacao),
    linha<PainelSeguroAuto>("auto", "Seguro Auto", "seguro_auto_snapshots", competencias, numerosAuto),
    linha<AnaliseRamosElementares>("ramos", "Ramos Elementares", "ramos_elementares_snapshots", competencias, numerosRamos),
  ]);

  return {
    competenciaAtual: competencias[0],
    competenciaAnterior: competencias[1],
    diaAtual: dia,
    diasMesAtual: diasNoMes(ano, mes),
    diasMesAnterior: diasNoMes(anoAnt, mesAnt),
    produtos,
  };
}

// Soma dos produtos que têm retrato no mês -- se algum não tem, o total fica
// incompleto e o componente avisa em vez de mostrar como se fosse completo.
export function somarMes(produtos: LinhaProduto[], mes: "atual" | "anterior"): (NumerosMes & { incompleto: boolean }) | null {
  const itens = produtos.map((p) => p[mes]);
  const presentes = itens.filter((i): i is NumerosMes => i !== null);
  if (presentes.length === 0) return null;
  return {
    cotacoes: presentes.reduce((s, i) => s + i.cotacoes, 0),
    efetivadas: presentes.reduce((s, i) => s + i.efetivadas, 0),
    concluidas: presentes.reduce((s, i) => s + i.concluidas, 0),
    comissao: presentes.reduce((s, i) => s + i.comissao, 0),
    emAndamento: presentes.reduce((s, i) => s + i.emAndamento, 0),
    atualizadoEm: presentes.map((i) => i.atualizadoEm).sort().at(-1) ?? "",
    incompleto: presentes.length < itens.length,
  };
}

// --- Ranking de imobiliárias (quadro da página inicial) ---
// Lê os mesmos retratos mensais; a junção dos nomes entre painéis e a ordem
// do ranking estão em rankingImobiliarias.ts. Seguro Auto fica de fora (o
// painel dele não registra imobiliária).
export type RankingImobiliarias = {
  competencia: string;
  linhas: LinhaRanking[];
  painelsSemRetrato: string[]; // nomes dos painéis sem retrato da competência (ranking incompleto)
  atualizadoEm: string | null;
};

export async function montarRankingImobiliarias(competencia: string, limite = 10): Promise<RankingImobiliarias> {
  const [fianca, cap, ramos] = await Promise.all([
    lerRetratos<AnaliseGerencial>("seguro_fianca_snapshots", [competencia]).catch(() => null),
    lerRetratos<PainelCapitalizacao>("capitalizacao_snapshots", [competencia]).catch(() => null),
    lerRetratos<AnaliseRamosElementares>("ramos_elementares_snapshots", [competencia]).catch(() => null),
  ]);
  const f = fianca?.get(competencia);
  const c = cap?.get(competencia);
  const r = ramos?.get(competencia);

  const semRetrato = [!f && "Seguro Fiança", !c && "Capitalização", !r && "Ramos Elementares"].filter((x): x is string => !!x);
  const linhas = montarRanking(
    {
      fianca: f?.payload.topImobiliarias ?? [],
      capitalizacao: c?.payload.titulos ?? [],
      ramos: r?.payload.novos.consolidado.porImobiliaria ?? [],
    },
    limite
  );
  const datas = [f, c, r].filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.atualizadoEm).sort();
  return { competencia, linhas, painelsSemRetrato: semRetrato, atualizadoEm: datas.at(-1) ?? null };
}

export function competenciasAtualEAnterior(agora = new Date()): { atual: string; anterior: string } {
  const { ano, mes } = hojeEmBrasilia(agora);
  return { atual: competenciaDe(ano, mes), anterior: mes === 1 ? competenciaDe(ano - 1, 12) : competenciaDe(ano, mes - 1) };
}
