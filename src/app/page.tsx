import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "./actions";
import AppHeader from "@/components/AppHeader";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
          <Image src="/o2-logo-color.png" alt="O2 Seguros" width={168} height={100} priority />
          <div>
            <h1 className="text-2xl font-bold text-o2-navy">Gerador de Contratos de Locação</h1>
            <p className="mt-1 text-sm text-gray-600">Painel para imobiliárias parceiras da O2 Seguros</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/login"
              className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90"
            >
              Entrar
            </Link>
            <Link
              href="/signup"
              className="rounded-full border border-o2-navy px-6 py-2.5 font-medium text-o2-navy transition hover:bg-white"
            >
              Criar conta
            </Link>
          </div>
        </main>
      </>
    );
  }

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const cadastroCompleto = !!imobiliaria || isAdmin(user.email) || isColaboradorO2(user.email);

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-xl flex-1 space-y-4 p-8">
        <h1 className="text-xl font-semibold text-o2-navy">Painel</h1>

        {!cadastroCompleto && (
          <Link
            href="/imobiliaria"
            className="block rounded-xl border border-yellow-400 bg-yellow-50 p-4 text-sm text-yellow-800 transition hover:bg-yellow-100"
          >
            <span className="font-medium">Complete o cadastro da sua imobiliária</span> para
            poder gerar e auditar contratos. Clique aqui para começar →
          </Link>
        )}

        <div className="flex flex-col gap-3">
          {isAdmin(user.email) && (
            <>
              <Link
                href="/clausulas"
                className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <p className="font-medium text-o2-navy">Biblioteca de cláusulas (admin)</p>
                <p className="text-sm text-gray-500">Seguradoras, produtos e coberturas adicionais</p>
              </Link>
              <Link
                href="/admin/imobiliarias"
                className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <p className="font-medium text-o2-navy">Imobiliárias cadastradas (admin)</p>
                <p className="text-sm text-gray-500">Visão de todas as contas de imobiliária parceiras</p>
              </Link>
            </>
          )}
          <Link
            href="/imobiliaria"
            className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <p className="font-medium text-o2-navy">Configuração da imobiliária</p>
            <p className="text-sm text-gray-500">Dados-base e variáveis de praxe</p>
          </Link>
          <Link
            href="/gerar-contrato"
            className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium text-o2-navy">Gerar contrato</p>
              {!cadastroCompleto && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                  cadastro pendente
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">Monta o contrato final e exporta em Word</p>
          </Link>
          <Link
            href="/auditar-contrato"
            className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium text-o2-navy">Auditar contrato</p>
              {!cadastroCompleto && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                  cadastro pendente
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">Analisa um contrato pronto e aponta erros e inconsistências</p>
          </Link>
          <Link
            href="/contratos"
            className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <p className="font-medium text-o2-navy">Contratos realizados</p>
            <p className="text-sm text-gray-500">Busca contratos gerados e auditorias por CPF, nome ou endereço</p>
          </Link>
        </div>
      </main>
    </>
  );
}
