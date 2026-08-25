import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isMatheus, ADMIN_EMAILS } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import ListaUsuarios from "./ListaUsuarios";

export const dynamic = "force-dynamic";

export default async function AdminUsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; sucesso?: string }>;
}) {
  const { erro, sucesso } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) redirect("/");

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.listUsers({ perPage: 200 });

  const usuarios = (data?.users ?? [])
    .filter((u) => !ADMIN_EMAILS.includes(u.email ?? ""))
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(sem e-mail)",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Logins do Workspace</h1>
            <p className="text-sm text-gray-500">{usuarios.length} login(s). Contas de administrador não aparecem aqui.</p>
          </div>
        </div>

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>
        )}
        {sucesso && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">✅ {sucesso}</p>
        )}
        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {error.message}</p>
        )}

        <ListaUsuarios usuarios={usuarios} />
      </main>
    </>
  );
}
