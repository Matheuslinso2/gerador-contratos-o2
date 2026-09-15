import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconMail } from "@/components/icons";
import { PRODUTOS_CAMPANHA } from "@/lib/campanhas/produtos";
import { EditorCorpo } from "../EditorCorpo";
import { criarCampanha } from "./actions";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

export default async function NovaCampanhaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <Link href="/campanhas" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra lista de campanhas
        </Link>

        <PageHeader icon={<IconMail />} titulo="Nova campanha" subtitulo="Passo 1 de 2 — conteúdo do e-mail." />

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <form action={criarCampanha} className="space-y-4 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nome interno da campanha</label>
            <input name="nome" required placeholder="Ex: Divulgação Seguro Fiança" className={inputClass} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Válido de (opcional)</label>
              <input name="valido_de" type="date" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Válido até (opcional)</label>
              <input name="valido_ate" type="date" className={inputClass} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-gray-400">O período aparece destacado no e-mail, separado do texto do corpo.</p>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Produto</label>
            <select name="produto" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Selecione o produto desta campanha...
              </option>
              {PRODUTOS_CAMPANHA.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Modelo</label>
            <select name="template" defaultValue="comunicado" className={inputClass}>
              <option value="comunicado">Comunicado geral</option>
              <option value="promocao">Promoção / oferta</option>
              <option value="newsletter">Newsletter</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Assunto do e-mail</label>
            <input name="assunto" required placeholder="O que a imobiliária vai ver na caixa de entrada" className={inputClass} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Título (destaque dentro do e-mail)</label>
            <input name="titulo" required className={inputClass} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Introdução (opcional)</label>
            <input name="introducao" placeholder="Uma linha de contexto logo abaixo do título" className={inputClass} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Corpo do e-mail</label>
            <EditorCorpo name="corpo_html" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Texto do botão (opcional)</label>
              <input name="cta_texto" placeholder="Ex: Saiba mais" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Link do botão (opcional)</label>
              <input name="cta_href" type="url" placeholder="https://..." className={inputClass} />
            </div>
          </div>

          <div className="flex justify-end">
            <SubmitButton
              className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              textoCarregando="Salvando..."
            >
              Continuar — escolher destinatários
            </SubmitButton>
          </div>
        </form>
      </main>
    </>
  );
}
