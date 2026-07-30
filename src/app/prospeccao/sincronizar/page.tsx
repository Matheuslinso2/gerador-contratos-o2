import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import { sincronizarAction } from "./actions";
import BotaoSincronizar from "./BotaoSincronizar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function SincronizarProspeccaoPage({
  searchParams,
}: {
  searchParams: Promise<{ resultado?: string }>;
}) {
  const { resultado } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { count: totalLinhas } = await supabase
    .from("cotacoes_cache")
    .select("*", { count: "exact", head: true });

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <h1 className="text-xl font-semibold text-o2-navy">Sincronizar planilhas</h1>
          <p className="text-sm text-gray-500">
            Atualiza o cache local com as planilhas novas ou modificadas desde a última
            sincronização. Os relatórios de prospecção usam esse cache, não leem o Google
            Sheets ao vivo — sincronize aqui de vez em quando (ex: toda vez que um mês novo
            for adicionado nas pastas de cotação).
          </p>
        </div>

        {resultado && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
            {resultado}
          </p>
        )}

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm text-gray-600">
            Linhas no cache hoje: <strong>{totalLinhas ?? 0}</strong>
          </p>
          <form action={sincronizarAction} className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" name="forcar_tudo" />
              Forçar recarregar tudo (ignora o que já está sincronizado — use só se mudou algo
              na lógica de extração, ou se ficou faltando algum dado)
            </label>
            <BotaoSincronizar />
          </form>
        </div>
      </main>
    </>
  );
}
