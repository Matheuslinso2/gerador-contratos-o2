import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FormularioContrato from "./FormularioContrato";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";

export const dynamic = "force-dynamic";

export default async function GerarContratoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("id, nome")
    .eq("user_id", user!.id)
    .maybeSingle();

  if (!imobiliaria) {
    return (
      <>
        <AppHeader userEmail={user?.email} logoutAction={signOut} />
        <main className="mx-auto max-w-3xl flex-1 space-y-4 p-8">
          <h1 className="text-xl font-semibold text-o2-navy">Gerar contrato de locação</h1>
          <p className="rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800">
            Antes de gerar contratos, complete o cadastro da sua imobiliária em{" "}
            <Link href="/imobiliaria" className="underline">
              /imobiliaria
            </Link>
            .
          </p>
        </main>
      </>
    );
  }

  const [{ data: tiposGarantia }, { data: produtos }, { data: coberturas }, { data: contratos }] =
    await Promise.all([
      supabase.from("tipos_garantia").select("id, nome").order("nome"),
      supabase
        .from("produtos")
        .select("id, nome, tipo_garantia_id, seguradoras(nome)")
        .order("nome"),
      supabase.from("coberturas_adicionais").select("id, nome, produto_id").order("nome"),
      supabase
        .from("contratos")
        .select("id, locador, locatario, endereco_imovel, texto_gerado, created_at")
        .eq("imobiliaria_id", imobiliaria.id)
        .order("created_at", { ascending: false }),
    ]);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
        <div>
          <h1 className="text-xl font-semibold text-o2-navy">Gerar contrato de locação</h1>
          <p className="text-sm text-gray-500">Imobiliária: {imobiliaria.nome}</p>
        </div>

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <FormularioContrato
            tiposGarantia={tiposGarantia ?? []}
            produtos={produtos ?? []}
            coberturas={coberturas ?? []}
          />
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-o2-navy">Contratos gerados</h2>
          {contratos?.map((c) => (
            <details key={c.id} className="rounded-xl border border-o2-navy/10 bg-white p-3">
              <summary className="cursor-pointer font-medium text-o2-navy">
                {c.locador} × {c.locatario} — {c.endereco_imovel}
              </summary>
              <a
                href={`/api/contratos/${c.id}/docx`}
                className="mt-2 inline-block rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
              >
                Baixar contrato em Word (.docx)
              </a>
              <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{c.texto_gerado}</pre>
            </details>
          ))}
          {!contratos?.length && <p className="text-sm text-gray-500">Nenhum contrato gerado ainda.</p>}
        </section>
      </main>
    </>
  );
}
