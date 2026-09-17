import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import {
  coletarAgora,
  gerarRascunho,
  gerarRascunhoInstitucional,
  descartarRascunho,
  aprovarEPublicar,
  enviarFotoManual,
  removerFotoManual,
  agendarPublicacao,
  cancelarAgendamento,
  arquivarPost,
  desarquivarPost,
} from "./actions";
import SubmitButton from "@/components/SubmitButton";
import { obterStatusConexao } from "@/lib/instagram";

export const dynamic = "force-dynamic";

type Noticia = {
  id: number;
  titulo: string;
  link: string;
  resumo: string | null;
  publicado_em: string | null;
  coletado_em: string;
  usado: boolean;
  social_media_fontes: { nome: string; categoria: string } | null;
};

type Post = {
  id: number;
  categoria: string;
  titulo_card: string;
  legenda: string;
  status: string;
  criado_em: string;
  erro: string | null;
  instagram_post_id: string | null;
  imagem_manual_url: string | null;
  agendado_para: string | null;
  arquivado_em: string | null;
};

const ROTULO_STATUS: Record<string, string> = {
  rascunho: "Rascunho",
  agendado: "Agendado",
  publicado: "Publicado",
  erro: "Erro ao publicar",
};

// Piso do <input datetime-local> -- 5 min à frente (mesma granularidade do
// cron que dispara agendamentos, ver vercel.json). Página é
// force-dynamic, recalcula a cada request.
function minAgendamento(): string {
  const d = new Date(Date.now() + 5 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ROTULO_CATEGORIA: Record<string, string> = {
  mercado_imobiliario: "Mercado imobiliário",
  seguro_imobiliario: "Seguro imobiliário",
  seguro_geral: "Seguros (geral)",
  economia: "Economia",
  institucional: "Institucional",
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default async function SocialMediaPage({
  searchParams,
}: {
  searchParams: Promise<{
    fonte?: string;
    q?: string;
    coleta?: string;
    instagram?: string;
    instagram_erro?: string;
    foto_erro?: string;
    arquivadas?: string;
    erro?: string;
  }>;
}) {
  const {
    fonte: fonteId,
    q,
    coleta,
    instagram: instagramOk,
    instagram_erro: instagramErro,
    foto_erro: fotoErro,
    arquivadas: verArquivadas,
    erro,
  } = await searchParams;
  const mostrarArquivadas = verArquivadas === "1";
  const resultadoColeta = coleta ? coleta.split(";;") : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(isAdmin(user.email) || isColaboradorO2(user.email))) redirect("/");

  const statusInstagram = isAdmin(user.email) ? await obterStatusConexao() : null;

  let consultaNoticias = supabase
    .from("social_media_noticias")
    .select("id, titulo, link, resumo, publicado_em, coletado_em, usado, social_media_fontes(nome, categoria)")
    .order("coletado_em", { ascending: false })
    .limit(100);

  if (fonteId) consultaNoticias = consultaNoticias.eq("fonte_id", fonteId);
  if (q?.trim()) consultaNoticias = consultaNoticias.or(`titulo.ilike.%${q.trim()}%,resumo.ilike.%${q.trim()}%`);

  const { data: noticias } = await consultaNoticias.returns<Noticia[]>();

  const { data: fontes } = await supabase
    .from("social_media_fontes")
    .select("id, nome, categoria, ativo")
    .order("nome");

  let consultaPosts = supabase
    .from("social_media_posts")
    .select(
      "id, categoria, titulo_card, legenda, status, criado_em, erro, instagram_post_id, imagem_manual_url, agendado_para, arquivado_em"
    )
    .order("criado_em", { ascending: false })
    .limit(30);
  consultaPosts = mostrarArquivadas
    ? consultaPosts.not("arquivado_em", "is", null)
    : consultaPosts.is("arquivado_em", null);
  const { data: posts } = await consultaPosts.returns<Post[]>();

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} logoutAction={signOut} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">
              {mostrarArquivadas ? "Social Media — Publicações arquivadas" : "Social Media"}
            </h1>
            <p className="text-sm text-slate-500">
              {mostrarArquivadas
                ? "Posts tirados do radar do dia a dia — pode desarquivar quando quiser."
                : <>Notícias coletadas automaticamente + rascunhos gerados por IA. Nada vai pro Instagram sem você clicar em &quot;Aprovar e publicar&quot;.</>}
            </p>
          </div>
          {mostrarArquivadas ? (
            <a href="/social-media" className="text-sm font-medium text-o2-navy hover:underline">
              ← Voltar
            </a>
          ) : (
            <div className="flex items-center gap-4">
              <a href="/social-media?arquivadas=1" className="text-sm font-medium text-o2-navy hover:underline">
                Ver arquivadas
              </a>
              <form action={coletarAgora}>
                <SubmitButton
                  textoCarregando="Coletando…"
                  className="rounded-md bg-o2-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Coletar agora
                </SubmitButton>
              </form>
            </div>
          )}
        </div>

        {fotoErro && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Erro ao enviar foto: {fotoErro}</p>}
        {erro && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

        {!mostrarArquivadas && statusInstagram && (
          <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium text-slate-700">Configuração do Instagram</h2>
            {instagramOk === "conectado" && (
              <p className="mb-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Conta conectada com sucesso!
              </p>
            )}
            {instagramErro && (
              <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Erro ao conectar: {instagramErro}</p>
            )}
            {statusInstagram.conectado ? (
              <p className="text-sm text-slate-600">
                Conectado como <span className="font-medium">@{statusInstagram.username ?? "?"}</span> — token válido até{" "}
                {new Date(statusInstagram.expiraEm).toLocaleDateString("pt-BR")} (renovado automaticamente todo dia).{" "}
                <a href="/api/instagram/conectar" className="text-o2-navy hover:underline">
                  Reconectar
                </a>
              </p>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-sm text-slate-500">Instagram ainda não conectado — publicação não vai funcionar até conectar.</p>
                <a
                  href="/api/instagram/conectar"
                  className="whitespace-nowrap rounded-md bg-o2-navy px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  Conectar Instagram
                </a>
              </div>
            )}
          </section>
        )}

        {!mostrarArquivadas && resultadoColeta && (
          <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium text-slate-700">Resultado da última coleta</h2>
            <ul className="space-y-1 text-sm">
              {resultadoColeta.map((linha) => {
                const [fonte, resto] = linha.split(": ");
                const deuErro = resto?.startsWith("erro");
                return (
                  <li key={linha} className={deuErro ? "text-red-600" : "text-slate-600"}>
                    <span className="font-medium">{fonte}:</span> {resto}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-slate-700">
            {mostrarArquivadas ? "Publicações arquivadas" : "Rascunhos gerados"}
          </h2>
          {!posts?.length && (
            <p className="py-4 text-center text-sm text-slate-400">
              {mostrarArquivadas
                ? "Nenhuma publicação arquivada."
                : "Nenhum rascunho ainda. Gere um a partir de uma notícia abaixo, ou crie um institucional."}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {(posts ?? []).map((p) => (
              <div key={p.id} className="overflow-hidden rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/social/imagem/${p.id}`} alt={p.titulo_card} className="aspect-square w-full object-cover" />
                <div className="p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                    <span>{ROTULO_CATEGORIA[p.categoria] ?? p.categoria}</span>
                    <span>·</span>
                    <span
                      className={
                        p.status === "publicado"
                          ? "font-medium text-emerald-600"
                          : p.status === "erro"
                            ? "font-medium text-red-600"
                            : p.status === "agendado"
                              ? "font-medium text-blue-600"
                              : ""
                      }
                    >
                      {ROTULO_STATUS[p.status] ?? p.status}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{p.legenda}</p>
                  {p.status === "publicado" && p.instagram_post_id?.startsWith("http") && (
                    <a
                      href={p.instagram_post_id}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-emerald-600 hover:underline"
                    >
                      Ver no Instagram →
                    </a>
                  )}
                  {p.status === "erro" && p.erro && (
                    <p className="mt-1 text-xs text-red-600">Erro: {p.erro}</p>
                  )}
                  {p.status === "agendado" && p.agendado_para && (
                    <p className="mt-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700">
                      Publicação agendada pra{" "}
                      {new Date(p.agendado_para).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                    </p>
                  )}

                  {!mostrarArquivadas && p.status !== "publicado" && (
                    <>
                      <div className="mt-2 flex items-center gap-3">
                        <form action={aprovarEPublicar}>
                          <input type="hidden" name="post_id" value={p.id} />
                          <SubmitButton
                            textoCarregando="Publicando…"
                            className="rounded-md bg-o2-navy px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                          >
                            {p.status === "erro" ? "Tentar de novo" : "Aprovar e publicar"}
                          </SubmitButton>
                        </form>
                        <form action={descartarRascunho}>
                          <input type="hidden" name="post_id" value={p.id} />
                          <SubmitButton textoCarregando="Descartando…" className="text-xs text-red-500 hover:underline">
                            Descartar
                          </SubmitButton>
                        </form>
                      </div>

                      <div className="mt-2 border-t border-slate-100 pt-2">
                        {p.status === "agendado" ? (
                          <form action={cancelarAgendamento}>
                            <input type="hidden" name="post_id" value={p.id} />
                            <SubmitButton textoCarregando="Cancelando…" className="text-xs text-slate-500 hover:underline">
                              Cancelar agendamento
                            </SubmitButton>
                          </form>
                        ) : (
                          <form action={agendarPublicacao} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="post_id" value={p.id} />
                            <label className="text-xs text-slate-500">Ou agende pra depois:</label>
                            <input
                              type="datetime-local"
                              name="agendado_para"
                              min={minAgendamento()}
                              required
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            />
                            <SubmitButton textoCarregando="Agendando…" className="whitespace-nowrap text-xs text-o2-navy hover:underline">
                              Agendar publicação
                            </SubmitButton>
                          </form>
                        )}
                      </div>

                      <div className="mt-2 border-t border-slate-100 pt-2">
                        {p.imagem_manual_url ? (
                          <form action={removerFotoManual} className="flex items-center gap-2">
                            <input type="hidden" name="post_id" value={p.id} />
                            <span className="text-xs text-emerald-600">Sua foto está em uso ✓</span>
                            <SubmitButton textoCarregando="Removendo…" className="text-xs text-slate-500 hover:underline">
                              Usar card gerado
                            </SubmitButton>
                          </form>
                        ) : (
                          <form action={enviarFotoManual} className="flex items-center gap-2">
                            <input type="hidden" name="post_id" value={p.id} />
                            <input
                              type="file"
                              name="foto"
                              accept="image/*"
                              required
                              className="max-w-[160px] text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs"
                            />
                            <SubmitButton textoCarregando="Enviando…" className="whitespace-nowrap text-xs text-o2-navy hover:underline">
                              Usar minha foto
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </>
                  )}

                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <form action={mostrarArquivadas ? desarquivarPost : arquivarPost}>
                      <input type="hidden" name="post_id" value={p.id} />
                      <SubmitButton textoCarregando="Salvando…" className="text-xs text-slate-500 hover:underline">
                        {mostrarArquivadas ? "Desarquivar" : "Arquivar"}
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!mostrarArquivadas && (
            <form action={gerarRascunhoInstitucional} className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
              <input
                type="text"
                name="tema"
                placeholder="Tema institucional (ex: por que seguro incêndio é obrigatório na locação)"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
              <SubmitButton
                textoCarregando="Gerando…"
                className="rounded-md bg-o2-coral px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Gerar institucional
              </SubmitButton>
            </form>
          )}
        </section>

        {!mostrarArquivadas && (
          <>
            <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium text-slate-700">Fontes cadastradas</h2>
              <ul className="grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                {(fontes ?? []).map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${f.ativo ? "bg-emerald-500" : "bg-slate-300"}`} />
                    {f.nome}
                    <span className="text-xs text-slate-400">({ROTULO_CATEGORIA[f.categoria] ?? f.categoria})</span>
                  </li>
                ))}
                {!fontes?.length && <li className="text-slate-400">Nenhuma fonte cadastrada ainda.</li>}
              </ul>
            </section>

            <section className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
              <form action="/social-media" method="get" className="flex flex-wrap items-center gap-2">
                <select
                  name="fonte"
                  defaultValue={fonteId ?? ""}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
                >
                  <option value="">Todas as fontes</option>
                  {(fontes ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  name="q"
                  defaultValue={q ?? ""}
                  placeholder="Palavra-chave no título ou resumo"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-md bg-o2-navy px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Filtrar
                </button>
                {(fonteId || q) && (
                  <a href="/social-media" className="text-sm text-slate-400 hover:underline">
                    Limpar filtro
                  </a>
                )}
              </form>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="divide-y divide-slate-100">
                {(noticias ?? []).map((n) => (
                  <div key={n.id} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <a href={n.link} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span>{n.social_media_fontes?.nome ?? "Fonte desconhecida"}</span>
                        <span>·</span>
                        <span>{ROTULO_CATEGORIA[n.social_media_fontes?.categoria ?? ""] ?? "—"}</span>
                        <span>·</span>
                        <span>{fmtData(n.publicado_em ?? n.coletado_em)}</span>
                        {n.usado && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">usada</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-medium text-slate-800">{n.titulo}</p>
                      {n.resumo && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.resumo}</p>}
                    </a>
                    {!n.usado && (
                      <form action={gerarRascunho} className="shrink-0">
                        <input type="hidden" name="noticia_id" value={n.id} />
                        <SubmitButton
                          textoCarregando="Gerando…"
                          className="rounded-md border border-o2-navy px-3 py-1.5 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white"
                        >
                          Gerar post
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                ))}
                {!noticias?.length && (fonteId || q) && (
                  <p className="px-4 py-8 text-center text-sm text-slate-400">
                    Nenhuma notícia encontrada com esse filtro.
                  </p>
                )}
                {!noticias?.length && !fonteId && !q && (
                  <p className="px-4 py-8 text-center text-sm text-slate-400">
                    Nenhuma notícia coletada ainda. Clique em &quot;Coletar agora&quot; pra testar.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
