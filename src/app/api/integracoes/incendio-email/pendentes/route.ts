import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { lerFonteRamosElementares } from "@/lib/ramos-elementares/fonteGoogle";
import { lerFonteRamosElementaresBitrix } from "@/lib/ramos-elementares/fonteBitrix";
import { montarAnaliseRamosElementares, STATUS_TERMINAIS, type AnaliseRamosElementares } from "@/lib/ramos-elementares/analise";

// Lista os negócios "de risco" (em andamento, parados, sem nenhum e-mail
// ainda casado com a linha) pro Apps Script buscar diretamente no Gmail por
// nome + data -- em vez de depender só de frases prontas ("CONTRATAÇÃO
// CONFIRMADA" etc.) pra descobrir que existe correspondência. Fecha o buraco
// de negócio que o cliente autorizou/tratou por e-mail mas nunca gerou
// nenhuma mensagem com uma das frases-gatilho da busca principal.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COMPETENCIA_INICIO_BITRIX = "2026-09";
const LIMIAR_DIAS_SEM_CONTATO = 4;
const LIMITE_RESULTADOS = 30;

function autorizado(request: NextRequest) {
  const secret = process.env.INCENDIO_EMAIL_INTEGRACAO_SECRET;
  return Boolean(secret && request.headers.get("x-o2-integracao-token") === secret);
}

function competenciaAtual(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const ano = partes.find((parte) => parte.type === "year")?.value;
  const mes = partes.find((parte) => parte.type === "month")?.value;
  return `${ano}-${mes}`;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 401 });

  const supabase = createServiceClient();
  const competencia = competenciaAtual();
  const usarBitrix = competencia >= COMPETENCIA_INICIO_BITRIX;

  let analise: AnaliseRamosElementares;
  try {
    const fonte = usarBitrix
      ? await lerFonteRamosElementaresBitrix(competencia)
      : await lerFonteRamosElementares(competencia);
    analise = montarAnaliseRamosElementares(fonte);
  } catch (erro) {
    // Mesmo padrão de resiliência da tela: se a leitura ao vivo falhar,
    // cai pro último retrato salvo em vez de devolver erro.
    const { data: snapshot } = await supabase
      .from("ramos_elementares_snapshots")
      .select("payload")
      .eq("competencia", competencia)
      .maybeSingle();
    if (!snapshot?.payload) {
      return NextResponse.json(
        { ok: false, erro: erro instanceof Error ? erro.message : "Falha ao ler a fonte de Ramos Elementares." },
        { status: 500 }
      );
    }
    analise = snapshot.payload as AnaliseRamosElementares;
  }

  const { data: comCorrespondenciaRaw } = await supabase
    .from("incendio_emails_confirmacao")
    .select("planilha_aba, planilha_linha")
    .eq("planilha_encontrada", true);
  const jaTemEmail = new Set((comCorrespondenciaRaw ?? []).map((linha) => `${linha.planilha_aba}|${linha.planilha_linha}`));

  const pendentes = analise.negociacoes
    .filter((item) => item.tipo !== "endosso")
    .filter((item) => !STATUS_TERMINAIS.has(item.status))
    .filter((item) => item.diasSemContato !== null && item.diasSemContato >= LIMIAR_DIAS_SEM_CONTATO)
    .filter((item) => !jaTemEmail.has(item.id))
    .filter((item) => item.dataReferencia !== null && (item.segurado || item.nomePrincipal))
    .sort((a, b) => (b.diasSemContato ?? 0) - (a.diasSemContato ?? 0))
    .slice(0, LIMITE_RESULTADOS)
    .map((item) => ({
      id: item.id,
      nomePrincipal: item.nomePrincipal,
      segurado: item.segurado || null,
      imobiliaria: item.imobiliaria !== "NÃO INFORMADA" ? item.imobiliaria : null,
      status: item.status,
      diasSemContato: item.diasSemContato,
      dataReferencia: item.dataReferencia,
    }));

  return NextResponse.json({ ok: true, competencia, pendentes });
}
