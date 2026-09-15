import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconFolder } from "@/components/icons";
import { SeletorImobiliarias } from "../SeletorImobiliarias";
import { criarGrupo } from "../actions";

export const dynamic = "force-dynamic";

export default async function NovoGrupoPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: imobiliariasData } = await supabase.from("imobiliarias").select("id, nome, cnpj").order("nome");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <Link href="/campanhas/grupos" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra Grupos
        </Link>

        <PageHeader icon={<IconFolder />} titulo="Novo grupo de imobiliárias" subtitulo="Nomeie e escolha quem faz parte — pode editar depois." />

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <form action={criarGrupo} className="space-y-4 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nome do grupo</label>
            <input
              name="nome"
              required
              placeholder="Ex: Imobiliárias Platina RJ"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
            />
          </div>

          <SeletorImobiliarias imobiliarias={imobiliariasData ?? []} selecionadosIniciais={new Set()} />

          <div className="flex justify-end">
            <SubmitButton
              className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              textoCarregando="Salvando..."
            >
              Criar grupo
            </SubmitButton>
          </div>
        </form>
      </main>
    </>
  );
}
