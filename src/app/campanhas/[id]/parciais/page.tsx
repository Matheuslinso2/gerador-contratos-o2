import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconMail } from "@/components/icons";
import { TEXTO_PADRAO_PARCIAL } from "@/lib/campanhas/parcialCampanha";
import { dataBr, type DadosPanorama } from "@/lib/campanhas/panoramaCampanha";
import { ConfirmarDisparoButton } from "../ConfirmarDisparoButton";
import { descartarParciais, enviarParciais, enviarTesteParciais } from "../parciaisActions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Linha = { id: string; nome: string; versao: number; token: string; imobiliaria_ids: string[]; dados: DadosPanorama };

// Revisão das parciais antes de enviar (30/10/2026): texto, imagem do panorama de
// cada imobiliária (os números já estão fixos na versão) e quem recebe.
export default async function ParciaisPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lote?: string; erro?: string; ok?: string }> }) {
  const { id } = await params;
  const { lote, erro, ok } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");
  if (!lote) redirect(`/campanhas/${id}`);

  const db = createServiceClient();
  const [{ data: campanha }, { data: linhasBrutas }] = await Promise.all([
    supabase.from("campanhas").select("id, nome, remetente_nome").eq("id", id).maybeSingle(),
    db.from("campanhas_panoramas").select("id, nome, versao, token, imobiliaria_ids, dados").eq("campanha_id", id).eq("lote_id", lote).eq("status", "previa"),
  ]);
  if (!campanha) redirect("/campanhas");
  const linhas = ((linhasBrutas ?? []) as Linha[]).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (!linhas.length) redirect(`/campanhas/${id}?erro=${encodeURIComponent("Essa prévia de parciais não está mais aberta. Gere de novo.")}#producao`);

  const idsImobs = linhas.flatMap((l) => l.imobiliaria_ids);
  const { data: cards } = await db.from("campanhas_cards_bitrix").select("imobiliaria_id").eq("campanha_id", id).in("imobiliaria_id", idsImobs);
  const comCard = new Set(((cards ?? []) as { imobiliaria_id: string }[]).map((c) => c.imobiliaria_id));
  const posicao = linhas[0].dados.posicaoEm;

  const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-6xl flex-1 space-y-6 p-8">
        <Link href={`/campanhas/${id}#producao`} className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar para a campanha
        </Link>
        <PageHeader icon={<IconMail />} titulo="Enviar parciais" subtitulo={`${campanha.nome} — posição em ${dataBr(posicao)}`} />

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}

        <p className="rounded-lg border border-o2-navy/10 bg-quadro p-3 text-sm text-o2-navy">
          Os números abaixo já estão <strong>fixos nesta parcial</strong>: o que você vê é exatamente o que cada imobiliária recebe, e fica guardado como uma versão do panorama dela. Nada foi enviado ainda.
        </p>

        <form action={enviarParciais.bind(null, id, lote)} className="space-y-5 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Texto do e-mail (a imagem do panorama vai logo abaixo dele)</label>
            <textarea name="texto" rows={8} defaultValue={TEXTO_PADRAO_PARCIAL} className={inputClass} />
            <p className="mt-1 text-xs text-gray-500">
              Use <code>{"{nome}"}</code> para o nome da imobiliária, <code>{"{campanha}"}</code> para a campanha e <code>{"{data}"}</code> para a data da posição. Linha em branco separa os parágrafos.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Remetente (nome, opcional)</label>
              <input name="remetente_nome" maxLength={40} defaultValue={campanha.remetente_nome ?? ""} placeholder="Ex: Lívia" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Agendar o envio (opcional — vazio = enviar agora)</label>
              <input name="agendado_para" type="datetime-local" className={inputClass} />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-o2-navy">{linhas.length} imobiliária(s) nesta parcial</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {linhas.map((l) => (
                <div key={l.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-o2-navy">{l.nome}</p>
                      <p className="text-xs text-gray-500">
                        Parcial nº {l.versao} · {l.imobiliaria_ids.length > 1 ? `${l.imobiliaria_ids.length} unidades` : "1 unidade"} ·{" "}
                        {l.imobiliaria_ids.some((i) => comCard.has(i)) ? "tem card no Bitrix (recebe comentário)" : "sem card no Bitrix"}
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-1 text-xs text-gray-600">
                      <input type="checkbox" name="excluir" value={l.id} /> não enviar
                    </label>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/campanhas/panorama/${l.token}`} alt={`Panorama de ${l.nome}`} className="w-full rounded-lg border border-gray-100" loading="lazy" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <button
              type="submit"
              formAction={enviarTesteParciais.bind(null, id, lote)}
              className="rounded-full border border-o2-navy/30 px-5 py-2 text-sm font-medium text-o2-navy transition hover:bg-white"
            >
              Enviar teste para mim
            </button>
            <ConfirmarDisparoButton
              mensagemConfirmacao={`Enviar a parcial para as imobiliárias marcadas (${linhas.length} no máximo)? Cada uma recebe só o próprio panorama, e os cards do Bitrix recebem um comentário. Confirma?`}
              textoCarregando="Enviando..."
              className="rounded-full bg-o2-coral px-6 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Enviar parciais
            </ConfirmarDisparoButton>
          </div>
        </form>

        <form action={descartarParciais.bind(null, id, lote)}>
          <SubmitButton className="text-sm text-gray-500 underline hover:text-red-600" textoCarregando="Descartando...">
            Descartar esta prévia (nada é enviado)
          </SubmitButton>
        </form>
      </main>
    </>
  );
}
