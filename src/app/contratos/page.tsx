import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import ListaContratosRealizados from "./ListaContratosRealizados";

export const dynamic = "force-dynamic";

export default async function ContratosRealizadosPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; excluido?: string }>;
}) {
  const { erro, excluido } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user!.id)
    .maybeSingle();

  if (!imobiliaria) {
    return (
      <>
        <AppHeader userEmail={user?.email} logoutAction={signOut} />
        <main className="mx-auto max-w-3xl flex-1 space-y-4 p-8">
          <BackLink />
          <h1 className="text-xl font-semibold text-o2-navy">Contratos realizados</h1>
          <p className="rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800">
            Antes de ver seus contratos, complete o cadastro da sua imobiliária em{" "}
            <Link href="/imobiliaria" className="underline">
              /imobiliaria
            </Link>
            .
          </p>
        </main>
      </>
    );
  }

  const [{ data: contratos }, { data: auditorias }] = await Promise.all([
    supabase
      .from("contratos")
      .select(
        "id, locador, locatario, endereco_imovel, texto_gerado, created_at, laudo_modo, laudo_arquivo_nome"
      )
      .eq("imobiliaria_id", imobiliaria.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("auditorias_contrato")
      .select("id, nome_arquivo, status_geral, tipo_garantia_identificada, relatorio, texto_contrato, created_at")
      .eq("imobiliaria_id", imobiliaria.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Contratos realizados</h1>
            <p className="text-sm text-gray-500">
              Todos os contratos gerados e todas as auditorias feitas por esta conta, num só lugar.
            </p>
          </div>
        </div>

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}
        {excluido && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
            Excluído com sucesso.
          </p>
        )}

        <ListaContratosRealizados contratos={contratos ?? []} auditorias={auditorias ?? []} />
      </main>
    </>
  );
}
