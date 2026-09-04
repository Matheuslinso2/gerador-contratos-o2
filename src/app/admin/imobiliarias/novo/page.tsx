import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import { criarImobiliariaAdmin } from "../actions";

export const dynamic = "force-dynamic";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

// Cadastro mínimo -- só nome e CNPJ/CPF, pra criar o registro e já cair na
// tela unificada [id], onde dá pra completar contrato-base, financeiro,
// e-mail de faturas e vínculos por seguradora.
export default async function NovaImobiliariaAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect("/");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-lg flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <Link href="/admin/imobiliarias" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline">
            ← Todas as imobiliárias
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Nova imobiliária</h1>
            <p className="text-sm text-gray-500">
              Só o essencial pra criar o cadastro — contrato-base, financeiro, e-mail de faturas e vínculos por
              seguradora ficam pra próxima tela.
            </p>
          </div>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <form action={criarImobiliariaAdmin} className="space-y-4 rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Nome *</label>
            <input name="nome" required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">CNPJ ou CPF *</label>
            <input name="cnpj" required placeholder="Só números — CPF, se for corretor autônomo" className={inputClass} />
          </div>
          <button
            type="submit"
            className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Criar e continuar cadastro
          </button>
        </form>
      </main>
    </>
  );
}
