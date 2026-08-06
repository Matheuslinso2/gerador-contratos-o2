import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import UploadFaturaForm from "./UploadFaturaForm";
import FaturasSubHeader from "../FaturasSubHeader";
import { IconUpload } from "../icons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function UploadFaturaPage({
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
          titulo="Enviar fatura"
          subtitulo="Selecione a competência e envie o PDF da fatura recebida da seguradora."
        />

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}

        <div className="rounded-2xl border border-o2-navy/10 bg-white p-6 shadow-sm">
          <UploadFaturaForm userId={user!.id} />
        </div>
      </main>
    </>
  );
}
