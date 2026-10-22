import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconMail } from "@/components/icons";
import CamposPrograma from "../CamposPrograma";
import { criarPrograma } from "../actions";

export const dynamic = "force-dynamic";

export default async function NovoProgramaPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
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
        <Link href="/campanhas/programas" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar para os programas
        </Link>
        <PageHeader
          icon={<IconMail />}
          titulo="Novo programa de campanha"
          subtitulo="Período, produtos e premiação. As imobiliárias e as metas de cada uma entram na próxima tela."
        />
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        <form action={criarPrograma} className="space-y-6 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
          <CamposPrograma emailPadrao={user?.email} />
          <div className="flex justify-end">
            <SubmitButton className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90" textoCarregando="Salvando...">
              Criar e escolher participantes
            </SubmitButton>
          </div>
        </form>
      </main>
    </>
  );
}
