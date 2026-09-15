import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { duplicarCampanha, excluirCampanha } from "./actions";
import { ExcluirCampanhaButton } from "./ExcluirCampanhaButton";

export const dynamic = "force-dynamic";

type CampanhaRow = {
  id: string;
  nome: string;
  status: string;
  total_destinatarios: number;
  total_enviados: number;
  total_falhas: number;
  created_at: string;
  agendado_para: string | null;
};

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: campanhasData } = await supabase
    .from("campanhas")
    .select("id, nome, status, total_destinatarios, total_enviados, total_falhas, created_at, agendado_para")
    .order("created_at", { ascending: false });
  const campanhas = (campanhasData ?? []) as CampanhaRow[];

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <Link href="/" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar ao início
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader
            icon={<IconMail />}
            titulo="Campanhas comerciais"
            subtitulo="E-mails de campanha para a base de imobiliárias parceiras, via Resend."
          />
          <div className="flex items-center gap-3">
            <Link href="/campanhas/grupos" className="text-sm font-medium text-o2-navy hover:underline">
              Grupos de imobiliárias
            </Link>
            <Link
              href="/campanhas/avisos-internos"
              className="whitespace-nowrap rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
            >
              Avisos internos
            </Link>
            <Link
              href="/campanhas/nova"
              className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Nova campanha
            </Link>
          </div>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        {!campanhas.length ? (
          <p className="rounded-2xl border border-o2-navy/10 bg-quadro p-8 text-center text-sm text-gray-500 shadow-sm">
            Nenhuma campanha criada ainda.
          </p>
        ) : (
          <div className="space-y-2">
            {campanhas.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-o2-navy/10 bg-quadro p-4 shadow-sm transition hover:border-o2-navy/30"
              >
                <Link href={`/campanhas/${c.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-o2-navy">{c.nome}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(c.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    {c.status === "agendada" && c.agendado_para && (
                      <>
                        {" · agendada pra "}
                        {new Date(c.agendado_para).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                      </>
                    )}
                    {(c.status === "enviando" || c.status === "concluida") && (
                      <>
                        {" · "}
                        {c.total_enviados}/{c.total_destinatarios} enviados
                        {c.total_falhas > 0 && `, ${c.total_falhas} com erro`}
                      </>
                    )}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${COR_STATUS_CAMPANHA[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {ROTULO_STATUS_CAMPANHA[c.status] ?? c.status}
                  </span>
                  <form action={duplicarCampanha}>
                    <input type="hidden" name="campanha_id" value={c.id} />
                    <input type="hidden" name="voltar_para" value="/campanhas" />
                    <button
                      type="submit"
                      className="whitespace-nowrap rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
                    >
                      Duplicar
                    </button>
                  </form>
                  <form action={excluirCampanha}>
                    <input type="hidden" name="campanha_id" value={c.id} />
                    <ExcluirCampanhaButton
                      nomeCampanha={c.nome}
                      jaEnviada={c.status === "enviando" || c.status === "concluida"}
                      className="whitespace-nowrap rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    />
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
