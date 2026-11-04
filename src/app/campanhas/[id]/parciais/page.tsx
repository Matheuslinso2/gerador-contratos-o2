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
import { TEXTO_PADRAO_PARCIAL_HTML, TOKEN_PANORAMA, montarEmailParcial } from "@/lib/campanhas/parcialCampanha";
import { dataBr, enderecoDaImagem, formatarValor, type DadosPanorama } from "@/lib/campanhas/panoramaCampanha";
import { ENDERECO_REMETENTE_CAMPANHAS, montarHtmlCampanha, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { linkDescadastro } from "@/lib/campanhas/unsubscribeToken";
import { EditorCorpo } from "../../EditorCorpo";
import { ConfirmarDisparoButton } from "../ConfirmarDisparoButton";
import { atualizarPreviaParciais, descartarParciais, enviarParciais, enviarTesteParciais } from "../parciaisActions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Linha = { id: string; nome: string; versao: number; token: string; imobiliaria_ids: string[]; dados: DadosPanorama; texto: string | null };

// Revisão das parciais antes de enviar (30/10/2026; refeita em 03/11/2026): texto
// editável já preenchido, quadro de conferência de TODOS os participantes e a
// prévia individual de cada e-mail exatamente como será recebido. Os números já
// estão fixos na versão do panorama; nada é enviado daqui sem confirmação.
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
    supabase.from("campanhas").select("id, nome, remetente_nome, premiacao_descricao").eq("id", id).maybeSingle(),
    db.from("campanhas_panoramas").select("id, nome, versao, token, imobiliaria_ids, dados, texto").eq("campanha_id", id).eq("lote_id", lote).eq("status", "previa"),
  ]);
  if (!campanha) redirect("/campanhas");
  const linhas = ((linhasBrutas ?? []) as Linha[]).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (!linhas.length) redirect(`/campanhas/${id}?erro=${encodeURIComponent("Essa prévia de parciais não está mais aberta. Gere de novo.")}#producao`);

  const idsImobs = linhas.flatMap((l) => l.imobiliaria_ids);
  const { data: cards } = await db.from("campanhas_cards_bitrix").select("imobiliaria_id").eq("campanha_id", id).in("imobiliaria_id", idsImobs);
  const comCard = new Set(((cards ?? []) as { imobiliaria_id: string }[]).map((c) => c.imobiliaria_id));
  const posicao = linhas[0].dados.posicaoEm;
  const textoAtual = linhas.find((l) => l.texto)?.texto ?? TEXTO_PADRAO_PARCIAL_HTML;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  const htmlDoEmail = (l: Linha) => {
    const e = montarEmailParcial(l.dados, textoAtual, enderecoDaImagem(l.token), l.token);
    const row: CampanhaRow = {
      id,
      assunto: e.assunto,
      template: "comunicado",
      titulo: e.titulo,
      introducao: e.introducao,
      valido_de: l.dados.inicio,
      valido_ate: l.dados.fim,
      corpo_html: e.corpoHtml,
      cta_texto: null,
      cta_href: null,
      personalizacao: "nenhuma",
      remetente_nome: campanha.remetente_nome,
    };
    return montarHtmlCampanha(row, linkDescadastro(user?.email ?? "previa@o2seguros.com.br", siteUrl, id));
  };

  const semMarcador = !textoAtual.includes(TOKEN_PANORAMA);
  const indisponiveis = linhas.filter((l) => l.dados.dadosStatus !== "ok");
  const individuais = linhas.filter((l) => l.dados.periodoIndividual);
  const oportunidadesTotal = linhas.reduce((s, l) => s + l.dados.oportunidades.length, 0);
  const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";
  const num = (l: Linha, n: number | null) => (n === null ? "—" : formatarValor(n, l.dados.moeda));

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-6xl flex-1 space-y-6 p-8">
        <Link href={`/campanhas/${id}#producao`} className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar para a campanha
        </Link>
        <PageHeader icon={<IconMail />} titulo="Enviar parciais" subtitulo={`${campanha.nome} — parcial de ${dataBr(posicao)}`} />

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}

        <p className="rounded-lg border border-o2-navy/10 bg-quadro p-3 text-sm text-o2-navy">
          Os números abaixo já estão <strong>fixos nesta parcial</strong>: o que você vê é exatamente o que cada imobiliária recebe, e fica guardado como uma versão do panorama dela. <strong>Nada foi enviado ainda.</strong>
        </p>

        <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <h2 className="font-semibold">Confira antes de enviar</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Premiação.</strong> O texto sugerido fala em “Troféu Exclusivo O2 Elite – 2026” e “vídeo de marketing (gravação profissional no escritório sobre a trajetória da imobiliária)”. A premiação cadastrada na campanha é:{" "}
              <em>{campanha.premiacao_descricao ?? "(nenhuma cadastrada)"}</em>. Há uma só premiação por campanha no Workspace: não consigo confirmar se Adjuve, Expan e Silvério (campanha de 2 meses) têm a mesma. Ajuste o texto se for diferente.
            </li>
            {individuais.length > 0 && (
              <li>
                <strong>Período individual</strong> (cabeçalho, apuração e dias restantes usam o prazo próprio):{" "}
                {individuais.map((l) => `${l.dados.participante} ${dataBr(l.dados.inicio).slice(0, 5)} a ${dataBr(l.dados.fim).slice(0, 5)}`).join("; ")}.
              </li>
            )}
            {indisponiveis.length > 0 && (
              <li>
                <strong>Produção indisponível</strong> (sem vínculo com a fonte; não aparece como zero):{" "}
                {indisponiveis.map((l) => l.dados.participante).join(", ")}.
              </li>
            )}
            {semMarcador && <li>O texto não tem o marcador do panorama: ele será colocado no fim do e-mail. Use “Inserir panorama” para escolher o lugar.</li>}
            <li>
              <strong>Oportunidades</strong> = cotações <em>aprovadas</em> ainda não contratadas (renovações fora), recebidas desde 2 meses antes do início de cada campanha. Total nesta parcial: {oportunidadesTotal}. Não somam na produção.
            </li>
          </ul>
        </section>

        <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-o2-navy">Conferência de todos os participantes</h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-1 pr-3">Imobiliária</th>
                <th className="py-1 pr-3">Período</th>
                <th className="py-1 pr-3 text-right">Meta 1</th>
                <th className="py-1 pr-3 text-right">Produção (novas)</th>
                <th className="py-1 pr-3 text-right">% da meta</th>
                <th className="py-1 pr-3 text-right">Faltam</th>
                <th className="py-1 pr-3 text-right">Oportunidades</th>
                <th className="py-1">Observação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-1 pr-3 font-medium text-o2-navy">{l.nome}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {dataBr(l.dados.inicio).slice(0, 5)} a {dataBr(l.dados.fim).slice(0, 5)}
                    {l.dados.periodoIndividual ? " *" : ""}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{num(l, l.dados.meta)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{l.dados.dadosStatus === "ok" ? num(l, l.dados.realizado) : "indisponível"}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{l.dados.percentual === null || l.dados.dadosStatus !== "ok" ? "—" : `${Math.round(l.dados.percentual)}%`}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{l.dados.dadosStatus === "ok" ? num(l, l.dados.faltam) : "—"}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{l.dados.oportunidades.length}</td>
                  <td className="py-1 text-gray-600">
                    {[
                      l.dados.dadosStatus !== "ok" ? "dados indisponíveis" : null,
                      l.dados.encerrada ? "campanha encerrada" : null,
                      l.imobiliaria_ids.length > 1 ? `${l.imobiliaria_ids.length} unidades` : null,
                      l.imobiliaria_ids.some((i) => comCard.has(i)) ? null : "sem card no Bitrix",
                      l.dados.oportunidades.some((o) => !o.pretendente) ? "pretendente sem nome" : null,
                      l.dados.oportunidades.some((o) => !o.aprovadaEm) ? "aprovação sem data" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-gray-500">* período individual. Produção = novas contratações de Seguro Fiança e Capitalização no período; renovações ficam fora.</p>
        </section>

        <form action={enviarParciais.bind(null, id, lote)} className="space-y-5 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Texto do e-mail (editável: negrito, cor da fonte, botões e o lugar do panorama)</label>
            <EditorCorpo
              name="texto"
              corpoInicialHtml={textoAtual}
              tokens={[{ rotulo: "Inserir panorama", valor: TOKEN_PANORAMA, dica: "Marca o lugar onde entra a imagem do panorama de cada imobiliária" }]}
            />
            <p className="mt-1 text-xs text-gray-500">
              Campos que cada imobiliária recebe preenchidos: <code>{"{nome}"}</code>, <code>{"{campanha}"}</code> e <code>{"{data}"}</code>. Trechos entre <code>**asteriscos**</code> viram negrito. Depois de editar, clique em “Salvar texto e atualizar prévias”.
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
            <div className="space-y-4">
              {linhas.map((l) => (
                <div key={l.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-o2-navy">{l.nome}</p>
                      <p className="text-xs text-gray-500">
                        Parcial nº {l.versao} · campanha de {dataBr(l.dados.inicio)} a {dataBr(l.dados.fim)}
                        {l.dados.periodoIndividual ? " (período individual)" : ""} · {l.imobiliaria_ids.length > 1 ? `${l.imobiliaria_ids.length} unidades` : "1 unidade"} ·{" "}
                        {l.imobiliaria_ids.some((i) => comCard.has(i)) ? "tem card no Bitrix (recebe comentário)" : "sem card no Bitrix"}
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-1 text-xs text-gray-600">
                      <input type="checkbox" name="excluir" value={l.id} /> não enviar
                    </label>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/campanhas/panorama/${l.token}?interno=1`} alt={`Panorama de ${l.nome}`} className="w-full rounded-lg border border-gray-100" loading="lazy" />
                    <details className="rounded-lg border border-gray-200">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-o2-navy">Ver o e-mail como será recebido</summary>
                      <iframe title={`E-mail de ${l.nome}`} srcDoc={htmlDoEmail(l)} sandbox="" loading="lazy" className="h-[760px] w-full rounded-b-lg border-t border-gray-200 bg-white" />
                    </details>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-500">Remetente de envio: {ENDERECO_REMETENTE_CAMPANHAS}. As prévias acima só mudam depois de “Salvar texto e atualizar prévias”.</p>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <button
              type="submit"
              formAction={atualizarPreviaParciais.bind(null, id, lote)}
              className="rounded-full border border-o2-navy/30 px-5 py-2 text-sm font-medium text-o2-navy transition hover:bg-white"
            >
              Salvar texto e atualizar prévias
            </button>
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
