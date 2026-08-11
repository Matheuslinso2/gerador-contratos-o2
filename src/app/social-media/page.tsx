import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import { coletarAgora, gerarRascunho, gerarRascunhoInstitucional, descartarRascunho } from "./actions";
import SubmitButton from "./SubmitButton";

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
};

const ROTULO_CATEGORIA: Record<string, string> = {
  mercado_imobiliario: "Mercado imobiliário",
  seguro_imobiliario: "Seguro imobiliário",
  institucional: "Institucional",
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default async function SocialMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ fonte?: string; q?: string; coleta?: string }>;
}) {
  const { fonte: fonteId, q, coleta } = await searchParams;
  const resultadoColeta = coleta ? coleta.split(";;") : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(isAdmin(user.email) || isColaboradorO2(user.email))) redirect("/");

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

  const { data: posts } = await supabase
    .from("social_media_posts")
    .select("id, categoria, titulo_card, legenda, status, criado_em")
    .order("criado_em", { ascending: false })
    .limit(30)
    .returns<Post[]>();

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} logoutAction={signOut} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Social Media</h1>
            <p className="text-sm text-slate-500">
              Notícias coletadas automaticamente + rascunhos de post gerados por IA. Ainda nada é publicado sozinho.
            </p>
          </div>
          <form action={coletarAgora}>
            <SubmitButton
              textoCarregando="Coletando…"
              className="rounded-md bg-o2-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Coletar agora
            </SubmitButton>
          </form>
        </div>

        {resultadoColeta && (
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
          <h2 className="mb-2 text-sm font-medium text-slate-700">Rascunhos gerados</h2>
          {!posts?.length && (
            <p className="py-4 text-center text-sm text-slate-400">
              Nenhum rascunho ainda. Gere um a partir de uma notícia abaixo, ou crie um institucional.
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
                    <span className="capitalize">{p.status}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{p.legenda}</p>
                  <form action={descartarRascunho} className="mt-2">
                    <input type="hidden" name="post_id" value={p.id} />
                    <SubmitButton textoCarregando="Descartando…" className="text-xs text-red-500 hover:underline">
                      Descartar
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>

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
        </section>

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
      </main>
    </div>
  );
}
