import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarAnaliseGerencialAoVivo } from "@/lib/bitrix/seguroFianca";
import { montarPainelCapitalizacao } from "@/lib/capitalizacao/painel";
import { montarPainelSeguroAuto } from "@/lib/seguroAuto/painel";
import { lerFonteRamosElementares } from "@/lib/ramos-elementares/fonteGoogle";
import { lerFonteRamosElementaresHibrida } from "@/lib/ramos-elementares/fonteHibrida";
import { montarAnaliseRamosElementares } from "@/lib/ramos-elementares/analise";
import { calcularPeriodoRelatorio } from "@/lib/relatorioDiario/periodo";
import { alertarAdmin } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Atualização de madrugada (seg-sex, ~6h de Brasília, ver vercel.json) dos
// retratos que o relatório diário do WhatsApp copia -- decisão do Matheus
// em 01/10/2026: o relatório só COPIA o Workspace, e o Workspace se
// atualiza sozinho antes, como se alguém tivesse aberto cada painel. Sem
// isso, o relatório das 8h ficava com a última vez que alguém abriu a tela.
//
// UM painel por chamada (?painel=...), com 5 min entre eles: disparar
// vários juntos estoura o limite de taxa do Bitrix (HTTP 503
// QUERY_LIMIT_EXCEEDED, visto em 01/10/2026 -- o congelamento de setembro
// da Fiança falhou por isso).
//
// Protegida por CRON_SECRET — mesmo padrão de congelar-paineis/route.ts.

// Ver ramos-elementares/page.tsx -- a partir daqui Novos vêm do Bitrix.
const COMPETENCIA_INICIO_HIBRIDO_RAMOS = "2026-09";

const PAINEIS = {
  fianca: {
    nome: "Seguro Fiança",
    async salvar(competencia: string) {
      const payload = await buscarAnaliseGerencialAoVivo(competencia);
      return { tabela: "seguro_fianca_snapshots", payload, atualizadoEm: new Date().toISOString(), extra: {} };
    },
  },
  capitalizacao: {
    nome: "Capitalização",
    async salvar(competencia: string) {
      const payload = await montarPainelCapitalizacao(competencia);
      return { tabela: "capitalizacao_snapshots", payload, atualizadoEm: payload.atualizadoEm, extra: {} };
    },
  },
  "seguro-auto": {
    nome: "Seguro Auto",
    async salvar(competencia: string) {
      const payload = await montarPainelSeguroAuto(competencia);
      return { tabela: "seguro_auto_snapshots", payload, atualizadoEm: payload.atualizadoEm, extra: {} };
    },
  },
  "ramos-elementares": {
    nome: "Ramos Elementares",
    async salvar(competencia: string) {
      const fonte =
        competencia >= COMPETENCIA_INICIO_HIBRIDO_RAMOS
          ? await lerFonteRamosElementaresHibrida(competencia)
          : await lerFonteRamosElementares(competencia);
      const payload = montarAnaliseRamosElementares(fonte);
      return {
        tabela: "ramos_elementares_snapshots",
        payload,
        atualizadoEm: payload.atualizadoEm,
        extra: { planilha_id: fonte.planilha.id, planilha_titulo: fonte.planilha.titulo },
      };
    },
  },
} as const;

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const chave = request.nextUrl.searchParams.get("painel") as keyof typeof PAINEIS | null;
  const painel = chave && PAINEIS[chave];
  if (!painel) {
    return NextResponse.json({ erro: `painel inválido, use: ${Object.keys(PAINEIS).join(", ")}` }, { status: 400 });
  }

  // As mesmas competências que o relatório das 8h vai ler (na segunda, sexta
  // a domingo pode atravessar a virada do mês).
  const periodo = calcularPeriodoRelatorio();
  const competencias = [...new Set([...periodo.dias.map((d) => d.slice(0, 7)), periodo.competenciaMes])];
  const supabase = createServiceClient();

  const resultados = [];
  for (const competencia of competencias) {
    try {
      const { tabela, payload, atualizadoEm, extra } = await painel.salvar(competencia);
      const { error } = await supabase
        .from(tabela)
        .upsert({ competencia, atualizado_em: atualizadoEm, payload, ...extra }, { onConflict: "competencia" });
      resultados.push(error ? { competencia, ok: false, erro: error.message } : { competencia, ok: true });
    } catch (erro) {
      resultados.push({ competencia, ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
    }
  }

  const ok = resultados.every((r) => r.ok);
  if (!ok) {
    await alertarAdmin({
      contexto: `A atualização de madrugada do painel ${painel.nome} falhou -- o relatório das 8h vai sair com a última foto salva (com aviso de "pode faltar algo").`,
      detalhe: JSON.stringify(resultados),
      quem: "Relatório diário (WhatsApp)",
    });
  }
  return NextResponse.json({ ok, painel: chave, resultados }, { status: ok ? 200 : 500 });
}
