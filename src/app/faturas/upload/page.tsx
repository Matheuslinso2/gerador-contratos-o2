import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import Link from "next/link";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import UploadFaturaForm from "./UploadFaturaForm";

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
        <div className="space-y-2">
          <Link
            href="/faturas"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline"
          >
            ← Voltar para Faturas
          </Link>
          <h1 className="text-xl font-semibold text-o2-navy">Enviar fatura</h1>
          <p className="text-sm text-gray-500">
            Selecione a competência e envie o PDF da fatura recebida da seguradora.
          </p>
        </div>

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <UploadFaturaForm userId={user!.id} />
        </div>
      </main>
    </>
  );
}
