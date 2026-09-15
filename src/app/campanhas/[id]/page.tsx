import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import ExportarQuadro from "@/components/ExportarQuadro";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { rotuloProdutoCampanha } from "@/lib/campanhas/produtos";
import { montarHtmlCampanha, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { emailsElegiveisCampanha } from "@/lib/campanhas/elegibilidade";
import SubmitButton from "@/components/SubmitButton";
import { CampanhaProgresso } from "./CampanhaProgresso";
import { salvarLinhaProducao, removerLinhaProducao } from "./producao/actions";
import { GerenciarDestinatarios } from "./GerenciarDestinatarios";
import { duplicarCampanha } from "../actions";
import { cancelarAgendamentoCampanha } from "./actions";

export const dynamic = "force-dynamic";

const ROTULO_TEMPLATE: Record<string, string> = {
  comunicado: "Comunicado geral",
  promocao: "Promoção / oferta",
  newsletter: "Newsletter",
};

const numInputClass = "w-full rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm focus:border-o2-coral focus:outline-none";

function formatarDataBr(data: string) {
  return new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatarMoeda(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type LinhaQuadro = {
  linhaId: string | null; // null = imobiliária impactada mas ainda sem produção lançada
  imobiliariaId: string;
  imobiliariaNome: string;
  quantidade_apolices: number;
  premio_liquido: number;
  comissao_gerada: number;
  repasse_gerado: number;
};

export default async function CampanhaDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { erro, ok } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: campanha } = await supabase.from("campanhas").select("*").eq("id", id).single();
  if (!campanha) redirect("/campanhas");
  const rascunho = campanha.status === "rascunho";
  // Item 9 da reunião de 15/09/2026: campanha agendada não é rascunho (não
  // dá mais pra editar destinatários) nem já foi enviada (não tem
  // resumo/produção ainda) -- é um terceiro estado, com sua própria seção
  // (nome/data do agendamento + botão de cancelar, que volta pra rascunho).
  const agendada = campanha.status === "agendada";
  const jaEnviadaOuEnviando = campanha.status === "enviando" || campanha.status === "concluida";

  // Lógica invertida (pedido da reunião de 15/09/2026): campanha em
  // rascunho fica nesta mesma tela -- a seleção de destinatários vira uma
  // etapa salva aqui dentro, e o botão de disparo só aparece depois dela
  // existir. Antes, criar a campanha já jogava direto pro fluxo de envio.
  //
  // Só duas telas no total (pedido do Matheus, 15/09/2026): a tela de
  // criação e esta aqui -- toda a gestão de destinatários (grupos e
  // imobiliárias avulsas) acontece nesta mesma tela, sem navegar pra
  // lugar nenhum. GerenciarDestinatarios é client component: cada
  // adicionar/excluir grava na hora via server action chamada direto (sem
  // <form>/redirect), sem recarregar a página -- e por isso não perde de
  // vista quem já tinha sido selecionado antes ao filtrar (bug real da
  // versão anterior, que só submetia os checkboxes visíveis no filtro).
  const idsSelecionados = rascunho ? ((campanha.imobiliarias_selecionadas as string[] | null) ?? []) : [];
  const contatosExternosIdsSelecionados = rascunho ? ((campanha.contatos_externos_selecionados as string[] | null) ?? []) : [];
  const [
    { data: todasImobiliariasData },
    { data: gruposData },
    { data: contatosGruposData },
    { data: descadastrosData },
    { data: contatosExternosSelecionadosData },
  ] = await Promise.all([
    rascunho
      ? supabase.from("imobiliarias").select("id, nome, email, email_faturas, email_repasses, email_campanhas").order("nome")
      : Promise.resolve({ data: [] }),
    rascunho ? supabase.from("campanhas_grupos").select("id, nome, imobiliaria_ids").order("nome") : Promise.resolve({ data: [] }),
    rascunho ? supabase.from("campanhas_grupos_contatos").select("id, grupo_id, nome, email") : Promise.resolve({ data: [] }),
    rascunho ? supabase.from("campanhas_descadastros").select("email") : Promise.resolve({ data: [] }),
    contatosExternosIdsSelecionados.length
      ? supabase.from("campanhas_grupos_contatos").select("id, nome, email").in("id", contatosExternosIdsSelecionados)
      : Promise.resolve({ data: [] }),
  ]);

  const descadastrados = new Set((descadastrosData ?? []).map((d) => d.email.toLowerCase()));
  const imobiliariasParaCliente = (todasImobiliariasData ?? []).map((i) => ({
    id: i.id,
    nome: i.nome,
    emails: emailsElegiveisCampanha(i, descadastrados),
  }));
  const contatosPorGrupo = new Map<string, { id: string; nome: string; email: string }[]>();
  for (const c of contatosGruposData ?? []) {
    if (descadastrados.has(c.email.trim().toLowerCase())) continue;
    const lista = contatosPorGrupo.get(c.grupo_id) ?? [];
    lista.push({ id: c.id, nome: c.nome, email: c.email });
    contatosPorGrupo.set(c.grupo_id, lista);
  }
  const gruposParaCliente = (gruposData ?? []).map((g) => ({
    id: g.id,
    nome: g.nome,
    imobiliariaIds: (g.imobiliaria_ids as string[] | null) ?? [],
    contatos: contatosPorGrupo.get(g.id) ?? [],
  }));

  // Só pra exibição -- agendada é somente-leitura (cancelar volta pra
  // rascunho, onde dá pra editar a seleção de novo).
  const idsSelecionadosAgendada = agendada ? ((campanha.imobiliarias_selecionadas as string[] | null) ?? []) : [];
  const contatosIdsSelecionadosAgendada = agendada ? ((campanha.contatos_externos_selecionados as string[] | null) ?? []) : [];
  const [{ data: nomesImobiliariasAgendada }, { data: nomesContatosAgendada }] = await Promise.all([
    idsSelecionadosAgendada.length
      ? supabase.from("imobiliarias").select("id, nome").in("id", idsSelecionadosAgendada)
      : Promise.resolve({ data: [] }),
    contatosIdsSelecionadosAgendada.length
      ? supabase.from("campanhas_grupos_contatos").select("id, nome").in("id", contatosIdsSelecionadosAgendada)
      : Promise.resolve({ data: [] }),
  ]);
  const totalSelecionadosAgendada = idsSelecionadosAgendada.length + contatosIdsSelecionadosAgendada.length;
  const nomesSelecionadosAgendada = [...(nomesImobiliariasAgendada ?? []), ...(nomesContatosAgendada ?? [])].map((i) => i.nome);

  const percentualEnviado = campanha.total_destinatarios
    ? Math.round(((campanha.total_enviados + campanha.total_falhas) / campanha.total_destinatarios) * 100)
    : 0;

  const [{ data: enviosData }, { data: producaoData }, { count: totalAbertos }, { count: totalCliques }, { count: totalDescadastros }] =
    await Promise.all([
      supabase.from("campanhas_envios").select("imobiliaria_id").eq("campanha_id", id).not("imobiliaria_id", "is", null),
      supabase.from("campanhas_producao").select("id, imobiliaria_id, quantidade_apolices, premio_liquido, comissao_gerada, repasse_gerado").eq("campanha_id", id),
      supabase.from("campanhas_envios").select("id", { count: "exact", head: true }).eq("campanha_id", id).not("aberto_em", "is", null),
      supabase.from("campanhas_envios").select("id", { count: "exact", head: true }).eq("campanha_id", id).not("clicado_em", "is", null),
      supabase.from("campanhas_descadastros").select("id", { count: "exact", head: true }).eq("origem_campanha_id", id),
    ]);

  const idsImpactados = [...new Set((enviosData ?? []).map((e) => e.imobiliaria_id as string))];
  const { data: imobiliariasImpactadas } = idsImpactados.length
    ? await supabase.from("imobiliarias").select("id, nome").in("id", idsImpactados).order("nome")
    : { data: [] };

  const producaoPorImobiliaria = new Map((producaoData ?? []).map((p) => [p.imobiliaria_id as string, p]));

  // A tela já traz toda imobiliária impactada como linha -- tenha ou não
  // produção lançada ainda (zerada até o comercial preencher e salvar).
  const linhasQuadro: LinhaQuadro[] = (imobiliariasImpactadas ?? []).map((imob) => {
    const p = producaoPorImobiliaria.get(imob.id);
    return {
      linhaId: p?.id ?? null,
      imobiliariaId: imob.id,
      imobiliariaNome: imob.nome,
      quantidade_apolices: p?.quantidade_apolices ?? 0,
      premio_liquido: p?.premio_liquido ?? 0,
      comissao_gerada: p?.comissao_gerada ?? 0,
      repasse_gerado: p?.repasse_gerado ?? 0,
    };
  });

  const rotuloProduto = rotuloProdutoCampanha(campanha.produto);

  const totaisProducao = linhasQuadro.reduce(
    (acc, l) => ({
      apolices: acc.apolices + l.quantidade_apolices,
      premio: acc.premio + l.premio_liquido,
      comissao: acc.comissao + l.comissao_gerada,
      repasse: acc.repasse + l.repasse_gerado,
    }),
    { apolices: 0, premio: 0, comissao: 0, repasse: 0 }
  );

  const dadosExcelProducao = linhasQuadro.map((l) => ({
    Imobiliária: l.imobiliariaNome,
    Produto: rotuloProduto,
    "Qtde. apólices": l.quantidade_apolices,
    "Prêmio líquido": l.premio_liquido,
    "Comissão gerada": l.comissao_gerada,
    "Repasse gerado": l.repasse_gerado,
    Resultado: l.comissao_gerada - l.repasse_gerado,
  }));

  const htmlEmail = montarHtmlCampanha(campanha as CampanhaRow, "#");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-5xl flex-1 space-y-8 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader icon={<IconMail />} titulo={campanha.nome} subtitulo={campanha.assunto} />
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap rounded-full bg-o2-navy/10 px-2.5 py-1 text-xs font-medium text-o2-navy">{rotuloProduto}</span>
            <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${COR_STATUS_CAMPANHA[campanha.status] ?? "bg-gray-100 text-gray-600"}`}>
              {ROTULO_STATUS_CAMPANHA[campanha.status] ?? campanha.status}
            </span>
            <form action={duplicarCampanha}>
              <input type="hidden" name="campanha_id" value={id} />
              <button
                type="submit"
                className="whitespace-nowrap rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
              >
                Duplicar campanha
              </button>
            </form>
          </div>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}

        {(campanha.valido_de || campanha.valido_ate) && (
          <p className="-mt-4 text-xs font-medium text-o2-coral">
            {campanha.valido_de && campanha.valido_ate
              ? `Válida de ${formatarDataBr(campanha.valido_de)} até ${formatarDataBr(campanha.valido_ate)}`
              : campanha.valido_ate
                ? `Válida até ${formatarDataBr(campanha.valido_ate)}`
                : `Válida a partir de ${formatarDataBr(campanha.valido_de)}`}
          </p>
        )}

        <CampanhaProgresso campanhaId={id} status={campanha.status} />

        {rascunho && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-o2-navy">Destinatários</h2>

            <GerenciarDestinatarios
              campanhaId={id}
              imobiliarias={imobiliariasParaCliente}
              idsSelecionadosIniciais={idsSelecionados}
              grupos={gruposParaCliente}
              contatosSelecionadosIniciais={(contatosExternosSelecionadosData ?? []).map((c) => ({ id: c.id, nome: c.nome, email: c.email }))}
            />
          </section>
        )}

        {agendada && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-o2-navy">Agendamento</h2>
            <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Disparo agendado pra{" "}
              <strong>
                {campanha.agendado_para &&
                  new Date(campanha.agendado_para).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
              </strong>
              . <strong>{totalSelecionadosAgendada}</strong> destinatário(s): {nomesSelecionadosAgendada.join(", ")}
            </p>
            <form action={cancelarAgendamentoCampanha}>
              <input type="hidden" name="campanha_id" value={id} />
              <SubmitButton
                className="rounded-full border border-red-300 px-5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                textoCarregando="Cancelando..."
              >
                Cancelar agendamento
              </SubmitButton>
            </form>
          </section>
        )}

        {/* Resumo geral do disparo */}
        {jaEnviadaOuEnviando && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-o2-navy">Resumo do envio</h2>
          <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl border border-o2-navy/10 bg-gray-200 shadow-sm">
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-o2-navy">{campanha.total_destinatarios}</p>
              <p className="text-xs text-gray-500">Destinatários</p>
            </div>
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-green-700">{campanha.total_enviados}</p>
              <p className="text-xs text-gray-500">Enviados</p>
            </div>
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{campanha.total_falhas}</p>
              <p className="text-xs text-gray-500">Falhas</p>
            </div>
          </div>

          {/* Métricas de abertura/clique via webhook do Resend + descadastros
              originados desta campanha (pedido da reunião de 15/09/2026). */}
          <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl border border-o2-navy/10 bg-gray-200 shadow-sm">
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-o2-navy">{totalAbertos ?? 0}</p>
              <p className="text-xs text-gray-500">Abriram</p>
            </div>
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-o2-navy">{totalCliques ?? 0}</p>
              <p className="text-xs text-gray-500">Clicaram</p>
            </div>
            <div className="bg-quadro p-4 text-center">
              <p className="text-2xl font-bold text-gray-600">{totalDescadastros ?? 0}</p>
              <p className="text-xs text-gray-500">Descadastros</p>
            </div>
          </div>

          {campanha.status === "enviando" && (
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-o2-coral transition-all" style={{ width: `${percentualEnviado}%` }} />
            </div>
          )}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-o2-navy/10 bg-quadro p-4 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Modelo</dt>
              <dd className="font-medium text-o2-navy">{ROTULO_TEMPLATE[campanha.template] ?? campanha.template}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Produto</dt>
              <dd className="font-medium text-o2-navy">{rotuloProduto}</dd>
            </div>
            {campanha.disparada_em && (
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Disparada em</dt>
                <dd className="font-medium text-o2-navy">{new Date(campanha.disparada_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</dd>
              </div>
            )}
            {campanha.concluida_em && (
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Concluída em</dt>
                <dd className="font-medium text-o2-navy">{new Date(campanha.concluida_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</dd>
              </div>
            )}
          </dl>
        </section>
        )}

        {/* Template do e-mail */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-o2-navy">{jaEnviadaOuEnviando ? "Template do e-mail enviado" : "Prévia do e-mail"}</h2>
          <div className="overflow-hidden rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
            <p className="border-b border-o2-navy/10 bg-quadro px-4 py-2 text-xs font-medium uppercase tracking-wide text-o2-navy">Assunto: {campanha.assunto}</p>
            <div className="max-h-[480px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: htmlEmail }} />
          </div>
        </section>

        {/* Produção gerada */}
        {jaEnviadaOuEnviando && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-o2-navy">Produção gerada</h2>
            <ExportarQuadro
              quadroId="quadro-producao-campanha"
              nomeArquivo={`producao-${campanha.nome}`}
              dadosExcel={dadosExcelProducao}
              nomeAbaExcel="Produção"
            />
          </div>
          <p className="text-xs text-gray-500">Preenchimento manual, por imobiliária impactada pela campanha.</p>

          {idsImpactados.length === 0 && (
            <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              Essa campanha ainda não tem destinatários confirmados — volte em "Destinatários" ou dispare a campanha antes de lançar produção.
            </p>
          )}

          <div id="quadro-producao-campanha" className="overflow-x-auto rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-o2-navy/10 bg-quadro text-xs uppercase tracking-wide text-o2-navy">
                  <th className="p-3 text-left">Imobiliária</th>
                  <th className="p-3 text-left">Produto</th>
                  <th className="p-3 text-right">Apólices</th>
                  <th className="p-3 text-right">Prêmio líquido</th>
                  <th className="p-3 text-right">Comissão gerada</th>
                  <th className="p-3 text-right">Repasse gerado</th>
                  <th className="p-3 text-right">Resultado</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {linhasQuadro.map((l) => {
                  const resultado = l.comissao_gerada - l.repasse_gerado;
                  // form vazio (só campos ocultos), sem envolver as células --
                  // <tr> só aceita <td> como filho direto, então os inputs de
                  // cada coluna vivem em <td> normais (alinhados com o <th> da
                  // tabela) e se associam a este form de fora, via atributo
                  // `form`. É isso que evita a sobreposição que dava com um
                  // grid interno num <td colSpan> só (não respeitava a largura
                  // real de cada coluna do cabeçalho).
                  const formId = `producao-${l.imobiliariaId}`;
                  return (
                    <tr key={l.imobiliariaId}>
                      <td className="p-3">
                        <form id={formId} action={salvarLinhaProducao}>
                          <input type="hidden" name="campanha_id" value={id} />
                          <input type="hidden" name="imobiliaria_id" value={l.imobiliariaId} />
                          {l.linhaId && <input type="hidden" name="linha_id" value={l.linhaId} />}
                        </form>
                        <span className="block max-w-[220px] truncate font-medium text-o2-navy" title={l.imobiliariaNome}>
                          {l.imobiliariaNome}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-gray-500">{rotuloProduto}</td>
                      <td className="p-3">
                        <input form={formId} name="quantidade_apolices" type="number" min="0" step="1" defaultValue={l.quantidade_apolices} className={numInputClass} />
                      </td>
                      <td className="p-3">
                        <input form={formId} name="premio_liquido" type="number" min="0" step="0.01" defaultValue={l.premio_liquido} className={numInputClass} />
                      </td>
                      <td className="p-3">
                        <input form={formId} name="comissao_gerada" type="number" min="0" step="0.01" defaultValue={l.comissao_gerada} className={numInputClass} />
                      </td>
                      <td className="p-3">
                        <input form={formId} name="repasse_gerado" type="number" min="0" step="0.01" defaultValue={l.repasse_gerado} className={numInputClass} />
                      </td>
                      <td className={`p-3 text-right text-sm font-semibold ${resultado < 0 ? "text-red-600" : "text-o2-navy"}`}>{formatarMoeda(resultado)}</td>
                      <td className="p-3">
                        <div className="flex justify-end gap-2 whitespace-nowrap" data-export-ignore="true">
                          <button form={formId} type="submit" className="rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white">
                            Salvar
                          </button>
                          {l.linhaId && (
                            <button
                              form={formId}
                              type="submit"
                              formAction={removerLinhaProducao}
                              className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                            >
                              Zerar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!linhasQuadro.length && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-sm text-gray-500">
                      Nenhuma imobiliária impactada por essa campanha ainda.
                    </td>
                  </tr>
                )}
              </tbody>
              {linhasQuadro.length > 0 && (
                <tfoot>
                  <tr className="border-t border-o2-navy/10 bg-quadro text-sm font-semibold text-o2-navy">
                    <td className="p-3" colSpan={2}>
                      Total ({linhasQuadro.length} imobiliária{linhasQuadro.length > 1 ? "s" : ""})
                    </td>
                    <td className="p-3 text-right">{totaisProducao.apolices}</td>
                    <td className="p-3 text-right">{formatarMoeda(totaisProducao.premio)}</td>
                    <td className="p-3 text-right">{formatarMoeda(totaisProducao.comissao)}</td>
                    <td className="p-3 text-right">{formatarMoeda(totaisProducao.repasse)}</td>
                    <td className="p-3 text-right">{formatarMoeda(totaisProducao.comissao - totaisProducao.repasse)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
        )}

        <Link href="/campanhas" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra lista de campanhas
        </Link>
      </main>
    </>
  );
}
