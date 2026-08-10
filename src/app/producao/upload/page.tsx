import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import UploadProducaoForm from "./UploadProducaoForm";
import UploadEnderecosForm from "./UploadEnderecosForm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function UploadProducaoPage({
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

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <Link
            href="/producao"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline"
          >
            ← Voltar para Produção
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Carregar grade de produção</h1>
            <p className="text-sm text-gray-500">
              Envie a grade (.xlsx) exportada do CORP, um ramo por vez — o dashboard é atualizado
              automaticamente depois de cada envio.
            </p>
          </div>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">✅ {ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>}

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-o2-navy">1. Grade de produção</h2>
          <p className="mb-4 text-xs text-gray-500">Prêmio, comissão e volume — obrigatório pra cada ramo.</p>
          <UploadProducaoForm userId={user!.id} />
        </div>

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-o2-navy">2. Endereços (opcional)</h2>
          <p className="mb-4 text-xs text-gray-500">
            Enriquece a produção já carregada com bairro/cidade e valor de aluguel, quando disponível.
          </p>
          <UploadEnderecosForm userId={user!.id} />
        </div>
      </main>
    </>
  );
}
