import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { pediuAtualizacao, retratoRecente } from "@/lib/retratoPaineis";

import { lerFonteRamosElementaresDaCompetencia, modoFonteRamos } from "@/lib/ramos-elementares/fonteHibrida";
import {
  analiseRamosVazia,
  montarAnaliseRamosElementares,
  type AnaliseRamosElementares,
} from "@/lib/ramos-elementares/analise";
import PainelRamosElementares from "./PainelRamosElementares";
import {
  montarResolvedorImobiliarias,
  unificarImobiliarias,
  unificarPorNome,
  type ImobiliariaUnificada,
} from "@/lib/ramos-elementares/imobiliariasUnificadas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function mesAnterior(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 2, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

function competenciaValida(valor: string | undefined): valor is string {
  return !!valor && /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);
}

// Timeout do Vercel é 60s e MATA a função sem rodar catch nenhum -- o
// fallback pro retrato salvo (abaixo) só funciona se a gente mesmo cortar a
// busca ao vivo ANTES disso, com folga pra ainda dar tempo de consultar o
// snapshot e responder.
const LIMITE_TEMPO_AO_VIVO_MS = 40_000;

function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado após ${Math.round(ms / 1000)}s buscando a fonte`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export default async function RamosElementaresPage({
  searchParams,
}: {
  searchParams: Promise<{ competencia?: string; atualizar?: string }>;
}) {
  const parametros = await searchParams;
  const forcarAtualizacao = pediuAtualizacao(parametros.atualizar);
  const competencia = competenciaValida(parametros.competencia) ? parametros.competencia : competenciaAtual();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: emailsConfirmacaoRaw } = await supabase
    .from("incendio_emails_confirmacao")
    .select(
      "aba:planilha_aba, linha:planilha_linha, tipo_confirmacao, recebido_em, divergencia, divergencia_tipo, divergencia_motivo, cliente_nome, e_lote, gmail_thread_id"
    )
    .in("tipo_confirmacao", ["contratacao_confirmada", "apolice_emitida", "cancelamento_confirmado", "autorizacao_cliente"])
    .order("recebido_em", { ascending: false });
  const emailsConfirmacao = emailsConfirmacaoRaw ?? [];

  let analise: AnaliseRamosElementares;
  // Planilha até ago/2026, híbrida em set/2026, só Bitrix de out/2026 em
  // diante -- ver fonteHibrida.ts.
  const modo = modoFonteRamos(competencia);
  let origem: "planilha" | "hibrida" | "bitrix" | "snapshot" | "indisponivel" = modo;
  let erroFonte: string | null = null;

  // Caminho rápido: retrato salvo de até 10 min (ver lib/retratoPaineis.ts).
  let retratoRecenteUsado: AnaliseRamosElementares | null = null;
  if (!forcarAtualizacao) {
    const { data: recente } = await supabase
      .from("ramos_elementares_snapshots")
      .select("payload, atualizado_em")
      .eq("competencia", competencia)
      .maybeSingle();
    if (recente?.payload && retratoRecente(recente.atualizado_em)) retratoRecenteUsado = recente.payload as AnaliseRamosElementares;
  }

  if (retratoRecenteUsado) {
    analise = retratoRecenteUsado;
  } else {
  try {
    const fonte = await comLimiteDeTempo(
      lerFonteRamosElementaresDaCompetencia(competencia),
      LIMITE_TEMPO_AO_VIVO_MS
    );
    analise = montarAnaliseRamosElementares(fonte);

    const { error: erroSnapshot } = await supabase.from("ramos_elementares_snapshots").upsert(
      {
        competencia,
        planilha_id: fonte.planilha.id,
        planilha_titulo: fonte.planilha.titulo,
        atualizado_em: analise.atualizadoEm,
        payload: analise,
      },
      { onConflict: "competencia" }
    );
    if (erroSnapshot) console.error("Falha ao salvar snapshot de Ramos Elementares:", erroSnapshot);
  } catch (erro) {
    erroFonte = erro instanceof Error ? erro.message : "Falha ao ler a planilha de Ramos Elementares.";
    const { data: snapshot } = await supabase
      .from("ramos_elementares_snapshots")
      .select("payload")
      .eq("competencia", competencia)
      .maybeSingle();

    if (snapshot?.payload) {
      analise = snapshot.payload as AnaliseRamosElementares;
      origem = "snapshot";
    } else {
      analise = analiseRamosVazia(competencia, erroFonte);
      analise.fonte =
        modo === "bitrix"
          ? {
              id: "bitrix-spa-1046",
              titulo: "Bitrix24 — Produção Incêndio",
              url: "https://o2seguros.bitrix24.com.br/crm/type/1046/list/category/22/",
              modificadaEm: null,
              tipo: "bitrix24",
            }
          : modo === "hibrida"
            ? {
                id: "hibrido-indisponivel",
                titulo: "Bitrix24 — Produção Incêndio (novos e renovações) + planilha mensal (renovações e endossos)",
                url: "https://o2seguros.bitrix24.com.br/crm/type/1046/list/category/22/",
                modificadaEm: null,
                tipo: "hibrido",
              }
            : { ...analise.fonte, tipo: "google_sheets" };
      origem = "indisponivel";
    }
  }
  }

  // Quadro de imobiliárias da Visão geral: novos + renovações pela base
  // unificada de imobiliárias (ver imobiliariasUnificadas.ts). Tendência =
  // cards por imobiliária no retrato salvo do mês anterior.
  const { data: retratoAnterior } = await supabase
    .from("ramos_elementares_snapshots")
    .select("payload")
    .eq("competencia", mesAnterior(competencia))
    .maybeSingle();
  const anterior = retratoAnterior?.payload as AnaliseRamosElementares | undefined;
  let imobiliariasVisao: ImobiliariaUnificada[] = [];
  let imobiliariasMesAnterior: Record<string, number> | null = null;
  try {
    const resolvedor = await montarResolvedorImobiliarias(supabase);
    const unificar = (a: AnaliseRamosElementares) =>
      a.imobiliariasConsolidado
        ? unificarImobiliarias(a.imobiliariasConsolidado, resolvedor)
        : unificarPorNome([a.novos?.consolidado?.porImobiliaria ?? [], a.renovacoes?.atual?.porImobiliaria ?? []], resolvedor);
    imobiliariasVisao = unificar(analise);
    // Out/2026 contra set/2026 não compara: até set as renovações eram contadas
    // por item (linhas da planilha), de out em diante por card (ver
    // fonteHibrida.ts). Nessa virada a tendência fica "—".
    const viradaItemCard = competencia === "2026-10";
    if (anterior?.novos && !viradaItemCard) imobiliariasMesAnterior = Object.fromEntries(unificar(anterior).map((i) => [i.nome, i.total]));
  } catch (erro) {
    console.error("Ramos Elementares: falha ao ler a base unificada de imobiliárias:", erro);
  }

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <PainelRamosElementares
        analise={analise}
        competencia={competencia}
        origem={origem}
        erroFonte={erroFonte}
        emailsConfirmacao={emailsConfirmacao}
        imobiliariasVisao={imobiliariasVisao}
        imobiliariasMesAnterior={imobiliariasMesAnterior}
      />
    </>
  );
}
