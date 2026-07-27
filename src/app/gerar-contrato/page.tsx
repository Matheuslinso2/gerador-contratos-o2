import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FormularioContrato from "./FormularioContrato";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

export default async function GerarContratoPage({
  searchParams,
}: {
  searchParams: Promise<{ sucesso?: string; erro?: string }>;
}) {
  const { sucesso, erro } = await searchParams;
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
          <BackLink />
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
        .select(
          "id, locador, locatario, endereco_imovel, texto_gerado, created_at, laudo_modo, laudo_arquivo_nome"
        )
        .eq("imobiliaria_id", imobiliaria.id)
        .order("created_at", { ascending: false }),
    ]);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Gerar contrato de locação</h1>
            <p className="text-sm text-gray-500">Imobiliária: {imobiliaria.nome}</p>
          </div>
        </div>

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}
        {sucesso && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
            Contrato gerado com sucesso! Ele já está na lista abaixo.
          </p>
        )}

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
            <details
              key={c.id}
              open={c.id === sucesso}
              className={`rounded-xl border bg-white p-3 ${
                c.id === sucesso ? "border-green-400 ring-1 ring-green-300" : "border-o2-navy/10"
              }`}
            >
              <summary className="cursor-pointer font-medium text-o2-navy">
                {c.locador} × {c.locatario} — {c.endereco_imovel}
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={`/api/contratos/${c.id}/docx`}
                  className="inline-block rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                >
                  Baixar contrato em Word (.docx)
                </a>
                {c.laudo_modo === "arquivo_embutido" && (
                  <a
                    href={`/api/contratos/${c.id}/pdf`}
                    className="inline-block rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-gray/40"
                  >
                    Baixar contrato completo com laudo (PDF)
                  </a>
                )}
                {(c.laudo_modo === "arquivo_separado" || c.laudo_modo === "arquivo_embutido") && (
                  <a
                    href={`/api/contratos/${c.id}/laudo`}
                    className="inline-block rounded-full border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    Baixar laudo de vistoria (original{c.laudo_arquivo_nome ? `: ${c.laudo_arquivo_nome}` : ""})
                  </a>
                )}
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{c.texto_gerado}</pre>
            </details>
          ))}
          {!contratos?.length && <p className="text-sm text-gray-500">Nenhum contrato gerado ainda.</p>}
        </section>
      </main>
    </>
  );
}
