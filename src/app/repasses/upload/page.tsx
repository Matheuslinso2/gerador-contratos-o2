import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import UploadRepasseForm from "./UploadRepasseForm";
import FaturasSubHeader from "../../faturas/FaturasSubHeader";
import { IconUpload } from "../../faturas/icons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function UploadRepassePage({
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
        <FaturasSubHeader
          icon={<IconUpload />}
          titulo="Enviar repasse"
          subtitulo="Selecione a competência e envie o relatório do Corp + o comprovante de pagamento."
          voltarHref="/repasses"
          voltarTexto="Voltar para Repasses"
        />

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}

        <div className="rounded-2xl border border-o2-navy/10 bg-white p-6 shadow-sm">
          <UploadRepasseForm userId={user!.id} />
        </div>
      </main>
    </>
  );
}
