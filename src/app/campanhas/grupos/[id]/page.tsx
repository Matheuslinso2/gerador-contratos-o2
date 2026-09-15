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
import { ExcluirGrupoButton } from "../ExcluirGrupoButton";
import { atualizarGrupo, excluirGrupo } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditarGrupoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { erro, ok } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: grupo }, { data: imobiliariasData }] = await Promise.all([
    supabase.from("campanhas_grupos").select("id, nome, imobiliaria_ids").eq("id", id).single(),
    supabase.from("imobiliarias").select("id, nome, cnpj").order("nome"),
  ]);
  if (!grupo) redirect("/campanhas/grupos");

  const selecionadosIniciais = new Set<string>((grupo.imobiliaria_ids ?? []) as string[]);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <PageHeader icon={<IconFolder />} titulo={grupo.nome} subtitulo="Editar grupo — vale pra campanhas futuras também." />

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <form action={atualizarGrupo} className="space-y-4 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
          <input type="hidden" name="grupo_id" value={grupo.id} />
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nome do grupo</label>
            <input
              name="nome"
              required
              defaultValue={grupo.nome}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
            />
          </div>

          <SeletorImobiliarias imobiliarias={imobiliariasData ?? []} selecionadosIniciais={selecionadosIniciais} />

          <div className="flex justify-end">
            <SubmitButton
              className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              textoCarregando="Salvando..."
            >
              Salvar alterações
            </SubmitButton>
          </div>
        </form>

        <div className="flex items-center justify-between">
          <Link href="/campanhas/grupos" className="text-sm font-medium text-o2-navy hover:underline">
            ← Voltar pra Grupos
          </Link>
          <form action={excluirGrupo}>
            <input type="hidden" name="grupo_id" value={grupo.id} />
            <ExcluirGrupoButton nomeGrupo={grupo.nome} />
          </form>
        </div>
      </main>
    </>
  );
}
