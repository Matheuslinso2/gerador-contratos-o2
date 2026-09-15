import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconFolder } from "@/components/icons";

export const dynamic = "force-dynamic";

type GrupoRow = { id: string; nome: string; tipo: string; imobiliaria_ids: string[] | null; created_at: string };

export default async function GruposCampanhaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: gruposData }, { data: contatosData }] = await Promise.all([
    supabase.from("campanhas_grupos").select("id, nome, tipo, imobiliaria_ids, created_at").order("nome"),
    supabase.from("campanhas_grupos_contatos").select("grupo_id"),
  ]);
  const grupos = (gruposData ?? []) as GrupoRow[];
  const contatosPorGrupo = new Map<string, number>();
  for (const c of contatosData ?? []) {
    contatosPorGrupo.set(c.grupo_id, (contatosPorGrupo.get(c.grupo_id) ?? 0) + 1);
  }

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader
            icon={<IconFolder />}
            titulo="Grupos de imobiliárias"
            subtitulo="Listas reutilizáveis pra aplicar rápido nos destinatários de uma campanha."
          />
          <div className="flex items-center gap-2">
            <Link
              href="/campanhas/grupos/novo-prospeccao"
              className="whitespace-nowrap rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
            >
              Novo grupo de prospecção
            </Link>
            <Link
              href="/campanhas/grupos/novo"
              className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Novo grupo
            </Link>
          </div>
        </div>

        {!grupos.length ? (
          <p className="rounded-2xl border border-o2-navy/10 bg-quadro p-8 text-center text-sm text-gray-500 shadow-sm">
            Nenhum grupo criado ainda.
          </p>
        ) : (
          <div className="space-y-2">
            {grupos.map((g) => (
              <Link
                key={g.id}
                href={`/campanhas/grupos/${g.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-o2-navy/10 bg-quadro p-4 shadow-sm transition hover:border-o2-navy/30"
              >
                <span className="flex items-center gap-2">
                  {g.tipo === "prospeccao" && (
                    <span className="whitespace-nowrap rounded-full bg-o2-coral/10 px-2 py-0.5 text-xs font-medium text-o2-coral">Prospecção</span>
                  )}
                  <p className="text-sm font-semibold text-o2-navy">{g.nome}</p>
                </span>
                <p className="text-xs text-gray-500">
                  {(g.imobiliaria_ids ?? []).length} imobiliária(s)
                  {(contatosPorGrupo.get(g.id) ?? 0) > 0 && ` · ${contatosPorGrupo.get(g.id)} contato(s) de prospecção`}
                </p>
              </Link>
            ))}
          </div>
        )}

        <Link href="/campanhas" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra Campanhas
        </Link>
      </main>
    </>
  );
}
