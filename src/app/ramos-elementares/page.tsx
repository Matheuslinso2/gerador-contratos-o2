import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { lerFonteRamosElementares } from "@/lib/ramos-elementares/fonteGoogle";
import {
  analiseRamosVazia,
  montarAnaliseRamosElementares,
  type AnaliseRamosElementares,
} from "@/lib/ramos-elementares/analise";
import PainelRamosElementares from "./PainelRamosElementares";

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

function competenciaValida(valor: string | undefined): valor is string {
  return !!valor && /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);
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

  let analise: AnaliseRamosElementares;
  let origem: "ao_vivo" | "snapshot" | "indisponivel" = "ao_vivo";
  let erroFonte: string | null = null;

  try {
    const fonte = await lerFonteRamosElementares(competencia);
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
      />
    </>
  );
}
