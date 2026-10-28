import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconChart } from "@/components/icons";
import { perfilDoEmail } from "@/lib/painelComercial/acesso";
import PainelFrame from "./PainelFrame";

export const dynamic = "force-dynamic";

// Painel Comercial v5 (28/10/2026, aprovado pela Vanessa Fochi). Substitui por
// completo o painel anterior desta página. A página só dá a moldura; os dados
// são lidos do Bitrix no servidor e filtrados pelo perfil de quem está logado
// (ver src/lib/painelComercial/acesso.ts).
export default async function PainelComercialPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!perfilDoEmail(user.email)) redirect("/");

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-4 p-6">
        <Link href="/" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar ao início
        </Link>
        <PageHeader icon={<IconChart />} titulo="Comercial" subtitulo="Sucesso do Cliente, Ativação e Campanhas, direto do Bitrix." />
        <PainelFrame />
      </main>
    </>
  );
}
