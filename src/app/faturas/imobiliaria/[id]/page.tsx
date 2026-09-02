import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import FaturasSubHeader from "../../FaturasSubHeader";
import { IconBuilding } from "../../icons";
import VinculosFaturas, { type Vinculo } from "../../VinculosFaturas";

export const dynamic = "force-dynamic";

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

  const [{ data: imobiliaria }, { data: vinculosData }] = await Promise.all([
    supabase.from("imobiliarias").select("id, nome, cnpj, email_faturas, cadastro_incompleto").eq("id", id).single(),
    supabase
      .from("faturas_esperadas")
      .select("seguradora, ativo, dia_vencimento, cnpj_o2, observacao")
      .eq("imobiliaria_id", id),
  ]);
  if (!imobiliaria) redirect("/faturas");

  const vinculos = (vinculosData ?? []) as Vinculo[];

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <FaturasSubHeader icon={<IconBuilding />} titulo={imobiliaria.nome} subtitulo={`CNPJ: ${imobiliaria.cnpj}`} />

        {imobiliaria.cadastro_incompleto && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
            ⚠️ Esse registro foi criado automaticamente pelo Faturas ao identificar uma fatura — ainda não
            tem contrato/índice de reajuste configurados. Não usar pra gerar contrato sem completar o
            cadastro antes.
          </p>
        )}

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">✅ {ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>}

        {isAdmin(user?.email) && (
          <Link href={`/admin/imobiliarias/${imobiliaria.id}`} className="text-xs font-medium text-o2-coral hover:underline">
            Ver cadastro completo dessa imobiliária (dados, contrato-base, funcionários) →
          </Link>
        )}

        <VinculosFaturas
          imobiliariaId={imobiliaria.id}
          emailFaturas={imobiliaria.email_faturas}
          vinculos={vinculos}
          voltarPara={`/faturas/imobiliaria/${imobiliaria.id}`}
        />
      </main>
    </>
  );
}
