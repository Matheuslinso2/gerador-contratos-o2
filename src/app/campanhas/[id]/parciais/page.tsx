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
import {
  PREMIACAO_PADRAO_LINHAS,
  TEXTO_PADRAO_PARCIAL_HTML,
  TOKEN_PANORAMA,
  aplicarPremiacao,
  campanhaComPremiacaoPorCliente,
  montarEmailParcial,
  normalizarTextoParcial,
} from "@/lib/campanhas/parcialCampanha";
import { premiacoesDaCampanha } from "@/lib/campanhas/premiacaoPersonalizada";
import PremiacaoCliente from "./PremiacaoCliente";
import { contagemOportunidades, dataBr, enderecoDaImagem, formatarValor, type DadosPanorama } from "@/lib/campanhas/panoramaCampanha";
import { imobiliariasDaCampanha } from "@/lib/campanhas/imobiliariasDaCampanha";
import { participantesDaCampanha } from "@/lib/campanhas/metasCampanha";
import { ENDERECO_REMETENTE_CAMPANHAS, LINK_DESCADASTRO_MENSAGEM_UNICA, montarHtmlCampanha, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { EditorCorpo } from "../../EditorCorpo";
import { ConfirmarDisparoButton } from "../ConfirmarDisparoButton";
import { atualizarPreviaParciais, descartarParciais, enviarParciais, enviarTesteParciais } from "../parciaisActions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Linha = { id: string; participante_id: string; nome: string; versao: number; token: string; imobiliaria_ids: string[]; dados: DadosPanorama; texto: string | null };

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
    db.from("campanhas_panoramas").select("id, participante_id, nome, versao, token, imobiliaria_ids, dados, texto").eq("campanha_id", id).eq("lote_id", lote).eq("status", "previa"),
  ]);
  if (!campanha) redirect("/campanhas");
  const linhas = ((linhasBrutas ?? []) as Linha[]).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (!linhas.length) redirect(`/campanhas/${id}?erro=${encodeURIComponent("Essa prévia de parciais não está mais aberta. Gere de novo.")}#producao`);

  const idsImobs = linhas.flatMap((l) => l.imobiliaria_ids);
  const { data: cards } = await db.from("campanhas_cards_bitrix").select("imobiliaria_id").eq("campanha_id", id).in("imobiliaria_id", idsImobs);
  const comCard = new Set(((cards ?? []) as { imobiliaria_id: string }[]).map((c) => c.imobiliaria_id));
  // Participantes SEM meta ficam fora da parcial, mas aparecem na conferência (dropdown) para consulta.
  const { data: campanhaCompleta } = await db.from("campanhas").select("*").eq("id", id).single();
  const idsCampanha = campanhaCompleta ? await imobiliariasDaCampanha(db, campanhaCompleta as never) : [];
  const { participantes } = await participantesDaCampanha(db, id, idsCampanha);
  const semMeta = participantes.filter((p) => !(Number(p.meta) > 0));
  const nomeSemMeta = new Map<string, string>();
  const idsImobSemMeta = semMeta.map((p) => p.imobiliaria_id).filter((x): x is string => !!x);
  const idsGrupoSemMeta = semMeta.map((p) => p.grupo_id).filter((x): x is string => !!x);
  if (idsImobSemMeta.length) {
    const { data } = await db.from("imobiliarias").select("id, nome, apelido").in("id", idsImobSemMeta);
    for (const i of (data ?? []) as { id: string; nome: string; apelido: string | null }[]) nomeSemMeta.set(i.id, i.apelido || i.nome);
  }
  if (idsGrupoSemMeta.length) {
    const { data } = await db.from("imobiliaria_grupos").select("id, nome").in("id", idsGrupoSemMeta);
    for (const g of (data ?? []) as { id: string; nome: string }[]) nomeSemMeta.set(g.id, `${g.nome} (grupo)`);
  }
  const posicao = linhas[0].dados.posicaoEm;
  const textoAtual = normalizarTextoParcial(linhas.find((l) => l.texto)?.texto ?? TEXTO_PADRAO_PARCIAL_HTML);
  // Premiação por cliente (só Campanha Elite): exceção salva na linha de meta do participante.
  const comPremiacaoPorCliente = campanhaComPremiacaoPorCliente(campanha.nome);
  const premiacoes = comPremiacaoPorCliente ? await premiacoesDaCampanha(db, id) : new Map<string, string>();
  const textoSemMarcadorPremiacao = comPremiacaoPorCliente && aplicarPremiacao(textoAtual, null).semMarcador;
  const premiacaoPadraoHtml = PREMIACAO_PADRAO_LINHAS.join("");

  const htmlDoEmail = (l: Linha) => {
    const e = montarEmailParcial(l.dados, textoAtual, enderecoDaImagem(l.token), l.token, premiacoes.get(l.participante_id));
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
    return montarHtmlCampanha(row, LINK_DESCADASTRO_MENSAGEM_UNICA);
  };

  const semMarcador = !textoAtual.includes(TOKEN_PANORAMA);
  const indisponiveis = linhas.filter((l) => l.dados.dadosStatus !== "ok");
  const individuais = linhas.filter((l) => l.dados.periodoIndividual);
  const oportunidadesTotal = linhas.reduce((s, l) => contagemOportunidades(l.dados.oportunidades).cotacoes + s, 0);
  const titulosSolicitadosTotal = linhas.reduce((s, l) => contagemOportunidades(l.dados.oportunidades).titulos + s, 0);
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
              <strong>Premiação.</strong> O texto padrão fala em “Troféu Exclusivo O2 Elite – 2026” e “vídeo de marketing (gravação profissional no escritório sobre a trajetória da imobiliária)”. A premiação cadastrada na campanha é:{" "}
              <em>{campanha.premiacao_descricao ?? "(nenhuma cadastrada)"}</em>.
              {comPremiacaoPorCliente ? " Quem tem premiação própria aparece com a indicação “Premiação personalizada”." : " Há uma só premiação por campanha no Workspace: confira se vale para todos os participantes e ajuste o texto se não valer."}
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
            {comPremiacaoPorCliente && (
              <li>
                <strong>Premiação por cliente.</strong> {premiacoes.size} cliente(s) com premiação personalizada: o bloco entre <code>{"{{premiacao}}"}</code> e <code>{"{{/premiacao}}"}</code> do texto é trocado só para eles; os demais recebem o bloco padrão que está entre os marcadores. O restante do texto é comum a todos.
              </li>
            )}
            {textoSemMarcadorPremiacao && (
              <li className="font-semibold text-red-700">
                O texto perdeu os marcadores <code>{"{{premiacao}}"}</code> e <code>{"{{/premiacao}}"}</code>: as premiações personalizadas NÃO estão sendo aplicadas. Recoloque os marcadores em volta do bloco de premiação antes de enviar.
              </li>
            )}
            <li>
              <strong>Oportunidades</strong> = cotações <em>aprovadas</em> e títulos de Capitalização <em>solicitados</em> (os mesmos de “Títulos solicitados” do painel de Capitalização) ainda não contratados, renovações fora, recebidos desde 2 meses antes do início de cada campanha. Nesta parcial: {oportunidadesTotal} cotação(ões) aprovada(s) e {titulosSolicitadosTotal} título(s) solicitado(s). Não somam na produção: só viram resultado depois da contratação.
            </li>
          </ul>
        </section>

        <details className="rounded-xl border border-gray-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-o2-navy">
            Conferência dos participantes ({linhas.length + semMeta.length})
            <span className="ml-2 text-xs font-normal text-gray-500">
              abra para consultar a lista completa{semMeta.length ? ` · ${semMeta.length} sem meta, fora desta parcial` : ""}
            </span>
          </summary>
          <div className="mt-3 overflow-x-auto">
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
                      premiacoes.has(l.participante_id) ? "premiação personalizada" : null,
                      l.dados.capValorMinimo ? `Capitalização a partir de ${formatarValor(l.dados.capValorMinimo, true)}${l.dados.capForaDoMinimo ? ` (${l.dados.capForaDoMinimo} abaixo, fora)` : ""}` : null,
                      l.dados.dadosStatus !== "ok" ? "dados indisponíveis" : null,
                      l.dados.encerrada ? "campanha encerrada" : null,
                      l.imobiliaria_ids.length > 1 ? `${l.imobiliaria_ids.length} unidades` : null,
                      l.imobiliaria_ids.some((i) => comCard.has(i)) ? null : "sem card no Bitrix",
                      l.dados.oportunidades.some((o) => !o.pretendente) ? "pretendente sem nome" : null,
                      l.dados.oportunidades.some((o) => o.tipo !== "titulo_solicitado" && !o.aprovadaEm) ? "aprovação sem data" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
              {semMeta.map((p) => (
                <tr key={p.id} className="border-b bg-gray-50 last:border-0">
                  <td className="py-1 pr-3 font-medium text-gray-600">{nomeSemMeta.get((p.imobiliaria_id ?? p.grupo_id) as string) ?? "—"}</td>
                  <td className="py-1 pr-3">—</td>
                  <td className="py-1 pr-3 text-right">—</td>
                  <td className="py-1 pr-3 text-right">—</td>
                  <td className="py-1 pr-3 text-right">—</td>
                  <td className="py-1 pr-3 text-right">—</td>
                  <td className="py-1 pr-3 text-right">—</td>
                  <td className="py-1 text-gray-600">sem meta definida: não recebe esta parcial</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-gray-500">* período individual. Produção = novas contratações de Seguro Fiança e Capitalização no período; renovações ficam fora.</p>
          </div>
        </details>

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
                      <p className="text-sm font-semibold text-o2-navy">
                        {l.nome}
                        {premiacoes.has(l.participante_id) && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[11px] font-medium text-amber-800">Premiação personalizada</span>}
                      </p>
                      <p className="text-xs text-gray-500">
                        Parcial nº {l.versao} · campanha de {dataBr(l.dados.inicio)} a {dataBr(l.dados.fim)}
                        {l.dados.periodoIndividual ? " (período individual)" : ""} · {l.imobiliaria_ids.length > 1 ? `${l.imobiliaria_ids.length} unidades` : "1 unidade"} ·{" "}
                        {l.imobiliaria_ids.some((i) => comCard.has(i)) ? "tem card no Bitrix: entra na conversa de e-mail do card" : "sem card no Bitrix: sai sem thread"}
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-1 text-xs text-gray-600">
                      <input type="checkbox" name="excluir" value={l.id} /> não enviar
                    </label>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/campanhas/panorama/${l.token}?interno=1`} alt={`Panorama de ${l.nome}`} className="w-full rounded-lg border border-gray-100" loading="lazy" />
                      <a href={`/api/campanhas/panorama/${l.token}?baixar=1`} className="inline-block text-xs font-medium text-o2-coral hover:underline">
                        Baixar imagem (para enviar também pelo WhatsApp)
                      </a>
                    </div>
                    <details className="rounded-lg border border-gray-200">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-o2-navy">Ver o e-mail como será recebido</summary>
                      <iframe title={`E-mail de ${l.nome}`} srcDoc={htmlDoEmail(l)} sandbox="" loading="lazy" className="h-[760px] w-full rounded-b-lg border-t border-gray-200 bg-white" />
                    </details>
                  </div>
                  {comPremiacaoPorCliente && (
                    <div className="mt-3">
                      <PremiacaoCliente
                        campanhaId={id}
                        participanteId={l.participante_id}
                        nome={l.dados.participante}
                        personalizada={premiacoes.get(l.participante_id) ?? null}
                        padraoHtml={premiacaoPadraoHtml}
                      />
                    </div>
                  )}
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
              mensagemConfirmacao={`Enviar a parcial para as imobiliárias marcadas (${linhas.length} no máximo)? Cada uma recebe só o próprio panorama, em uma mensagem só para todos os endereços dela, dentro da conversa de e-mail do card no Bitrix. Confirma?`}
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
