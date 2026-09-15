import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { separarEmails } from "@/lib/email";
import { SelecionarTodas } from "./Selecionar";

export const dynamic = "force-dynamic";

type ImobiliariaRow = {
  id: string;
  nome: string;
  cnpj: string | null;
  cadastro_incompleto: boolean | null;
  email: string | null;
  email_faturas: string[] | null;
};

// Resolve os e-mails "utilizáveis" de uma imobiliária pra campanha: `email`
// (contato geral) como principal, `email_faturas` só como reserva se aquele
// estiver vazio (decisão confirmada com o Matheus) -- e sempre removendo
// quem já está em campanhas_descadastros (opt-out global).
function emailsElegiveis(i: ImobiliariaRow, descadastrados: Set<string>): string[] {
  const principais = separarEmails(i.email);
  const brutos = principais.length ? principais : separarEmails(i.email_faturas);
  return brutos.filter((e) => !descadastrados.has(e.toLowerCase()));
}

export default async function DestinatariosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ busca?: string; incompletos?: string }>;
}) {
  const { id } = await params;
  const { busca: buscaParam, incompletos } = await searchParams;
  const busca = (buscaParam ?? "").trim();
  const incluirIncompletos = incompletos === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: campanha } = await supabase.from("campanhas").select("id, nome, status").eq("id", id).single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "rascunho") redirect(`/campanhas/${id}`);

  let query = supabase
    .from("imobiliarias")
    .select("id, nome, cnpj, cadastro_incompleto, email, email_faturas")
    .order("nome");
  if (!incluirIncompletos) query = query.eq("cadastro_incompleto", false);

  const [{ data: imobiliariasData }, { data: descadastrosData }] = await Promise.all([
    query,
    supabase.from("campanhas_descadastros").select("email"),
  ]);

  const descadastrados = new Set((descadastrosData ?? []).map((d) => d.email.toLowerCase()));
  let imobiliarias = (imobiliariasData ?? []) as ImobiliariaRow[];

  if (busca) {
    const termo = busca.toLowerCase();
    imobiliarias = imobiliarias.filter((i) => i.nome.toLowerCase().includes(termo) || (i.cnpj ?? "").includes(busca));
  }

  const elegiveis = imobiliarias
    .map((imob) => ({ imob, emails: emailsElegiveis(imob, descadastrados) }))
    .filter((x) => x.emails.length > 0);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
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
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-gray-600">
            <input type="checkbox" name="incompletos" value="1" defaultChecked={incluirIncompletos} />
            Incluir cadastros incompletos
          </label>
          <button
            type="submit"
            className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
          >
            Filtrar
          </button>
        </form>

        <form method="get" action={`/campanhas/${id}/revisar`} className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">{elegiveis.length} imobiliária(s) com e-mail disponível.</p>
            {elegiveis.length > 1 && <SelecionarTodas />}
          </div>

          <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-o2-navy/10 bg-white shadow-sm">
            {elegiveis.map(({ imob, emails }) => (
              <label key={imob.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[#e8f0fe]">
                <input type="checkbox" name="imob" value={imob.id} defaultChecked />
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
                Continuar — revisar
              </button>
            </div>
          )}
        </form>
      </main>
    </>
  );
}
