import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { lerFonteRamosElementares } from "@/lib/ramos-elementares/fonteGoogle";
import { lerFonteRamosElementaresHibrida } from "@/lib/ramos-elementares/fonteHibrida";
import {
  analiseRamosVazia,
  montarAnaliseRamosElementares,
  type AnaliseRamosElementares,
} from "@/lib/ramos-elementares/analise";
import PainelRamosElementares from "./PainelRamosElementares";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A partir desta competência, Novos Negócios/Pendências vêm do Bitrix (SPA
// 1046) e Renovações/Endossos continuam vindo da planilha mensal — ver
// fonteHibrida.ts. Decisão de 11/08/2026 (commit 671d12c), ajustada em
// 01/09/2026 para híbrida em vez de 100% Bitrix (renovações não migraram).
const COMPETENCIA_INICIO_HIBRIDO = "2026-09";

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
  searchParams: Promise<{ competencia?: string }>;
}) {
  const parametros = await searchParams;
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
  const usarHibrido = competencia >= COMPETENCIA_INICIO_HIBRIDO;
  let origem: "planilha" | "hibrida" | "snapshot" | "indisponivel" = usarHibrido ? "hibrida" : "planilha";
  let erroFonte: string | null = null;

  try {
    const fonte = await comLimiteDeTempo(
      usarHibrido ? lerFonteRamosElementaresHibrida(competencia) : lerFonteRamosElementares(competencia),
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
      analise.fonte = usarHibrido
        ? {
            id: "hibrido-indisponivel",
            titulo: "Bitrix24 — Produção Incêndio (novos) + planilha mensal (renovações/endossos)",
            url: "https://o2seguros.bitrix24.com.br/crm/type/1046/list/category/22/",
            modificadaEm: null,
            tipo: "hibrido",
          }
        : { ...analise.fonte, tipo: "google_sheets" };
      origem = "indisponivel";
    }
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
      />
    </>
  );
}
