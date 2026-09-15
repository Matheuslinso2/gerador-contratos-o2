import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconFolder } from "@/components/icons";
import { criarGrupoProspeccao } from "./actions";

export const dynamic = "force-dynamic";

export default async function NovoGrupoProspeccaoPage({
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

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <Link href="/campanhas/grupos" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra Grupos
        </Link>

        <PageHeader
          icon={<IconFolder />}
          titulo="Novo grupo de prospecção"
          subtitulo="Exclusivo pra imobiliárias sem cadastro no Workspace — não precisam ser clientes da O2 hoje."
        />

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <form action={criarGrupoProspeccao} className="space-y-4 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nome do grupo</label>
            <input
              name="nome"
              required
              placeholder="Ex: Prospecção Barra da Tijuca — set/2026"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Planilha (.xlsx)</label>
            <input
              name="arquivo"
              type="file"
              accept=".xlsx,.xls,.csv"
              required
              className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-o2-navy file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
            />
            <p className="mt-1 text-xs text-gray-400">
              Colunas: nome da imobiliária, nome do responsável (quem recebe o e-mail), e-mail e CNPJ/CPF.
            </p>
          </div>

          <div className="flex justify-end">
            <SubmitButton
              className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              textoCarregando="Criando..."
            >
              Criar grupo
            </SubmitButton>
          </div>
        </form>
      </main>
    </>
  );
}
