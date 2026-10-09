import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import SubmitButton from "@/components/SubmitButton";
import type { MetricasMidia } from "@/lib/instagram";
import { atualizarMetricasAgora } from "./actions";

export const dynamic = "force-dynamic";

type PostPublicado = {
  id: number;
  titulo_card: string;
  categoria: string;
  slides: string[] | null;
  publicado_em: string;
  instagram_post_id: string | null;
  metricas: MetricasMidia | null;
  metricas_atualizadas_em: string | null;
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const ROTULO_CATEGORIA: Record<string, string> = {
  mercado_imobiliario: "Mercado imobiliário",
  seguro_imobiliario: "Seguro imobiliário",
  seguro_geral: "Seguros (geral)",
  economia: "Economia",
  institucional: "Institucional",
};

const nf = new Intl.NumberFormat("pt-BR");
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : nf.format(n));

// Mês de referência no fuso de Brasília (-03:00 fixo, mesmo critério de
// social-media/actions.ts) -- "mes" na URL é AAAA-MM.
function intervaloDoMes(ano: number, mes: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const proximoAno = mes === 12 ? ano + 1 : ano;
  const proximoMes = mes === 12 ? 1 : mes + 1;
  return {
    inicio: `${ano}-${pad(mes)}-01T00:00:00-03:00`,
    fim: `${proximoAno}-${pad(proximoMes)}-01T00:00:00-03:00`,
  };
}

function hojeEmBrasilia() {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

function mesParaParametro(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function somar(posts: PostPublicado[], campo: keyof MetricasMidia): number | null {
  const comDado = posts.filter((p) => p.metricas && p.metricas[campo] !== null && p.metricas[campo] !== undefined);
  if (!comDado.length) return null;
  return comDado.reduce((total, p) => total + (p.metricas![campo] as number), 0);
}

function Variacao({ atual, anterior }: { atual: number | null; anterior: number | null }) {
  if (atual === null || anterior === null || anterior === 0) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  const sobe = pct >= 0;
  return (
    <span className={`text-xs font-medium ${sobe ? "text-emerald-600" : "text-red-500"}`}>
      {sobe ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs mês anterior
    </span>
  );
}

function Kpi({ rotulo, valor, anterior }: { rotulo: string; valor: number | null; anterior: number | null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold text-o2-navy">{fmt(valor)}</p>
      <Variacao atual={valor} anterior={anterior} />
    </div>
  );
}

export default async function DashboardSocialMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; atualizados?: string; sem_insights?: string; erro?: string }>;
}) {
  const { mes: mesParam, atualizados, sem_insights: semInsights, erro } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(isAdmin(user.email) || isColaboradorO2(user.email))) redirect("/");

  const { ano: anoAtual, mes: mesAtual } = hojeEmBrasilia();

  const casou = /^(\d{4})-(\d{2})$/.exec(mesParam ?? "");
  let ano = casou ? Number(casou[1]) : anoAtual;
  let mes = casou ? Number(casou[2]) : mesAtual;
  if (mes < 1 || mes > 12 || ano > anoAtual || (ano === anoAtual && mes > mesAtual)) {
    ano = anoAtual;
    mes = mesAtual;
  }
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const ehMesAtual = ano === anoAtual && mes === mesAtual;
  const anoProx = mes === 12 ? ano + 1 : ano;
  const mesProx = mes === 12 ? 1 : mes + 1;

  const buscar = async (a: number, m: number) => {
    const { inicio, fim } = intervaloDoMes(a, m);
    const { data } = await supabase
      .from("social_media_posts")
      .select("id, titulo_card, categoria, slides, publicado_em, instagram_post_id, metricas, metricas_atualizadas_em")
      .eq("status", "publicado")
      .gte("publicado_em", inicio)
      .lt("publicado_em", fim)
      .order("publicado_em", { ascending: false })
      .returns<PostPublicado[]>();
    return data ?? [];
  };
  const [posts, postsAnterior] = await Promise.all([buscar(ano, mes), buscar(anoAnt, mesAnt)]);

  const ultimaAtualizacao = posts
    .map((p) => p.metricas_atualizadas_em)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  const semMetricas = posts.length > 0 && posts.every((p) => !p.metricas);
  const faltaInsights = posts.some((p) => p.metricas && p.metricas.alcance === null);

  const alcance = somar(posts, "alcance");
  const interacoes = somar(posts, "interacoes");
  const engajamento = alcance && interacoes !== null ? (interacoes / alcance) * 100 : null;
  const alcanceAnt = somar(postsAnterior, "alcance");
  const interacoesAnt = somar(postsAnterior, "interacoes");
  const engajamentoAnt = alcanceAnt && interacoesAnt !== null ? (interacoesAnt / alcanceAnt) * 100 : null;

  const ranking = [...posts].sort(
    (a, b) =>
      (b.metricas?.visualizacoes ?? b.metricas?.curtidas ?? -1) - (a.metricas?.visualizacoes ?? a.metricas?.curtidas ?? -1)
  );

  const formatos = [
    { nome: "Carrossel", lista: posts.filter((p) => p.slides?.length) },
    { nome: "Imagem única", lista: posts.filter((p) => !p.slides?.length) },
  ].filter((f) => f.lista.length);
  const media = (lista: PostPublicado[], campo: keyof MetricasMidia) => {
    const total = somar(lista, campo);
    return total === null ? null : Math.round(total / lista.filter((p) => p.metricas).length);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} logoutAction={signOut} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Social Media — Desempenho</h1>
            <p className="text-sm text-slate-500">Resultado das publicações no Instagram, mês a mês.</p>
          </div>
          <div className="flex items-center gap-4">
            <a href="/social-media" className="text-sm font-medium text-o2-navy hover:underline">
              ← Voltar
            </a>
            <form action={atualizarMetricasAgora}>
              <SubmitButton
                textoCarregando="Atualizando…"
                className="rounded-md bg-o2-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Atualizar métricas
              </SubmitButton>
            </form>
          </div>
        </div>

        {erro && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Erro ao atualizar: {erro}</p>}
        {atualizados && !erro && (
          <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Métricas atualizadas ({atualizados} {Number(atualizados) === 1 ? "post" : "posts"}).
          </p>
        )}
        {(semInsights || faltaInsights) && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Curtidas e comentários estão disponíveis, mas alcance, visualizações, salvamentos e compartilhamentos precisam de
            uma permissão nova do Instagram. Peça pra um admin clicar em &quot;Reconectar&quot; na seção Configuração do Instagram
            em /social-media e aceitar a permissão de métricas, depois clique em &quot;Atualizar métricas&quot; aqui.
          </p>
        )}

        <div className="mb-4 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2">
          <a
            href={`/social-media/dashboard?mes=${mesParaParametro(anoAnt, mesAnt)}`}
            className="text-sm font-medium text-o2-navy hover:underline"
          >
            ← {MESES[mesAnt - 1]}
          </a>
          <span className="text-sm font-semibold capitalize text-slate-700">
            {MESES[mes - 1]} de {ano}
          </span>
          {ehMesAtual ? (
            <span className="w-16" />
          ) : (
            <a
              href={`/social-media/dashboard?mes=${mesParaParametro(anoProx, mesProx)}`}
              className="text-sm font-medium text-o2-navy hover:underline"
            >
              {MESES[mesProx - 1]} →
            </a>
          )}
        </div>

        {semMetricas && (
          <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
            Ainda não há métricas buscadas pra esses posts — clique em &quot;Atualizar métricas&quot;.
          </p>
        )}

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi rotulo="Publicações no mês" valor={posts.length} anterior={postsAnterior.length} />
          <Kpi rotulo="Visualizações" valor={somar(posts, "visualizacoes")} anterior={somar(postsAnterior, "visualizacoes")} />
          <Kpi rotulo="Alcance (contas únicas)" valor={alcance} anterior={alcanceAnt} />
          <Kpi rotulo="Curtidas" valor={somar(posts, "curtidas")} anterior={somar(postsAnterior, "curtidas")} />
          <Kpi rotulo="Comentários" valor={somar(posts, "comentarios")} anterior={somar(postsAnterior, "comentarios")} />
          <Kpi rotulo="Salvamentos" valor={somar(posts, "salvamentos")} anterior={somar(postsAnterior, "salvamentos")} />
          <Kpi
            rotulo="Compartilhamentos"
            valor={somar(posts, "compartilhamentos")}
            anterior={somar(postsAnterior, "compartilhamentos")}
          />
          <Kpi
            rotulo="Engajamento (% do alcance)"
            valor={engajamento === null ? null : Number(engajamento.toFixed(1))}
            anterior={engajamentoAnt === null ? null : Number(engajamentoAnt.toFixed(1))}
          />
        </section>

        {formatos.length > 0 && (
          <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium text-slate-700">Por formato (média por post)</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="py-1 font-normal">Formato</th>
                  <th className="py-1 text-right font-normal">Posts</th>
                  <th className="py-1 text-right font-normal">Visualizações</th>
                  <th className="py-1 text-right font-normal">Curtidas</th>
                  <th className="py-1 text-right font-normal">Salvamentos</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {formatos.map((f) => (
                  <tr key={f.nome} className="border-t border-slate-100">
                    <td className="py-1.5">{f.nome}</td>
                    <td className="py-1.5 text-right">{f.lista.length}</td>
                    <td className="py-1.5 text-right">{fmt(media(f.lista, "visualizacoes"))}</td>
                    <td className="py-1.5 text-right">{fmt(media(f.lista, "curtidas"))}</td>
                    <td className="py-1.5 text-right">{fmt(media(f.lista, "salvamentos"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-slate-700">Posts do mês (do mais visto pro menos visto)</h2>
          {!ranking.length && <p className="py-4 text-center text-sm text-slate-400">Nenhum post publicado nesse mês.</p>}
          <div className="divide-y divide-slate-100">
            {ranking.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/social/imagem/${p.id}${p.slides?.length ? "?slide=0" : ""}`}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{p.titulo_card}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(p.publicado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} ·{" "}
                    {ROTULO_CATEGORIA[p.categoria] ?? p.categoria}
                    {p.slides?.length ? " · Carrossel" : ""}
                    {p.instagram_post_id?.startsWith("http") && (
                      <>
                        {" · "}
                        <a href={p.instagram_post_id} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">
                          Ver no Instagram
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <dl className="grid shrink-0 grid-cols-4 gap-x-4 text-right text-xs">
                  {[
                    ["Views", p.metricas?.visualizacoes],
                    ["Curtidas", p.metricas?.curtidas],
                    ["Coment.", p.metricas?.comentarios],
                    ["Salvos", p.metricas?.salvamentos],
                  ].map(([nome, valor]) => (
                    <div key={nome as string}>
                      <dt className="text-slate-400">{nome}</dt>
                      <dd className="font-medium text-slate-700">{fmt(valor as number | null | undefined)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {ultimaAtualizacao
              ? `Métricas atualizadas em ${new Date(ultimaAtualizacao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} (e automaticamente todo dia às 10h).`
              : "Métricas atualizadas automaticamente todo dia às 10h."}
          </p>
        </section>
      </main>
    </div>
  );
}
