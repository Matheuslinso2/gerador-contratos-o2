import type { Metadata } from "next";
import Image from "next/image";
import RcObrasForm from "./RcObrasForm";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import LinkPublicoCompartilhavel from "@/components/LinkPublicoCompartilhavel";
import { signOut } from "@/app/actions";

export const metadata: Metadata = {
  title: "Seguro Obra (RC Obras) O2 Seguros — Ficha Online",
  description: "Ficha online para dar entrada na cotação de Seguro de Responsabilidade Civil de Obras (RC Obras) junto à O2 Seguros.",
  openGraph: {
    title: "Seguro Obra (RC Obras) O2 Seguros — Ficha Online",
    description: "Ficha online para dar entrada na cotação de Seguro de Responsabilidade Civil de Obras (RC Obras) junto à O2 Seguros.",
    images: ["/marca-o2/o2-logo-horizontal.png"],
  },
};

export default async function RcObrasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      {user && <AppHeader userEmail={user.email} logoutAction={signOut} />}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8">
        {user && <LinkPublicoCompartilhavel path="/rc-obras" />}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative flex items-center justify-center">
            <div aria-hidden className="absolute h-24 w-40 rounded-full opacity-30 blur-2xl" style={{ background: "#F8540D" }} />
            <Image src="/marca-o2/o2-logo-horizontal.png" alt="O2 Seguros" width={170} height={40} priority className="relative" />
          </div>
          <div>
            <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: "#F8540D" }}>
              Seguro Obra — RC Obras
            </span>
            <h1 className="mt-2 text-xl font-semibold" style={{ color: "#01192e" }}>
              Ficha Online — RC Obras
            </h1>
            <p className="mt-1 text-sm text-gray-600">Preencha os dados da obra e das coberturas desejadas para seguirmos com a cotação.</p>
          </div>
        </div>

        <RcObrasForm />
      </main>
    </>
  );
}
