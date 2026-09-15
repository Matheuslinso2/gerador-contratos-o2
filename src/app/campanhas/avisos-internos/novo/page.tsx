import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { buscarTemplateAviso } from "@/lib/avisosInternos/templates";

export const dynamic = "force-dynamic";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

export default async function NovoAvisoInternoPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; erro?: string }>;
}) {
  const { template: templateId, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const template = templateId ? buscarTemplateAviso(templateId) : undefined;
  if (!template) redirect("/campanhas/avisos-internos");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <Link href="/campanhas/avisos-internos" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pros modelos
        </Link>

        <PageHeader icon={<IconMail />} titulo={template.nome} subtitulo="Preencha os campos e revise antes de enviar pra equipe." />

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <form method="get" action="/campanhas/avisos-internos/revisar" className="space-y-4 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
          <input type="hidden" name="template" value={template.id} />

          {template.campos.map((campo) => (
            <div key={campo.key}>
              <label className="mb-1 block text-xs font-medium text-gray-600">{campo.label}</label>
              <input
                name={campo.key}
                type={campo.tipo}
                required={campo.obrigatorio}
                placeholder={campo.placeholder}
                className={inputClass}
              />
            </div>
          ))}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Recado adicional (opcional)</label>
            <textarea name="mensagem" rows={4} placeholder="Um texto livre, se quiser complementar o aviso." className={inputClass} />
          </div>

          <div className="flex justify-end">
            <button type="submit" className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90">
              Revisar aviso
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
