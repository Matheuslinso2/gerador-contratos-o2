import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FormularioContrato from "./FormularioContrato";
import ListaContratos from "./ListaContratos";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { garantirImobiliariaColaborador } from "@/lib/imobiliariaColaborador";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";

export const dynamic = "force-dynamic";
// Gerar contrato agora chama a IA (pra inserir a cláusula de garantia na
// posição certa, e às vezes ler a proposta do título de capitalização) — o
// padrão da Vercel (10s) pode cortar a operação no meio. Dá mais fôlego,
// igual já foi feito no Auditor.
export const maxDuration = 60;

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

  let imobiliaria = await buscarImobiliariaDoUsuario(supabase, user);

  if (!imobiliaria && (isAdmin(user?.email) || isColaboradorO2(user?.email))) {
    imobiliaria = await garantirImobiliariaColaborador(supabase, user!.id, user?.email);
  }

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

  const [{ data: tiposGarantia }, { data: produtos }, { data: contratos }] =
    await Promise.all([
      supabase.from("tipos_garantia").select("id, nome").order("nome"),
      supabase
        .from("produtos")
        .select("id, nome, tipo_garantia_id, seguradoras(nome)")
        .order("nome"),
      supabase
        .from("contratos")
        .select(
          "id, locador, locador_nomes, locatario, locatario_nomes, endereco_imovel, texto_gerado, created_at, laudo_modo, laudo_arquivo_nome"
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
          <FormularioContrato tiposGarantia={tiposGarantia ?? []} produtos={produtos ?? []} />
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-o2-navy">Contratos gerados</h2>
          <ListaContratos contratos={contratos ?? []} destaque={sucesso} />
        </section>
      </main>
    </>
  );
}
