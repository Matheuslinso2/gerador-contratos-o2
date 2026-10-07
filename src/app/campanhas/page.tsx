import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2, DOMINIO_O2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { PRODUTOS_CAMPANHA, rotuloProdutoCampanha } from "@/lib/campanhas/produtos";
import { duplicarCampanha, excluirCampanha, arquivarCampanha, desarquivarCampanha } from "./actions";
import { ExcluirCampanhaButton } from "./ExcluirCampanhaButton";

export const dynamic = "force-dynamic";

type CampanhaRow = {
  id: string;
  nome: string;
  status: string;
  produto: string | null;
  total_destinatarios: number;
  total_enviados: number;
  total_falhas: number;
  created_at: string;
  agendado_para: string | null;
  criado_por_email: string | null;
};

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; arquivadas?: string; status?: string; produto?: string; busca?: string }>;
}) {
  const { erro, arquivadas: verArquivadas, status: filtroStatus, produto: filtroProduto, busca: filtroBusca } = await searchParams;
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
    .select("id, nome, status, produto, total_destinatarios, total_enviados, total_falhas, created_at, agendado_para, criado_por_email")
    .order("created_at", { ascending: false });
  query = mostrarArquivadas ? query.not("arquivada_em", "is", null) : query.is("arquivada_em", null);
  // Pedido do Matheus, 01/10/2026: filtro por status/produto/nome na
  // listagem -- os mesmos campos já usados em todo o resto da tela.
  if (filtroStatus) query = query.eq("status", filtroStatus);
  if (filtroProduto) query = query.eq("produto", filtroProduto);
  if (filtroBusca?.trim()) query = query.ilike("nome", `%${filtroBusca.trim()}%`);
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

  // Painel de resumo (pedido do Matheus, 01/10/2026) -- reflete a lista
  // filtrada acima, não o total geral, pra bater com o que a tela mostra.
  // Abertura só conta quem é de fora da O2 (mesma regra da tela de cada
  // campanha, ver src/app/campanhas/[id]/page.tsx -- a equipe interna
  // pode ser destinatária, mas não é quem a métrica quer medir).
  const campanhasRealizadas = campanhas.filter((c) => c.status === "enviando" || c.status === "concluida");
  const idsRealizadas = campanhasRealizadas.map((c) => c.id);
  const [{ count: totalEnviadosExterno }, { count: totalAbertosExterno }] = idsRealizadas.length
    ? await Promise.all([
        supabase
          .from("campanhas_envios")
          .select("id", { count: "exact", head: true })
          .in("campanha_id", idsRealizadas)
          .eq("status", "enviado")
          .not("email", "ilike", `%${DOMINIO_O2}`),
        supabase
          .from("campanhas_envios")
          .select("id", { count: "exact", head: true })
          .in("campanha_id", idsRealizadas)
          .not("aberto_em", "is", null)
          .not("email", "ilike", `%${DOMINIO_O2}`),
      ])
    : [{ count: 0 }, { count: 0 }];
  const taxaAberturaMedia = totalEnviadosExterno ? ((totalAbertosExterno ?? 0) / totalEnviadosExterno) * 100 : 0;

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

        {!mostrarArquivadas && (
          <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-o2-navy/10 bg-gray-200 shadow-sm sm:grid-cols-4">
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-o2-navy">{campanhasRealizadas.length}</p>
              <p className="text-xs text-gray-500">Campanhas realizadas</p>
            </div>
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-green-700">{totalEnviadosExterno ?? 0}</p>
              <p className="text-xs text-gray-500">E-mails enviados</p>
            </div>
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-o2-navy">{totalAbertosExterno ?? 0}</p>
              <p className="text-xs text-gray-500">Aberturas (fora da O2)</p>
            </div>
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-o2-coral">{taxaAberturaMedia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</p>
              <p className="text-xs text-gray-500">Taxa média de abertura</p>
            </div>
          </div>
        )}

        {/* Pedido do Matheus, 01/10/2026 -- filtro por status/produto/nome,
            via GET direto (sem JS) igual ao resto da tela: recarrega a
            página com os parâmetros escolhidos. */}
        <form className="flex flex-wrap items-end gap-2 rounded-xl border border-o2-navy/10 bg-quadro p-3">
          {mostrarArquivadas && <input type="hidden" name="arquivadas" value="1" />}
          <div>
            <label className="mb-0.5 block text-xs text-gray-500">Buscar por nome</label>
            <input
              type="text"
              name="busca"
              defaultValue={filtroBusca ?? ""}
              placeholder="Nome da campanha..."
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-gray-500">Status</label>
            <select
              name="status"
              defaultValue={filtroStatus ?? ""}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
            >
              <option value="">Todos</option>
              {Object.entries(ROTULO_STATUS_CAMPANHA).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-gray-500">Produto</label>
            <select
              name="produto"
              defaultValue={filtroProduto ?? ""}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
            >
              <option value="">Todos</option>
              {PRODUTOS_CAMPANHA.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
          >
            Filtrar
          </button>
          {(filtroStatus || filtroProduto || filtroBusca) && (
            <Link
              href={mostrarArquivadas ? "/campanhas?arquivadas=1" : "/campanhas"}
              className="text-sm font-medium text-gray-500 hover:underline"
            >
              Limpar filtro
            </Link>
          )}
        </form>

        {!campanhas.length ? (
          <p className="rounded-2xl border border-o2-navy/10 bg-quadro p-8 text-center text-sm text-gray-500 shadow-sm">
            {filtroStatus || filtroProduto || filtroBusca
              ? "Nenhuma campanha encontrada com esse filtro."
              : mostrarArquivadas
                ? "Nenhuma campanha arquivada."
                : "Nenhuma campanha criada ainda."}
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
                      {c.criado_por_email && ` · por ${c.criado_por_email}`}
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
                  {c.produto && (
                    <span className="whitespace-nowrap rounded-full bg-o2-navy/10 px-2.5 py-1 text-xs font-medium text-o2-navy">
                      {rotuloProdutoCampanha(c.produto)}
                    </span>
                  )}
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
