import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { AnaliseGerencial, QuadroDiario } from "@/lib/bitrix/seguroFianca";
import type { PainelCapitalizacao } from "@/lib/capitalizacao/painel";
import type { PainelSeguroAuto } from "@/lib/seguroAuto/painel";
import type { AnaliseRamosElementares } from "@/lib/ramos-elementares/analise";
import type { ContagemDia } from "@/lib/contagemPorDia";
import { calcularPeriodoRelatorio, type PeriodoRelatorio } from "./periodo";

// Relatório diário do WhatsApp -- formato aprovado pelo Matheus em
// 01/10/2026. É uma CÓPIA do que o Workspace já mostra: lê só os retratos
// que cada painel salva no Supabase toda vez que é aberto (e que o cron
// congelar-paineis grava na virada do mês) -- NUNCA consulta o Bitrix
// (pedido explícito do Matheus; testar ao vivo estourou o limite de taxa do
// Bitrix). Consequência: se ninguém abriu um painel depois do fim do
// período, os números daquele painel podem estar incompletos -- a seção
// avisa a hora do retrato nesse caso.

type Secao<T> =
  | { ok: true; dados: T; atualizadoEm: string; parcial: boolean }
  | { ok: false; erro: string };

export type RelatorioDiario = {
  periodo: PeriodoRelatorio;
  fianca: Secao<{
    ontem: { analises: number; contratosRecebidos: number; efetivados: number } | null;
    mes: { analises: number; convertidos: number; emAndamento: number };
  }>;
  capitalizacao: Secao<{
    ontem: { novos: number; emitidos: number } | null;
    mes: { titulos: number; emitidos: number; comissao: number };
  }>;
  auto: Secao<{
    ontem: { novas: number; convertidas: number } | null;
    mes: { fichas: number; convertidas: number; comissao: number };
  }>;
  ramos: Secao<{
    mes: { novos: number; efetivados: number; renovacoesEfetivadas: number; comissao: number };
  }>;
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

// null = algum retrato do período é anterior a 01/10/2026 e não tem porDia.
function somarPorDia(payloads: { porDia?: ContagemDia[] }[], dias: string[]): { novos: number; concluidos: number } | null {
  if (payloads.some((p) => !p.porDia)) return null;
  const linhas = payloads.flatMap((p) => p.porDia!).filter((l) => dias.includes(l.data));
  return { novos: linhas.reduce((s, l) => s + l.novos, 0), concluidos: linhas.reduce((s, l) => s + l.concluidos, 0) };
}

export async function montarRelatorioDiario(agora = new Date()): Promise<RelatorioDiario> {
  const periodo = calcularPeriodoRelatorio(agora);
  const [fianca, capitalizacao, auto, ramos] = await Promise.all([
    secao<AnaliseGerencial, Extract<RelatorioDiario["fianca"], { ok: true }>["dados"]>(
      "seguro_fianca_snapshots",
      periodo,
      (doMes, todos) => {
        const lista = [...todos.values()];
        return {
          ontem: {
            analises: lista.reduce((s, a) => s + somarQuadro(a.analisesDiariasPorResponsavel, periodo.dias), 0),
            contratosRecebidos: lista.reduce(
              (s, a) =>
                s +
                somarQuadro(a.contratosRecebidosPorDia?.mesAtual, periodo.dias) +
                somarQuadro(a.contratosRecebidosPorDia?.herdado, periodo.dias),
              0
            ),
            efetivados: lista.reduce((s, a) => s + somarQuadro(a.efetivacoesPorDia, periodo.dias), 0),
          },
          mes: {
            analises: doMes.kpis.total,
            convertidos: doMes.kpis.convertidos.total,
            emAndamento: doMes.kpis.emAndamento.total,
          },
        };
      }
    ),
    secao<PainelCapitalizacao, Extract<RelatorioDiario["capitalizacao"], { ok: true }>["dados"]>(
      "capitalizacao_snapshots",
      periodo,
      (doMes, todos) => {
        const dia = somarPorDia([...todos.values()], periodo.dias);
        return {
          ontem: dia && { novos: dia.novos, emitidos: dia.concluidos },
          mes: { titulos: doMes.kpis.total, emitidos: doMes.kpis.emitidos, comissao: doMes.kpis.comissaoEfetivada },
        };
      }
    ),
    secao<PainelSeguroAuto, Extract<RelatorioDiario["auto"], { ok: true }>["dados"]>(
      "seguro_auto_snapshots",
      periodo,
      (doMes, todos) => {
        const dia = somarPorDia([...todos.values()], periodo.dias);
        return {
          ontem: dia && { novas: dia.novos, convertidas: dia.concluidos },
          mes: { fichas: doMes.kpis.total, convertidas: doMes.kpis.convertidos, comissao: doMes.kpis.comissaoGerada },
        };
      }
    ),
    secao<AnaliseRamosElementares, Extract<RelatorioDiario["ramos"], { ok: true }>["dados"]>(
      "ramos_elementares_snapshots",
      periodo,
      (doMes) => ({
        mes: {
          novos: doMes.visaoGeral.novasEntradas,
          efetivados: doMes.visaoGeral.novosEfetivados,
          renovacoesEfetivadas: doMes.visaoGeral.renovacoesEfetivadas,
          comissao: doMes.visaoGeral.comissaoEfetivada,
        },
      })
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
// parâmetro inteiro (plural, "indisponível" etc. continuam funcionando), e
// a prévia (/admin/relatorio-diario) usa este mesmo modelo -- o que se vê
// lá é exatamente o que chega no celular.
//
// Se mudar este texto, precisa cadastrar o modelo de novo na Meta (com o
// MESMO texto) e esperar aprovação -- senão o envio falha.

export const MODELO_WHATSAPP = {
  nome: "relatorio_diario_o2",
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
    "{{9}}",
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

const INDISPONIVEL = "⚠️ indisponível agora";

// Os 9 parâmetros do modelo, em ordem ({{1}} = índice 0).
export function parametrosModelo(r: RelatorioDiario): string[] {
  const rotuloOntem = r.periodo.dias.length === 1 ? "Ontem" : "Sex a dom";
  const avisos: string[] = [];

  function linhas<T>(nome: string, s: Secao<T>, corpo: (dados: T) => string[]): string[] {
    if (!s.ok) {
      avisos.push(`${nome} indisponível`);
      return [INDISPONIVEL, "—"];
    }
    if (s.parcial) avisos.push(`${nome} (foto de ${fmtHora.format(new Date(s.atualizadoEm))})`);
    return corpo(s.dados);
  }

  const fianca = linhas("Fiança", r.fianca, ({ ontem: o, mes: m }) => [
    o
      ? `${rotuloOntem}: ${plural(o.analises, "análise", "análises")} · ${plural(o.contratosRecebidos, "contrato recebido", "contratos recebidos")} · ${plural(o.efetivados, "efetivado", "efetivados")}`
      : `${rotuloOntem}: —`,
    `No mês: ${plural(m.analises, "análise", "análises")} · ${plural(m.convertidos, "convertido", "convertidos")} · ${m.emAndamento} em andamento`,
  ]);
  const capitalizacao = linhas("Capitalização", r.capitalizacao, ({ ontem: o, mes: m }) => [
    o ? `${rotuloOntem}: ${plural(o.novos, "novo título", "novos títulos")} · ${plural(o.emitidos, "emitido", "emitidos")}` : `${rotuloOntem}: —`,
    `No mês: ${plural(m.titulos, "título", "títulos")} · ${plural(m.emitidos, "emitido", "emitidos")} · ${fmtReais.format(m.comissao)} de comissão`,
  ]);
  const auto = linhas("Auto", r.auto, ({ ontem: o, mes: m }) => [
    o ? `${rotuloOntem}: ${plural(o.novas, "nova ficha", "novas fichas")} · ${plural(o.convertidas, "convertida", "convertidas")}` : `${rotuloOntem}: —`,
    `No mês: ${plural(m.fichas, "ficha", "fichas")} · ${plural(m.convertidas, "convertida", "convertidas")} · ${fmtReais.format(m.comissao)} de comissão`,
  ]);
  const ramos = r.ramos.ok
    ? (() => {
        const { mes: m } = r.ramos.dados;
        if (r.ramos.parcial) avisos.push(`Ramos (foto de ${fmtHora.format(new Date(r.ramos.atualizadoEm))})`);
        return `No mês: ${plural(m.novos, "novo", "novos")} · ${plural(m.efetivados, "efetivado", "efetivados")} · ${plural(m.renovacoesEfetivadas, "renovação efetivada", "renovações efetivadas")} · ${fmtReais.format(m.comissao)} de comissão`;
      })()
    : (avisos.push("Ramos indisponível"), INDISPONIVEL);

  const rodape = avisos.length
    ? `⚠️ Pode faltar algo: ${avisos.join(", ")}.`
    : "✅ Todos os painéis atualizados de madrugada.";

  return [r.periodo.rotulo, fianca[0], fianca[1], capitalizacao[0], capitalizacao[1], auto[0], auto[1], ramos, rodape];
}

export function textoRelatorio(r: RelatorioDiario): string {
  const params = parametrosModelo(r);
  return MODELO_WHATSAPP.corpo.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
}
