import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconSend } from "@/components/icons";
import BackLink from "@/components/BackLink";
import PanoramaForm from "./PanoramaForm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AssistenteFiancaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-4 p-8">
        <div className="space-y-2">
          <BackLink />
          <PageHeader
            icon={<IconSend />}
            titulo="Assistente de Vendas — Seguro Fiança"
            subtitulo="Cole o panorama de cotações de um caso e receba a leitura consultiva, seguindo o manual de vendas da O2: pendências a confirmar, comparativo entre opções, recomendação e mensagem pronta para WhatsApp e e-mail."
          />
        </div>

        <PanoramaForm />
      </main>
    </>
  );
}
