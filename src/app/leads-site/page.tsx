import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { buscarTrafegoSite } from "@/lib/cloudflareAnalytics";

export const dynamic = "force-dynamic";

const DIAS_TRAFEGO = 7;

type LeadRow = {
  id: string;
  formulario: string | null;
  pagina_url: string | null;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  campos: Record<string, unknown>;
  criado_em: string;
};

export default async function LeadsSitePage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; formulario?: string }>;
}) {
  const { busca, formulario } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  let query = supabase
    .from("leads_site_o2seguros")
    .select("id, formulario, pagina_url, nome, email, telefone, campos, criado_em")
    .order("criado_em", { ascending: false })
    .limit(500);

  if (formulario) query = query.eq("formulario", formulario);
  if (busca?.trim()) {
    const termo = `%${busca.trim()}%`;
    query = query.or(`nome.ilike.${termo},email.ilike.${termo},telefone.ilike.${termo}`);
  }

  const [{ data: leadsData }, { data: formulariosData }, trafego] = await Promise.all([
    query,
    supabase.from("leads_site_o2seguros").select("formulario").not("formulario", "is", null),
    buscarTrafegoSite(DIAS_TRAFEGO),
  ]);
  const leads = (leadsData ?? []) as LeadRow[];
  const formularios = Array.from(new Set((formulariosData ?? []).map((f) => f.formulario as string))).sort();
  const picoVisitasDia = Math.max(1, ...(trafego?.diario.map((d) => d.visitas) ?? [0]));

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-5xl flex-1 space-y-6 p-8">
        <Link href="/" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar ao início
        </Link>

        <PageHeader
          icon={<IconReport />}
          titulo="Leads do site"
          subtitulo="Todo mundo que preencheu um formulário em o2seguros.com.br, num só lugar."
        />

        {trafego && (
          <div className="rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-o2-navy">Tráfego do site (últimos {DIAS_TRAFEGO} dias)</h2>
              <p className="text-xs text-gray-500">Fonte: Cloudflare Web Analytics</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-8">
              <div>
                <p className="text-2xl font-semibold text-o2-navy">{trafego.totalVisitas.toLocaleString("pt-BR")}</p>
                <p className="text-xs text-gray-500">visitas</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-o2-navy">{trafego.totalPageviews.toLocaleString("pt-BR")}</p>
                <p className="text-xs text-gray-500">pageviews</p>
              </div>
            </div>

            {trafego.diario.length > 0 && (
              <div className="mt-4 flex h-24 items-end gap-2">
                {trafego.diario.map((dia) => (
                  <div key={dia.data} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-o2-coral/70"
                      style={{ height: `${Math.max(4, (dia.visitas / picoVisitasDia) * 100)}%` }}
                      title={`${dia.visitas} visitas em ${dia.data}`}
                    />
                    <span className="text-[10px] text-gray-400">
                      {new Date(dia.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {trafego.porPagina.length > 0 && (
              <div className="mt-5 border-t border-o2-navy/10 pt-3">
                <p className="mb-2 text-xs font-medium text-gray-500">Páginas mais visitadas</p>
                <div className="space-y-1">
                  {trafego.porPagina.map((pagina) => (
                    <div key={pagina.caminho} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-o2-navy">{pagina.caminho || "/"}</span>
                      <span className="shrink-0 text-xs text-gray-500">{pagina.visitas.toLocaleString("pt-BR")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-o2-navy/10 bg-quadro p-4 shadow-sm">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs font-medium text-gray-500">Buscar por nome, e-mail ou telefone</label>
            <input
              type="text"
              name="busca"
              defaultValue={busca ?? ""}
              placeholder="Ex: Matheus, matheus@..., 11999999999"
              className="w-full rounded-lg border border-o2-navy/20 px-3 py-2 text-sm focus:border-o2-navy focus:outline-none"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-gray-500">Formulário</label>
            <select
              name="formulario"
              defaultValue={formulario ?? ""}
              className="w-full rounded-lg border border-o2-navy/20 px-3 py-2 text-sm focus:border-o2-navy focus:outline-none"
            >
              <option value="">Todos</option>
              {formularios.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Filtrar
          </button>
          {(busca || formulario) && (
            <Link href="/leads-site" className="text-sm font-medium text-o2-navy hover:underline">
              Limpar filtros
            </Link>
          )}
        </form>

        <p className="text-xs text-gray-500">
          {leads.length} lead{leads.length === 1 ? "" : "s"} {busca || formulario ? "encontrado(s)" : "no total (últimos 500)"}
        </p>

        {!leads.length ? (
          <p className="rounded-2xl border border-o2-navy/10 bg-quadro p-8 text-center text-sm text-gray-500 shadow-sm">
            Nenhum lead encontrado.
          </p>
        ) : (
          <div className="space-y-2">
            {leads.map((lead) => (
              <details
                key={lead.id}
                className="rounded-xl border border-o2-navy/10 bg-quadro p-4 shadow-sm transition hover:border-o2-navy/30"
              >
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-o2-navy">{lead.nome || "(sem nome)"}</p>
                    <p className="truncate text-xs text-gray-500">
                      {lead.email || "sem e-mail"}
                      {lead.telefone && ` · ${lead.telefone}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {lead.formulario && (
                      <span className="whitespace-nowrap rounded-full bg-o2-navy/5 px-2.5 py-1 text-xs font-medium text-o2-navy">
                        {lead.formulario}
                      </span>
                    )}
                    <span className="whitespace-nowrap text-xs text-gray-500">
                      {new Date(lead.criado_em).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                </summary>
                <div className="mt-3 space-y-2 border-t border-o2-navy/10 pt-3">
                  {lead.pagina_url && (
                    <p className="text-xs text-gray-500">
                      Página:{" "}
                      <a href={lead.pagina_url} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">
                        {lead.pagina_url}
                      </a>
                    </p>
                  )}
                  <pre className="overflow-x-auto rounded-lg bg-o2-navy/5 p-3 text-xs text-gray-700">
                    {JSON.stringify(lead.campos, null, 2)}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
