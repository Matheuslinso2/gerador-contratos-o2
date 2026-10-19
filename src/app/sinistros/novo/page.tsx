import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconShield } from "@/components/icons";
import { signOut } from "../../actions";
import { criarRascunho } from "../actions";
import FormContrato from "../FormContrato";
import Passos from "../Passos";
import { Aviso } from "../ui";

export const dynamic = "force-dynamic";

export default async function NovoSinistroPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const interno = isAdmin(user.email) || isColaboradorO2(user.email);

  let imobiliarias: { id: string; nome: string }[] | undefined;
  if (interno) {
    const { data } = await supabase.from("imobiliarias").select("id, nome, apelido").order("nome");
    imobiliarias = (data ?? []).map((i) => ({ id: i.id, nome: i.apelido ? `${i.nome} (${i.apelido})` : i.nome }));
  } else {
    const imob = await buscarImobiliariaDoUsuario(supabase, user);
    if (!imob) redirect("/imobiliaria");
  }

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <Link href="/sinistros" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">
          ← Sinistros
        </Link>
        <PageHeader icon={<IconShield />} titulo="Abrir sinistro" subtitulo="Seguro Fiança · leva uns 10 minutos com os documentos em mãos" />
        <Passos atual={1} />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <FormContrato action={criarRascunho} imobiliarias={imobiliarias} textoBotao="Salvar e continuar →" />
      </main>
    </>
  );
}
