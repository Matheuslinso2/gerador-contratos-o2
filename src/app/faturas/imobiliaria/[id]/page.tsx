import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import { salvarSeguradorasImobiliaria } from "../../actions";

export const dynamic = "force-dynamic";

const SEGURADORAS_PADRAO = ["TOKIO", "PORTO FIANÇA", "PORTO RE", "TOO", "POTTENCIAL", "YELUM"];

export default async function ImobiliariaFaturasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { id } = await params;
  const { ok, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: imobiliaria }, { data: vinculos }] = await Promise.all([
    supabase.from("imobiliarias").select("id, nome, cnpj").eq("id", id).single(),
    supabase.from("faturas_esperadas").select("seguradora, ativo").eq("imobiliaria_id", id),
  ]);
  if (!imobiliaria) redirect("/faturas");

  const ativasHoje = new Set((vinculos ?? []).filter((v) => v.ativo).map((v) => v.seguradora));
  const seguradoras = Array.from(new Set([...SEGURADORAS_PADRAO, ...(vinculos ?? []).map((v) => v.seguradora)]));

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-xl flex-1 space-y-6 p-8">
        <div className="space-y-1">
          <Link
            href="/faturas"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline"
          >
            ← Voltar para Faturas
          </Link>
          <h1 className="text-xl font-semibold text-o2-navy">{imobiliaria.nome}</h1>
          <p className="text-sm text-gray-500">CNPJ: {imobiliaria.cnpj}</p>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-o2-navy">Seguradoras habilitadas</h2>
          <p className="mb-3 text-xs text-gray-500">
            Desmarcar uma seguradora não apaga o histórico — só faz essa imobiliária parar de
            aparecer como esperada nela.
          </p>
          <form action={salvarSeguradorasImobiliaria} className="space-y-2">
            <input type="hidden" name="imobiliaria_id" value={imobiliaria.id} />
            {seguradoras.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm text-gray-800">
                <input type="hidden" name="todas_seguradoras" value={s} />
                <input type="checkbox" name="seguradoras" value={s} defaultChecked={ativasHoje.has(s)} />
                {s}
              </label>
            ))}
            <button
              type="submit"
              className="mt-2 rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Salvar
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
