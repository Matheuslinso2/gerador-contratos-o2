import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconMail } from "@/components/icons";
import { buscarTemplateAviso } from "@/lib/avisosInternos/templates";
import { montarHtmlAvisoInterno } from "@/lib/avisosInternos/email";
import { enviarAvisoInterno } from "./actions";

export const dynamic = "force-dynamic";

export default async function RevisarAvisoInternoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { template: templateId, mensagem, erro, ...valores } = params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const template = templateId ? buscarTemplateAviso(templateId) : undefined;
  if (!template) redirect("/campanhas/avisos-internos");

  const camposFaltando = template.campos.filter((c) => c.obrigatorio && !(valores[c.key] ?? "").trim());
  if (camposFaltando.length) {
    redirect(`/campanhas/avisos-internos/novo?template=${template.id}&erro=${encodeURIComponent("Preencha todos os campos obrigatórios.")}`);
  }

  const valoresLimpos: Record<string, string> = Object.fromEntries(template.campos.map((c) => [c.key, (valores[c.key] ?? "").trim()]));
  const mensagemLimpa = (mensagem ?? "").trim();

  const { data: grupo } = await supabase
    .from("avisos_internos_grupos")
    .select("nome, emails")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const emails = (grupo?.emails as string[] | null) ?? [];

  const assunto = template.montarAssunto(valoresLimpos);
  const htmlPreview = montarHtmlAvisoInterno(template, valoresLimpos, mensagemLimpa);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <Link href={`/campanhas/avisos-internos/novo?template=${template.id}`} className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra editar
        </Link>

        <PageHeader icon={<IconMail />} titulo={template.nome} subtitulo="Revisar e enviar." />

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <p className="text-sm text-gray-600">
          Vai pra <strong>{emails.length}</strong> e-mail(s) do grupo <strong>{grupo?.nome ?? "avisos internos"}</strong>.
        </p>

        <div className="overflow-hidden rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
          <p className="border-b border-o2-navy/10 bg-quadro px-4 py-2 text-xs font-medium uppercase tracking-wide text-o2-navy">Assunto: {assunto}</p>
          <div className="max-h-[480px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: htmlPreview }} />
        </div>

        <div className="flex justify-end rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <form action={enviarAvisoInterno}>
            <input type="hidden" name="template" value={template.id} />
            <input type="hidden" name="mensagem" value={mensagemLimpa} />
            {template.campos.map((c) => (
              <input key={c.key} type="hidden" name={c.key} value={valoresLimpos[c.key]} />
            ))}
            <SubmitButton
              className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              textoCarregando="Enviando..."
            >
              Confirmar e enviar
            </SubmitButton>
          </form>
        </div>
      </main>
    </>
  );
}
