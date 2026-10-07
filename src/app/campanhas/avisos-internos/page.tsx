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

  // Avisos já enviados (pedido do Matheus, 07/10/2026): lista com quantos
  // abriram, pra abrir o detalhe de quem abriu e quem não abriu.
  const { data: historicoData } = await supabase
    .from("avisos_internos_historico")
    .select("id, assunto, created_at")
    .order("created_at", { ascending: false })
    .limit(15);
  const historico = historicoData ?? [];
  const { data: enviosData } = historico.length
    ? await supabase.from("avisos_internos_envios").select("aviso_id, status, aberto_em").in("aviso_id", historico.map((h) => h.id))
    : { data: [] };
  const resumoPorAviso = new Map<string, { enviados: number; abriram: number }>();
  for (const e of enviosData ?? []) {
    const r = resumoPorAviso.get(e.aviso_id) ?? { enviados: 0, abriram: 0 };
    if (e.status === "enviado") r.enviados++;
    if (e.aberto_em) r.abriram++;
    resumoPorAviso.set(e.aviso_id, r);
  }

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

        {historico.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-o2-navy">Avisos enviados</h2>
            <div className="space-y-2">
              {historico.map((h) => {
                const r = resumoPorAviso.get(h.id) ?? { enviados: 0, abriram: 0 };
                return (
                  <Link
                    key={h.id}
                    href={`/campanhas/avisos-internos/enviados/${h.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-o2-navy/10 bg-quadro p-4 shadow-sm transition hover:border-o2-navy/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-o2-navy">{h.assunto}</span>
                      <span className="block text-xs text-gray-500">
                        {new Date(h.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </span>
                    <span className="whitespace-nowrap rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                      {r.abriram} de {r.enviados} abriram
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
