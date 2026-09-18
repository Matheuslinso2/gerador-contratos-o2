import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconCalculator } from "@/components/icons";
import BackLink from "@/components/BackLink";
import CalculadoraMulta from "./CalculadoraMulta";

export const dynamic = "force-dynamic";

// Ferramenta pública só pra quem chega com o cookie de /acesso/<token>
// (pedido do Matheus, 16 e 18/09/2026 -- ver src/proxy.ts e
// src/lib/acessoPublico.ts; sem o cookie, o middleware já manda pro /login
// antes de chegar aqui). Calculadora 100% client-side (CalculadoraMulta.tsx),
// nada é salvo, então liberar é só trocar o cabeçalho: quem está logado
// continua vendo o AppHeader normal do Workspace; visitante anônimo vê só a
// logo, sem nav interna.
export default async function MultaRescisoriaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      {user ? (
        <AppHeader userEmail={user.email} logoutAction={signOut} />
      ) : (
        <div className="flex justify-center border-b border-gray-100 bg-white py-4">
          <Image src="/marca-o2/o2-logo-horizontal.png" alt="O2 Seguros" width={140} height={33} priority />
        </div>
      )}
      <main className="mx-auto max-w-3xl flex-1 space-y-4 p-8">
        <div className="space-y-2">
          {user && <BackLink />}
          <PageHeader
            icon={<IconCalculator />}
            titulo="Cálculo de multa rescisória"
            subtitulo="Calculadora simples de consulta — nada aqui é salvo ou registrado no sistema."
          />
        </div>

        <CalculadoraMulta />

        {!user && (
          <p className="text-xs text-gray-500">
            <Link href="/ferramentas" className="font-medium text-o2-coral hover:underline">
              ← Voltar ao início
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
