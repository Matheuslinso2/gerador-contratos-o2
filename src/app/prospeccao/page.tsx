import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import ProspeccaoForm from "./ProspeccaoForm";
import ListaProspeccoes from "./ListaProspeccoes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ProspeccaoPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: relatorios } = await supabase
    .from("relatorios_prospeccao")
    .select("id, nome_imobiliaria, cnpj_imobiliaria, criado_por_email, created_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Prospecção — preparação de visita</h1>
            <p className="text-sm text-gray-500">
              Ferramenta interna O2: monta um relatório para se preparar antes de visitar uma
              imobiliária que ainda não é parceira.
            </p>
          </div>
        </div>

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <ProspeccaoForm />
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-o2-navy">Relatórios preparados</h2>
          <ListaProspeccoes relatorios={relatorios ?? []} />
        </section>
      </main>
    </>
  );
}
