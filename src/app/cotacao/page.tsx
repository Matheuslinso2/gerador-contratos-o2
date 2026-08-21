import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import LinkPublicoCompartilhavel from "@/components/LinkPublicoCompartilhavel";
import { signOut } from "@/app/actions";
import { PRODUTOS_LANDING_PAGE } from "@/lib/produtosLandingPage";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";

export const metadata: Metadata = {
  title: "Peça sua cotação — O2 Seguros",
  description: "Escolha o produto e preencha a ficha online para dar entrada na sua cotação com a O2 Seguros.",
  openGraph: {
    title: "Peça sua cotação — O2 Seguros",
    description: "Escolha o produto e preencha a ficha online para dar entrada na sua cotação com a O2 Seguros.",
    images: ["/marca-o2/o2-logo-horizontal.png"],
  },
};

export default async function CotacaoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      {user && <AppHeader userEmail={user.email} logoutAction={signOut} />}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8">
        {user && <LinkPublicoCompartilhavel path="/cotacao" />}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative flex items-center justify-center">
            <div aria-hidden className="absolute h-24 w-40 rounded-full opacity-30 blur-2xl" style={{ background: O2_LARANJA }} />
            <Image src="/marca-o2/o2-logo-horizontal.png" alt="O2 Seguros" width={170} height={40} priority className="relative" />
          </div>
          <div>
            <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: O2_LARANJA }}>
              Peça sua cotação
            </span>
            <h1 className="mt-2 text-xl font-semibold" style={{ color: O2_NAVY }}>
              Qual produto você quer cotar?
            </h1>
            <p className="mt-1 text-sm text-gray-600">Escolha uma opção abaixo pra preencher a ficha online certa.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {PRODUTOS_LANDING_PAGE.map((produto) => (
            <Link
              key={produto.href}
              href={produto.href}
              className="group flex items-start gap-3 rounded-xl border border-gray-200 p-4 text-left transition hover:border-[#F8540D] hover:bg-orange-50"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition group-hover:scale-105"
                style={{ background: O2_LARANJA }}
              >
                {produto.icone}
              </span>
              <div>
                <p className="text-sm font-semibold" style={{ color: O2_NAVY }}>
                  {produto.titulo}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{produto.descricao}</p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
