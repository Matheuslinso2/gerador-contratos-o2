import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import ListaContratosRealizados from "./ListaContratosRealizados";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { garantirImobiliariaColaborador } from "@/lib/imobiliariaColaborador";

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

  const vePermitidosDeTodos = isAdmin(user?.email) || isColaboradorO2(user?.email);

  let imobiliaria = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user!.id)
    .maybeSingle()
    .then((r) => r.data);

  if (!imobiliaria && vePermitidosDeTodos) {
    imobiliaria = await garantirImobiliariaColaborador(supabase, user!.id, user?.email);
  }

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

  // Colaborador/admin da O2 veem os dados de todas as imobiliárias — sem
  // filtro aqui, quem garante o que cada login pode ver é o RLS do banco.
  // O join com imobiliarias(nome) vem sempre; pra conta comum é só redundante
  // (o próprio nome dela).
  let consultaContratos = supabase
    .from("contratos")
    .select(
      "id, locador, locatario, endereco_imovel, texto_gerado, created_at, laudo_modo, laudo_arquivo_nome, imobiliarias(nome)"
    )
    .order("created_at", { ascending: false });
  let consultaAuditorias = supabase
    .from("auditorias_contrato")
    .select(
      "id, nome_arquivo, status_geral, tipo_garantia_identificada, locador_identificado, locatario_identificado, endereco_identificado, relatorio, texto_contrato, created_at, imobiliarias(nome)"
    )
    .order("created_at", { ascending: false });

  if (!vePermitidosDeTodos) {
    consultaContratos = consultaContratos.eq("imobiliaria_id", imobiliaria.id);
    consultaAuditorias = consultaAuditorias.eq("imobiliaria_id", imobiliaria.id);
  }

  const [{ data: contratos }, { data: auditorias }] = await Promise.all([
    consultaContratos,
    consultaAuditorias,
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

        <ListaContratosRealizados
          contratos={contratos ?? []}
          auditorias={auditorias ?? []}
          mostrarImobiliaria={vePermitidosDeTodos}
        />
      </main>
    </>
  );
}
