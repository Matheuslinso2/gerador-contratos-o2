import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FormularioContrato from "./FormularioContrato";
import ListaContratos from "./ListaContratos";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import BackLink from "@/components/BackLink";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { garantirImobiliariaColaborador } from "@/lib/imobiliariaColaborador";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";
import AvisoAutorizacaoImobiliaria from "@/components/AvisoAutorizacaoImobiliaria";

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

  // Admin/colaborador O2 veem os contratos gerados de TODAS as
  // imobiliárias aqui (achado 17/09/2026 -- o Matheus só via até 25/08
  // porque a lista ficava presa ao id da imobiliária-colaborador dele
  // mesmo, sem o bypass que /contratos já tinha). Mesmo padrão já usado em
  // src/app/contratos/page.tsx.
  const vePermitidosDeTodos = isAdmin(user?.email) || isColaboradorO2(user?.email);

  let imobiliaria = await buscarImobiliariaDoUsuario(supabase, user);

  if (!imobiliaria && vePermitidosDeTodos) {
    imobiliaria = await garantirImobiliariaColaborador(supabase, user!.id, user?.email);
  }

  if (!imobiliaria) {
    return (
      <>
        <AppHeader userEmail={user?.email} logoutAction={signOut} />
        <main className="mx-auto max-w-3xl flex-1 space-y-4 p-8">
          <BackLink />
          <PageHeader icon={<IconReport />} titulo="Gerar contrato de locação" />
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

  let consultaContratos = supabase
    .from("contratos")
    .select(
      "id, locador, locador_nomes, locatario, locatario_nomes, endereco_imovel, texto_gerado, created_at, laudo_modo, laudo_arquivo_nome, imobiliarias(nome)"
    )
    .order("created_at", { ascending: false });
  if (!vePermitidosDeTodos) consultaContratos = consultaContratos.eq("imobiliaria_id", imobiliaria.id);

  const [{ data: tiposGarantia }, { data: produtos }, { data: contratos }] =
    await Promise.all([
      supabase.from("tipos_garantia").select("id, nome").order("nome"),
      supabase
        .from("produtos")
        .select("id, nome, tipo_garantia_id, seguradoras(nome)")
        .order("nome"),
      consultaContratos,
    ]);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
        <div className="space-y-2">
          <BackLink />
          <PageHeader icon={<IconReport />} titulo="Gerar contrato de locação" subtitulo={`Imobiliária: ${imobiliaria.nome}`} />
        </div>

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}
        {sucesso && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
            Contrato gerado com sucesso! Ele já está na lista abaixo.
          </p>
        )}

        <div className="rounded-xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <AvisoAutorizacaoImobiliaria
            imobiliaria={{ autorizado: imobiliaria.autorizado, created_at: imobiliaria.created_at }}
            bypass={vePermitidosDeTodos}
          >
            <FormularioContrato tiposGarantia={tiposGarantia ?? []} produtos={produtos ?? []} />
          </AvisoAutorizacaoImobiliaria>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-o2-navy">Contratos gerados</h2>
          <ListaContratos contratos={contratos ?? []} destaque={sucesso} mostrarImobiliaria={vePermitidosDeTodos} />
        </section>
      </main>
    </>
  );
}
