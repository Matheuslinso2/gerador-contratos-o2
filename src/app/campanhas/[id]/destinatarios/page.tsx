import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { emailsElegiveisCampanha } from "@/lib/campanhas/elegibilidade";
import { SelecionarTodas } from "./Selecionar";
import { salvarDestinatarios } from "./actions";

export const dynamic = "force-dynamic";

type ImobiliariaRow = {
  id: string;
  nome: string;
  cnpj: string | null;
  email: string | null;
  email_faturas: string[] | null;
  email_repasses: string[] | null;
  email_campanhas: string[] | null;
};

export default async function DestinatariosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ busca?: string; grupo?: string }>;
}) {
  const { id } = await params;
  const { busca: buscaParam, grupo: grupoId } = await searchParams;
  const busca = (buscaParam ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: campanha } = await supabase.from("campanhas").select("id, nome, status, imobiliarias_selecionadas").eq("id", id).single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "rascunho") redirect(`/campanhas/${id}`);

  // Base é o cadastro inteiro de imobiliárias, sem filtrar por
  // cadastro_incompleto -- esse campo mede prontidão pra gerar contrato,
  // não tem relação com poder receber e-mail de campanha (antes escondia
  // 497 das 500 imobiliárias por padrão).
  const [{ data: imobiliariasData }, { data: descadastrosData }, { data: gruposData }, { data: grupoAtual }] = await Promise.all([
    supabase.from("imobiliarias").select("id, nome, cnpj, email, email_faturas, email_repasses, email_campanhas").order("nome"),
    supabase.from("campanhas_descadastros").select("email"),
    supabase.from("campanhas_grupos").select("id, nome").order("nome"),
    grupoId ? supabase.from("campanhas_grupos").select("imobiliaria_ids").eq("id", grupoId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const descadastrados = new Set((descadastrosData ?? []).map((d) => d.email.toLowerCase()));
  let imobiliarias = (imobiliariasData ?? []) as ImobiliariaRow[];

  if (busca) {
    const termo = busca.toLowerCase();
    imobiliarias = imobiliarias.filter((i) => i.nome.toLowerCase().includes(termo) || (i.cnpj ?? "").includes(busca));
  }

  const membrosGrupo = grupoAtual?.imobiliaria_ids ? new Set<string>(grupoAtual.imobiliaria_ids as string[]) : null;
  const selecaoSalva = (campanha.imobiliarias_selecionadas as string[] | null) ?? [];
  const jaTemSelecaoSalva = selecaoSalva.length > 0;

  const elegiveis = imobiliarias
    .map((imob) => ({ imob, emails: emailsElegiveisCampanha(imob, descadastrados) }))
    .filter((x) => x.emails.length > 0);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <Link href="/campanhas" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra lista de campanhas
        </Link>

        <PageHeader icon={<IconMail />} titulo={campanha.nome} subtitulo="Passo 2 de 3 — escolher destinatários." />

        <form
          className="flex flex-wrap items-end gap-3 rounded-xl border border-o2-navy/10 bg-quadro p-3 shadow-sm"
          action={`/campanhas/${id}/destinatarios`}
        >
          <div>
            <label className="mb-0.5 block text-xs text-gray-500">Buscar imobiliária</label>
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Nome ou CNPJ..."
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
            />
          </div>
          {!!gruposData?.length && (
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Aplicar grupo salvo</label>
              <select
                name="grupo"
                defaultValue={grupoId ?? ""}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
              >
                <option value="">Nenhum (todas elegíveis)</option>
                {gruposData.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
          >
            Filtrar
          </button>
          <a href="/campanhas/grupos" className="pb-1.5 text-xs font-medium text-o2-navy hover:underline">
            Gerenciar grupos
          </a>
        </form>

        <form action={salvarDestinatarios} className="space-y-3">
          <input type="hidden" name="campanha_id" value={id} />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {elegiveis.length} imobiliária(s) com e-mail disponível
              {membrosGrupo
                ? ` · grupo aplicado pré-marca ${membrosGrupo.size} delas`
                : jaTemSelecaoSalva
                  ? ` · seleção salva anteriormente já está pré-marcada`
                  : ""}
              .
            </p>
            {elegiveis.length > 1 && <SelecionarTodas />}
          </div>

          <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-o2-navy/10 bg-white shadow-sm">
            {elegiveis.map(({ imob, emails }) => (
              <label key={imob.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[#e8f0fe]">
                <input
                  type="checkbox"
                  name="imob"
                  value={imob.id}
                  defaultChecked={membrosGrupo ? membrosGrupo.has(imob.id) : jaTemSelecaoSalva ? selecaoSalva.includes(imob.id) : true}
                />
                <span className="flex-1">
                  <span className="font-medium text-o2-navy">{imob.nome}</span>
                  <span className="ml-2 text-xs text-gray-400">{emails.join(", ")}</span>
                </span>
              </label>
            ))}
            {!elegiveis.length && (
              <p className="px-4 py-8 text-center text-sm text-gray-500">
                Nenhuma imobiliária com e-mail disponível pra esse filtro.
              </p>
            )}
          </div>

          {elegiveis.length > 0 && (
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              >
                Salvar seleção
              </button>
            </div>
          )}
        </form>
      </main>
    </>
  );
}
