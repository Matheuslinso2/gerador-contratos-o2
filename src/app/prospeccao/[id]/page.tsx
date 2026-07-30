import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import RelatorioProspeccaoView from "../RelatorioProspeccaoView";

export const dynamic = "force-dynamic";

export default async function RelatorioProspeccaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: relatorio } = await supabase
    .from("relatorios_prospeccao")
    .select(
      "nome_imobiliaria, cnpj_imobiliaria, url_site, url_instagram, notas_manuais, ficha, numeros_o2, historico_cotacoes, comparativo_regional, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!relatorio) notFound();

  return (
    <>
      <div className="print:hidden">
        <AppHeader userEmail={user?.email} logoutAction={signOut} />
      </div>
      <main className="mx-auto max-w-3xl flex-1 space-y-4 p-8 print:p-0">
        <div className="print:hidden">
          <BackLink />
        </div>
        <RelatorioProspeccaoView relatorio={relatorio} />
      </main>
    </>
  );
}
