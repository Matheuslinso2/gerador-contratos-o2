import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

export default async function AdminImobiliariasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect("/");

  const { data: imobiliarias } = await supabase
    .from("imobiliarias")
    .select(
      "id, nome, cnpj, creci, telefone, email, endereco, indice_reajuste, plataforma_assinatura, created_at"
    )
    .order("created_at", { ascending: false });

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Imobiliárias cadastradas</h1>
            <p className="text-sm text-gray-500">
              {imobiliarias?.length ?? 0} conta(s) cadastrada(s). Visão somente leitura.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {imobiliarias?.map((i) => (
            <div key={i.id} className="rounded-xl border border-o2-navy/10 bg-white p-4">
              <p className="font-medium text-o2-navy">{i.nome}</p>
              <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-sm text-gray-600 sm:grid-cols-2">
                <p>CNPJ: {i.cnpj}</p>
                <p>CRECI: {i.creci || "não informado"}</p>
                <p>Telefone: {i.telefone || "não informado"}</p>
                <p>E-mail de login: {i.email || "não informado"}</p>
                <p className="sm:col-span-2">Endereço: {i.endereco || "não informado"}</p>
                <p>Índice de reajuste: {i.indice_reajuste}</p>
                <p>Assinatura eletrônica: {i.plataforma_assinatura || "não informado"}</p>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Cadastrada em {new Date(i.created_at).toLocaleString("pt-BR")}
              </p>
            </div>
          ))}
          {!imobiliarias?.length && (
            <p className="text-sm text-gray-500">Nenhuma imobiliária cadastrada ainda.</p>
          )}
        </div>
      </main>
    </>
  );
}
