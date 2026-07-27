import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import CalculadoraMulta from "./CalculadoraMulta";

export const dynamic = "force-dynamic";

export default async function MultaRescisoriaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-4 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Cálculo de multa rescisória</h1>
            <p className="text-sm text-gray-500">
              Calculadora simples de consulta — nada aqui é salvo ou registrado no sistema.
            </p>
          </div>
        </div>

        <CalculadoraMulta />
      </main>
    </>
  );
}
