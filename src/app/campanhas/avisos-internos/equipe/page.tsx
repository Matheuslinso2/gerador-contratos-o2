import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { adicionarEmailAvisoInterno, removerEmailAvisoInterno } from "./actions";

export const dynamic = "force-dynamic";

// Item B da reunião de 15/09/2026, esclarecido pelo Matheus: não era bug,
// era pedido de manutenção -- a Jéssica precisa poder atualizar a lista de
// "Avisos internos" quando entra/sai gente da O2, sem precisar pedir pra
// mexer direto no banco.
export default async function EquipeAvisosInternosPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { ok, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: grupo } = await supabase
    .from("avisos_internos_grupos")
    .select("id, nome, emails")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  const emails = ((grupo?.emails as string[] | null) ?? []).slice().sort();

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <Link href="/campanhas/avisos-internos" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pros modelos
        </Link>

        <PageHeader
          icon={<IconMail />}
          titulo="Equipe — lista de avisos internos"
          subtitulo="Atualize aqui quando alguém entrar ou sair da O2."
        />

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        {!grupo ? (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
            Nenhum grupo de avisos internos cadastrado ainda.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              <strong>{emails.length}</strong> e-mail(s) em <strong>{grupo.nome}</strong>.
            </p>

            <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-o2-navy/10 bg-white shadow-sm">
              {emails.map((email) => (
                <div key={email} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="truncate">{email}</span>
                  <form action={removerEmailAvisoInterno}>
                    <input type="hidden" name="grupo_id" value={grupo.id} />
                    <input type="hidden" name="email" value={email} />
                    <button
                      type="submit"
                      className="whitespace-nowrap rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    >
                      Remover
                    </button>
                  </form>
                </div>
              ))}
              {!emails.length && <p className="px-4 py-6 text-center text-xs text-gray-400">Nenhum e-mail cadastrado.</p>}
            </div>

            <form action={adicionarEmailAvisoInterno} className="flex flex-wrap items-end gap-2 rounded-xl border border-o2-navy/10 bg-quadro p-3">
              <input type="hidden" name="grupo_id" value={grupo.id} />
              <div className="flex-1">
                <label className="mb-0.5 block text-xs text-gray-500">Adicionar e-mail (novo colaborador)</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="nome@o2seguros.com.br"
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
              >
                Adicionar
              </button>
            </form>
          </>
        )}
      </main>
    </>
  );
}
