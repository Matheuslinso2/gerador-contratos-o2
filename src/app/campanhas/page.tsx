import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { duplicarCampanha, excluirCampanha, arquivarCampanha, desarquivarCampanha } from "./actions";
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
  searchParams: Promise<{ erro?: string; arquivadas?: string }>;
}) {
  const { erro, arquivadas: verArquivadas } = await searchParams;
  const mostrarArquivadas = verArquivadas === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  // Arquivamento (pedido do Matheus, 15/09/2026): a lista principal só
  // mostra campanhas ativas; arquivadas ficam numa consulta à parte
  // (mesma tela, alternada por ?arquivadas=1), sem sumir de vez como
  // excluirCampanha faz.
  let query = supabase
    .from("campanhas")
    .select("id, nome, status, total_destinatarios, total_enviados, total_falhas, created_at, agendado_para")
    .order("created_at", { ascending: false });
  query = mostrarArquivadas ? query.not("arquivada_em", "is", null) : query.is("arquivada_em", null);
  const { data: campanhasData } = await query;
  const todasCampanhas = (campanhasData ?? []) as CampanhaRow[];

  // Pedido do Matheus, 15/09/2026: campanha agendada fica sempre no topo
  // da lista, com destaque -- não dá pra esquecer que tem um disparo
  // marcado. Entre as agendadas, a mais próxima de disparar vem primeiro;
  // o resto mantém a ordem normal (mais recente primeiro).
  const agendadas = todasCampanhas.filter((c) => c.status === "agendada").sort((a, b) => {
    if (!a.agendado_para || !b.agendado_para) return 0;
    return new Date(a.agendado_para).getTime() - new Date(b.agendado_para).getTime();
  });
  const outras = todasCampanhas.filter((c) => c.status !== "agendada");
  const campanhas = [...agendadas, ...outras];

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-4xl flex-1 space-y-6 p-8">
        <Link href={mostrarArquivadas ? "/campanhas" : "/"} className="text-sm font-medium text-o2-navy hover:underline">
          {mostrarArquivadas ? "← Voltar pra campanhas ativas" : "← Voltar ao início"}
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader
            icon={<IconMail />}
            titulo={mostrarArquivadas ? "Campanhas arquivadas" : "Campanhas comerciais"}
            subtitulo={
              mostrarArquivadas
                ? "Campanhas tiradas do radar do dia a dia — pode desarquivar quando quiser."
                : "E-mails de campanha para a base de imobiliárias parceiras, via Resend."
            }
          />
          <div className="flex items-center gap-3">
            {!mostrarArquivadas && (
              <>
                <Link href="/campanhas?arquivadas=1" className="text-sm font-medium text-o2-navy hover:underline">
                  Campanhas arquivadas
                </Link>
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
              </>
            )}
          </div>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        {!campanhas.length ? (
          <p className="rounded-2xl border border-o2-navy/10 bg-quadro p-8 text-center text-sm text-gray-500 shadow-sm">
            {mostrarArquivadas ? "Nenhuma campanha arquivada." : "Nenhuma campanha criada ainda."}
          </p>
        ) : (
          <div className="space-y-2">
            {campanhas.map((c) => {
              const agendada = c.status === "agendada";
              return (
              <div
                key={c.id}
                className={
                  agendada
                    ? "flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-o2-coral bg-o2-coral/5 p-4 shadow-sm transition hover:border-o2-coral"
                    : "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-o2-navy/10 bg-quadro p-4 shadow-sm transition hover:border-o2-navy/30"
                }
              >
                <Link href={`/campanhas/${c.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-o2-navy">{c.nome}</p>
                  {agendada && c.agendado_para ? (
                    <p className="text-xs font-semibold text-o2-coral">
                      Campanha agendada para{" "}
                      {new Date(c.agendado_para).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500">
                      {new Date(c.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      {(c.status === "enviando" || c.status === "concluida") && (
                        <>
                          {" · "}
                          {c.total_enviados}/{c.total_destinatarios} enviados
                          {c.total_falhas > 0 && `, ${c.total_falhas} com erro`}
                        </>
                      )}
                    </p>
                  )}
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
                      className="whitespace-nowrap rounded-full border border-o2-navy bg-o2-navy/5 px-3 py-1 text-xs font-semibold text-o2-navy shadow-sm transition hover:bg-o2-navy hover:text-white"
                    >
                      Duplicar
                    </button>
                  </form>
                  <form action={mostrarArquivadas ? desarquivarCampanha : arquivarCampanha}>
                    <input type="hidden" name="campanha_id" value={c.id} />
                    <button
                      type="submit"
                      className="whitespace-nowrap rounded-full border border-gray-400 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-700 hover:text-white"
                    >
                      {mostrarArquivadas ? "Desarquivar" : "Arquivar"}
                    </button>
                  </form>
                  <form action={excluirCampanha}>
                    <input type="hidden" name="campanha_id" value={c.id} />
                    <ExcluirCampanhaButton
                      nomeCampanha={c.nome}
                      jaEnviada={c.status === "enviando" || c.status === "concluida"}
                      className="whitespace-nowrap rounded-full border border-red-400 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-600 hover:text-white"
                    />
                  </form>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
