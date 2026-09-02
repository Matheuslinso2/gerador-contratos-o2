import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import AuditorForm from "./AuditorForm";
import ListaAuditorias from "./ListaAuditorias";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { garantirImobiliariaColaborador } from "@/lib/imobiliariaColaborador";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";

export const dynamic = "force-dynamic";
// Analisar PDF escaneado/imagem (a IA lendo direto das páginas) já demora
// mais que texto puro -- com MAIS de um documento anexado (contrato +
// cotação + certificado, cada um podendo ser escaneado) o tempo soma e
// passava de 60s, estourando o limite e a Vercel matava a função no meio
// (sem nem deixar a mensagem de erro do try/catch em actions.ts aparecer --
// timeout de plataforma não passa por catch nenhum). Dá mais fôlego.
export const maxDuration = 180;

export default async function AuditarContratoPage({
  searchParams,
}: {
  searchParams: Promise<{ ultimo?: string; erro?: string }>;
}) {
  const { ultimo, erro } = await searchParams;
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
          <h1 className="text-xl font-semibold text-o2-navy">Auditar contrato</h1>
          <p className="rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800">
            Antes de auditar contratos, complete o cadastro da sua imobiliária em{" "}
            <Link href="/imobiliaria" className="underline">
              /imobiliaria
            </Link>
            .
          </p>
        </main>
      </>
    );
  }

  const { data: auditorias } = await supabase
    .from("auditorias_contrato")
    .select(
      "id, nome_arquivo, status_geral, tipo_garantia_identificada, locador_identificado, locatario_identificado, endereco_identificado, relatorio, created_at"
    )
    .eq("imobiliaria_id", imobiliaria.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Auditar contrato</h1>
            <p className="text-sm text-gray-500">
              Analisa um contrato já pronto (colado, .docx ou .pdf) e aponta erros e
              inconsistências — não gera um contrato novo.
            </p>
          </div>
        </div>

        {erro && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
        )}

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <AuditorForm userId={user!.id} ultimoId={ultimo} />
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-o2-navy">Auditorias realizadas</h2>
          <ListaAuditorias auditorias={auditorias ?? []} destaque={ultimo} />
        </section>
      </main>
    </>
  );
}
