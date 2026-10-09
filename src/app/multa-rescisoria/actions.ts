"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Conta 1 uso da calculadora (sem dado pessoal: só data/hora e se havia
// login). Alimenta o KPI "Cálculos de multa rescisória" do Painel de KPIs
// (09/10/2026). Nunca pode atrapalhar a calculadora -- qualquer falha é
// engolida.
export async function registrarUsoCalculadora(): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await createServiceClient().from("multa_rescisoria_usos").insert({ logado: !!user });
  } catch (erro) {
    console.error("Falha ao registrar uso da calculadora de multa:", erro);
  }
}
