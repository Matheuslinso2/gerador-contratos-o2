import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";

export const dynamic = "force-dynamic";

type CampanhaRow = {
  id: string;
  nome: string;
  status: string;
  total_destinatarios: number;
  total_enviados: number;
  total_falhas: number;
  created_at: string;
};

export default async function CampanhasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: campanhasData } = await supabase
    .from("campanhas")
    .select("id, nome, status, total_destinatarios, total_enviados, total_falhas, created_at")
    .order("created_at", { ascending: false });
  const campanhas = (campanhasData ?? []) as CampanhaRow[];

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader
            icon={<IconMail />}
            titulo="Campanhas comerciais"
            subtitulo="E-mails de campanha para a base de imobiliárias parceiras, via Resend."
          />
          <Link
            href="/campanhas/nova"
            className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Nova campanha
          </Link>
        </div>

        {!campanhas.length ? (
          <p className="rounded-2xl border border-o2-navy/10 bg-quadro p-8 text-center text-sm text-gray-500 shadow-sm">
            Nenhuma campanha criada ainda.
          </p>
        ) : (
          <div className="space-y-2">
            {campanhas.map((c) => (
              <Link
                key={c.id}
                href={`/campanhas/${c.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-o2-navy/10 bg-quadro p-4 shadow-sm transition hover:border-o2-navy/30"
              >
                <div>
                  <p className="text-sm font-semibold text-o2-navy">{c.nome}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(c.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    {c.status !== "rascunho" && (
                      <>
                        {" · "}
                        {c.total_enviados}/{c.total_destinatarios} enviados
                        {c.total_falhas > 0 && `, ${c.total_falhas} com erro`}
                      </>
                    )}
                  </p>
                </div>
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${COR_STATUS_CAMPANHA[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {ROTULO_STATUS_CAMPANHA[c.status] ?? c.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
