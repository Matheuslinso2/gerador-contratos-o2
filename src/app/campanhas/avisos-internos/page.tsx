import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { TEMPLATES_AVISO_INTERNO } from "@/lib/avisosInternos/templates";

export const dynamic = "force-dynamic";

export default async function AvisosInternosPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/campanhas" className="text-sm font-medium text-o2-navy hover:underline">
            ← Voltar pra campanhas
          </Link>
          <Link href="/campanhas/avisos-internos/equipe" className="text-xs font-medium text-o2-navy hover:underline">
            Gerenciar e-mails da equipe
          </Link>
        </div>

        <PageHeader icon={<IconMail />} titulo="Avisos internos" subtitulo="Comunicados pra equipe O2 — escolha um modelo pra começar." />

        {ok === "1" && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">Aviso enviado pra equipe.</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TEMPLATES_AVISO_INTERNO.map((t) => (
            <Link
              key={t.id}
              href={`/campanhas/avisos-internos/novo?template=${t.id}`}
              className="rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm transition hover:border-o2-coral"
            >
              <span className="mb-2 inline-block rounded-full bg-o2-navy/10 px-2.5 py-1 text-xs font-medium text-o2-navy">{t.badge}</span>
              <p className="text-sm font-semibold text-o2-navy">{t.nome}</p>
              <p className="mt-1 text-xs text-gray-500">{t.descricao}</p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
