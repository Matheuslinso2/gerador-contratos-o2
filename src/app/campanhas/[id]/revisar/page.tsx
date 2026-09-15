import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconMail } from "@/components/icons";
import { separarEmails } from "@/lib/email";
import { montarHtmlCampanha, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { enviarTesteCampanha, confirmarDisparoCampanha } from "./actions";
import { ConfirmarDisparoButton } from "./ConfirmarDisparoButton";

export const dynamic = "force-dynamic";

// Prévia obrigatória antes de qualquer disparo de verdade -- mostra o HTML
// final (com o rodapé de descadastro) e a contagem exata de e-mails
// individuais que vão receber, nunca só a contagem de imobiliárias.
export default async function RevisarCampanhaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ imob?: string | string[]; ok?: string; erro?: string }>;
}) {
  const { id } = await params;
  const { imob, ok, erro } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const imobiliariaIds = Array.isArray(imob) ? imob : imob ? [imob] : [];
  if (!imobiliariaIds.length) redirect(`/campanhas/${id}/destinatarios`);

  const { data: campanha } = await supabase
    .from("campanhas")
    .select("id, nome, assunto, template, titulo, introducao, corpo_html, cta_texto, cta_href, status")
    .eq("id", id)
    .single();
  if (!campanha) redirect("/campanhas");
  if (campanha.status !== "rascunho") redirect(`/campanhas/${id}`);

  const [{ data: imobiliariasData }, { data: descadastrosData }] = await Promise.all([
    supabase.from("imobiliarias").select("id, nome, email, email_faturas").in("id", imobiliariaIds),
    supabase.from("campanhas_descadastros").select("email"),
  ]);
  const descadastrados = new Set((descadastrosData ?? []).map((d) => d.email.toLowerCase()));

  const linhas = (imobiliariasData ?? []).map((i) => {
    const principais = separarEmails(i.email);
    const brutos = principais.length ? principais : separarEmails(i.email_faturas);
    const emails = brutos.filter((e) => !descadastrados.has(e.trim().toLowerCase()));
    return { id: i.id, nome: i.nome, emails };
  });
  const totalEmails = new Set(linhas.flatMap((l) => l.emails.map((e) => e.trim().toLowerCase()))).size;

  const htmlPreview = montarHtmlCampanha(campanha as CampanhaRow, "#");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <PageHeader icon={<IconMail />} titulo={campanha.nome} subtitulo="Passo 3 de 3 — revisar e disparar." />

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <p className="text-sm text-gray-600">
          <strong>{linhas.length}</strong> imobiliária(s) selecionada(s) · <strong>{totalEmails}</strong> e-mail(s)
          individuais vão receber esta campanha.
        </p>

        <div className="overflow-hidden rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
          <p className="border-b border-o2-navy/10 bg-quadro px-4 py-2 text-xs font-medium uppercase tracking-wide text-o2-navy">
            Prévia do e-mail
          </p>
          <div className="max-h-[480px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: htmlPreview }} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <form action={enviarTesteCampanha}>
            <input type="hidden" name="campanha_id" value={id} />
            {imobiliariaIds.map((i) => (
              <input key={i} type="hidden" name="imob" value={i} />
            ))}
            <SubmitButton
              className="rounded-full border border-o2-navy px-5 py-2 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
              textoCarregando="Enviando teste..."
            >
              Enviar e-mail de teste pra mim
            </SubmitButton>
          </form>

          <form action={confirmarDisparoCampanha}>
            <input type="hidden" name="campanha_id" value={id} />
            {imobiliariaIds.map((i) => (
              <input key={i} type="hidden" name="imob" value={i} />
            ))}
            <ConfirmarDisparoButton
              className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              textoCarregando="Disparando..."
              mensagemConfirmacao={`Confirmar disparo pra ${totalEmails} e-mail(s)? Não dá pra desfazer depois de iniciado.`}
            >
              Confirmar e disparar
            </ConfirmarDisparoButton>
          </form>
        </div>
      </main>
    </>
  );
}
