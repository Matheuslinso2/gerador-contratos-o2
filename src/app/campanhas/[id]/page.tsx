import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2, DOMINIO_O2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import ExportarQuadro from "@/components/ExportarQuadro";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { produtosDaCampanha, rotuloProdutoCampanha, rotulosProdutosCampanha } from "@/lib/campanhas/produtos";
import { montarHtmlCampanha, personalizarCampanha, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { NOME_EXEMPLO_PREVIA } from "@/lib/campanhas/personalizacao";
import { emailsElegiveisCampanha } from "@/lib/campanhas/elegibilidade";
import { buscarEmailsEquipeInterna } from "@/lib/campanhas/equipeInterna";
import SubmitButton from "@/components/SubmitButton";
import { CampanhaProgresso } from "./CampanhaProgresso";
import { salvarLinhaProducao, removerLinhaProducao } from "./producao/actions";
import { CelulasComissaoRepasse } from "./producao/CelulasComissaoRepasse";
import { GerenciarDestinatarios } from "./GerenciarDestinatarios";
import { EditarConteudoCampanha } from "./EditarConteudoCampanha";
import { ReenviarCampanha } from "./ReenviarCampanha";
import { FiltroProducao } from "./FiltroProducao";
import { EmailsEnviados } from "../EmailsEnviados";
import {
  resumirStatusPorImobiliaria,
  statusDoEnvio,
  normalizarBusca,
  ROTULO_STATUS_ENVIO,
  COR_STATUS_ENVIO,
  type ChaveStatusEnvio,
  type DetalheEmail,
  type EnvioParaStatus,
  type ResumoStatusEnvio,
} from "@/lib/campanhas/producaoStatus";
import { listarDestinatariosReenvio, hojeSaoPauloISO } from "@/lib/campanhas/reenvio";
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
  statusEnvio: ResumoStatusEnvio;
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
    rascunho
      ? supabase.from("campanhas_grupos_contatos").select("id, grupo_id, nome_imobiliaria, nome_responsavel, email")
      : Promise.resolve({ data: [] }),
    rascunho ? supabase.from("campanhas_descadastros").select("email") : Promise.resolve({ data: [] }),
    contatosExternosIdsSelecionados.length
      ? supabase.from("campanhas_grupos_contatos").select("id, nome_imobiliaria, nome_responsavel, email").in("id", contatosExternosIdsSelecionados)
      : Promise.resolve({ data: [] }),
  ]);

  const emailsEquipeInterna = rascunho ? await buscarEmailsEquipeInterna(supabase) : [];

  const descadastrados = new Set((descadastrosData ?? []).map((d) => d.email.toLowerCase()));
  const imobiliariasParaCliente = (todasImobiliariasData ?? []).map((i) => ({
    id: i.id,
    nome: i.nome,
    emails: emailsElegiveisCampanha(i, descadastrados),
  }));
  const contatosPorGrupo = new Map<string, { id: string; nomeImobiliaria: string; nomeResponsavel: string | null; email: string }[]>();
  for (const c of contatosGruposData ?? []) {
    if (descadastrados.has(c.email.trim().toLowerCase())) continue;
    const lista = contatosPorGrupo.get(c.grupo_id) ?? [];
    lista.push({ id: c.id, nomeImobiliaria: c.nome_imobiliaria, nomeResponsavel: c.nome_responsavel, email: c.email });
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
      ? supabase.from("campanhas_grupos_contatos").select("id, nome_imobiliaria").in("id", contatosIdsSelecionadosAgendada)
      : Promise.resolve({ data: [] }),
  ]);
  const totalSelecionadosAgendada = idsSelecionadosAgendada.length + contatosIdsSelecionadosAgendada.length;
  const nomesSelecionadosAgendada = [
    ...(nomesImobiliariasAgendada ?? []).map((i) => i.nome),
    ...(nomesContatosAgendada ?? []).map((c) => c.nome_imobiliaria),
  ];

  const percentualEnviado = campanha.total_destinatarios
    ? Math.round(((campanha.total_enviados + campanha.total_falhas) / campanha.total_destinatarios) * 100)
    : 0;

  const [{ data: enviosData }, { data: producaoData }, { count: totalAbertos }, { count: totalCliques }, { count: totalDescadastros }] =
    await Promise.all([
      supabase
        .from("campanhas_envios")
        .select("imobiliaria_id, email, status, enviado_em, aberto_em, clicado_em, erro_detalhe")
        .eq("campanha_id", id),
      supabase.from("campanhas_producao").select("id, imobiliaria_id, quantidade_apolices, premio_liquido, comissao_gerada, repasse_gerado").eq("campanha_id", id),
      // Só fora do grupo O2 (pedido do Matheus, 17/09/2026) -- a métrica é
      // pra medir o impacto da campanha no cliente, não abertura/clique da
      // própria equipe interna que também recebeu (ver equipeInterna.ts).
      supabase
        .from("campanhas_envios")
        .select("id", { count: "exact", head: true })
        .eq("campanha_id", id)
        .not("aberto_em", "is", null)
        .not("email", "ilike", `%${DOMINIO_O2}`),
      supabase
        .from("campanhas_envios")
        .select("id", { count: "exact", head: true })
        .eq("campanha_id", id)
        .not("clicado_em", "is", null)
        .not("email", "ilike", `%${DOMINIO_O2}`),
      supabase.from("campanhas_descadastros").select("id", { count: "exact", head: true }).eq("origem_campanha_id", id),
    ]);

  // Antes do disparo (rascunho/agendada), "quem impacta a Produção" é a
  // seleção atual da campanha -- pedido do Matheus, 15/09/2026: adicionar
  // uma imob ou grupo já deve aparecer em Produção na hora, não só depois
  // de disparar. Depois do disparo, campanhas_envios é que manda (é o
  // registro histórico de quem realmente recebeu, pode diferir da seleção
  // se algum e-mail ficou inelegível entre a seleção e o envio).
  const idsImpactados = jaEnviadaOuEnviando
    ? [...new Set((enviosData ?? []).filter((e) => e.imobiliaria_id).map((e) => e.imobiliaria_id as string))]
    : ((campanha.imobiliarias_selecionadas as string[] | null) ?? []);
  const { data: imobiliariasImpactadas } = idsImpactados.length
    ? await supabase.from("imobiliarias").select("id, nome").in("id", idsImpactados).order("nome")
    : { data: [] };

  const producaoPorImobiliaria = new Map((producaoData ?? []).map((p) => [p.imobiliaria_id as string, p]));

  // Status de envio/abertura por imobiliária (pedido do Matheus,
  // 07/10/2026). Antes do disparo não há linhas em campanhas_envios, então
  // todo mundo fica "Aguardando envio".
  const statusPorImobiliaria = resumirStatusPorImobiliaria((enviosData ?? []) as EnvioParaStatus[]);

  // Destinatários SEM cadastro de imobiliária -- contatos de prospecção e
  // equipe da O2. Campanhas só pra equipe (tipo as de meta) ficavam com o
  // quadro de produção vazio e sem jeito de ver quem abriu.
  const enviosSemImobiliaria = (enviosData ?? []).filter((e) => !e.imobiliaria_id);
  const idsContatosSelecionados = (campanha.contatos_externos_selecionados as string[] | null) ?? [];
  const { data: contatosOutros } =
    enviosSemImobiliaria.length && idsContatosSelecionados.length
      ? await supabase.from("campanhas_grupos_contatos").select("email, nome_imobiliaria, nome_responsavel").in("id", idsContatosSelecionados)
      : { data: [] };
  const rotuloPorEmail = new Map(
    (contatosOutros ?? []).map((c) => [
      String(c.email).trim().toLowerCase(),
      `${c.nome_imobiliaria}${c.nome_responsavel ? ` (A/C: ${c.nome_responsavel})` : ""}`,
    ])
  );
  const outrosDestinatarios = enviosSemImobiliaria
    .map((e) => {
      const email = String(e.email);
      const detalhe: DetalheEmail = {
        email,
        chave: statusDoEnvio(e),
        enviadoEm: e.enviado_em,
        abertoEm: e.aberto_em,
        clicadoEm: e.clicado_em,
        erro: e.erro_detalhe,
      };
      const rotulo = rotuloPorEmail.get(email.trim().toLowerCase()) ?? email;
      return { rotulo, detalhe };
    })
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR") || a.detalhe.email.localeCompare(b.detalhe.email));
  const opcoesStatusOutros = (Object.keys(ROTULO_STATUS_ENVIO) as ChaveStatusEnvio[])
    .map((chave) => ({ valor: chave, rotulo: ROTULO_STATUS_ENVIO[chave], total: outrosDestinatarios.filter((o) => o.detalhe.chave === chave).length }))
    .filter((o) => o.total > 0);
  const semEnvio: ResumoStatusEnvio = { chave: "aguardando", totalEmails: 0, emailsAbertos: 0, clicou: false, emails: [] };

  // A tela já traz toda imobiliária impactada como linha -- tenha ou não
  // produção lançada ainda (zerada até o comercial preencher e salvar).
  const linhasQuadro: LinhaQuadro[] = (imobiliariasImpactadas ?? []).map((imob) => {
    const p = producaoPorImobiliaria.get(imob.id);
    return {
      statusEnvio: statusPorImobiliaria.get(imob.id) ?? semEnvio,
      linhaId: p?.id ?? null,
      imobiliariaId: imob.id,
      imobiliariaNome: imob.nome,
      quantidade_apolices: p?.quantidade_apolices ?? 0,
      premio_liquido: p?.premio_liquido ?? 0,
      comissao_gerada: p?.comissao_gerada ?? 0,
      repasse_gerado: p?.repasse_gerado ?? 0,
    };
  });

  // Campanha pode ter vários produtos (pedido do Matheus, 07/10/2026).
  const produtosCampanha = produtosDaCampanha(campanha);
  const rotuloProduto = rotulosProdutosCampanha(produtosCampanha);

  // Reenvio (pedido do Matheus, 02/10/2026) só faz sentido depois do disparo
  // terminar -- enquanto "enviando", ainda tem gente na fila.
  const reenvio = campanha.status === "concluida" ? await listarDestinatariosReenvio(supabase, id) : null;
  const validadeExpirada = !!campanha.valido_ate && campanha.valido_ate < hojeSaoPauloISO();

  const totaisProducao = linhasQuadro.reduce(
    (acc, l) => ({
      apolices: acc.apolices + l.quantidade_apolices,
      premio: acc.premio + l.premio_liquido,
      comissao: acc.comissao + l.comissao_gerada,
      repasse: acc.repasse + l.repasse_gerado,
    }),
    { apolices: 0, premio: 0, comissao: 0, repasse: 0 }
  );

  const opcoesStatusFiltro = (Object.keys(ROTULO_STATUS_ENVIO) as ChaveStatusEnvio[])
    .map((chave) => ({
      valor: chave,
      rotulo: ROTULO_STATUS_ENVIO[chave],
      total: linhasQuadro.filter((l) => l.statusEnvio.chave === chave).length,
    }))
    .filter((o) => o.total > 0);

  const dadosExcelProducao = linhasQuadro.map((l) => ({
    Imobiliária: l.imobiliariaNome,
    "Status do e-mail": ROTULO_STATUS_ENVIO[l.statusEnvio.chave],
    "Clicou no e-mail": l.statusEnvio.totalEmails ? (l.statusEnvio.clicou ? "Sim" : "Não") : "—",
    Produto: rotuloProduto,
    "Qtde. apólices": l.quantidade_apolices,
    "Prêmio líquido": l.premio_liquido,
    "Comissão gerada": l.comissao_gerada,
    "Repasse gerado": l.repasse_gerado,
    Resultado: l.comissao_gerada - l.repasse_gerado,
  }));

  const htmlEmail = montarHtmlCampanha(personalizarCampanha(campanha as CampanhaRow, NOME_EXEMPLO_PREVIA), "#");

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-8 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader icon={<IconMail />} titulo={campanha.nome} subtitulo={campanha.assunto} />
          <div className="flex items-center gap-2">
            {produtosCampanha.map((p) => (
              <span key={p} className="whitespace-nowrap rounded-full bg-o2-navy/10 px-2.5 py-1 text-xs font-medium text-o2-navy">
                {rotuloProdutoCampanha(p)}
              </span>
            ))}
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

        <div className="-mt-4 space-y-0.5">
          {/* Pedido do Matheus, 07/10/2026: login de quem criou a campanha. */}
          <p className="text-xs text-gray-500">
            Criada por <strong className="font-semibold text-o2-navy">{campanha.criado_por_email ?? "—"}</strong> em{" "}
            {new Date(campanha.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
          </p>
          {(campanha.valido_de || campanha.valido_ate) && (
            <p className="text-xs font-medium text-o2-coral">
              {campanha.valido_de && campanha.valido_ate
                ? `Válida de ${formatarDataBr(campanha.valido_de)} até ${formatarDataBr(campanha.valido_ate)}`
                : campanha.valido_ate
                  ? `Válida até ${formatarDataBr(campanha.valido_ate)}`
                  : `Válida a partir de ${formatarDataBr(campanha.valido_de)}`}
            </p>
          )}
        </div>

        <CampanhaProgresso campanhaId={id} status={campanha.status} />

        {/* Resumo do envio -- SEMPRE presente, na mesma posição, com o
            mesmo cabeçalho (pedido do Matheus, 15/09/2026: só 2 telas no
            fluxo, e a tela principal não pode trocar de cara conforme o
            status -- só o conteúdo dentro desta seção muda). */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-o2-navy">Resumo do envio</h2>

          {rascunho && (
            <GerenciarDestinatarios
              // key={id} força remount ao navegar de uma campanha pra outra
              // (ex: "Duplicar campanha", ou entre rascunhos pela lista) --
              // sem isso, o useState de idsSelecionados/contatosSelecionados
              // carregava o estado da campanha ANTERIOR, fazendo um grupo já
              // aparecer "selecionado" numa campanha nova que nunca teve
              // esse grupo de verdade (bug real relatado pelo Matheus,
              // 18/09/2026: grupo de cliente aparecia pré-marcado num aviso
              // interno recém-criado, e "Excluir grupo" não resolvia porque
              // o problema era estado de tela obsoleto, não o banco).
              key={id}
              campanhaId={id}
              imobiliarias={imobiliariasParaCliente}
              idsSelecionadosIniciais={idsSelecionados}
              grupos={gruposParaCliente}
              contatosSelecionadosIniciais={(contatosExternosSelecionadosData ?? []).map((c) => ({
                id: c.id,
                nomeImobiliaria: c.nome_imobiliaria,
                nomeResponsavel: c.nome_responsavel,
                email: c.email,
              }))}
              incluirEquipeInternaInicial={campanha.incluir_equipe_interna}
              totalEmailsEquipeInterna={emailsEquipeInterna.length}
            />
          )}

          {agendada && (
            <>
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
            </>
          )}

          {jaEnviadaOuEnviando && (
            <>
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
                  originados desta campanha (pedido da reunião de 15/09/2026).
                  Abriram/Clicaram excluem @o2seguros.com.br (pedido do
                  Matheus, 17/09/2026): mede impacto real no cliente, não a
                  própria equipe interna que também recebeu a campanha. */}
              <p className="text-xs text-gray-500">Abertura e clique contam só quem é de fora da O2</p>
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

              {reenvio && (
                <ReenviarCampanha
                  campanhaId={id}
                  totalTodos={reenvio.todos.length}
                  totalNaoAbriram={reenvio.nao_abriram.length}
                  validadeExpirada={validadeExpirada}
                />
              )}
            </>
          )}
        </section>

        <EditarConteudoCampanha
          campanha={{
            id,
            nome: campanha.nome,
            assunto: campanha.assunto,
            template: campanha.template,
            personalizacao: campanha.personalizacao,
            titulo: campanha.titulo,
            introducao: campanha.introducao,
            valido_de: campanha.valido_de,
            valido_ate: campanha.valido_ate,
            produtos: produtosCampanha,
            corpo_html: campanha.corpo_html,
            cta_texto: campanha.cta_texto,
            cta_href: campanha.cta_href,
          }}
          htmlEmail={htmlEmail}
          rascunho={rascunho}
          tituloSecao={jaEnviadaOuEnviando ? "Template do e-mail enviado" : "Prévia do e-mail"}
        />

        {/* Produção gerada -- sempre presente (mesmo motivo do Resumo do
            envio acima); vazia até existir disparo de verdade. */}
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
          <p className="text-xs text-gray-500">
            Preenchimento manual, por imobiliária impactada pela campanha. A coluna de status mostra quem abriu o e-mail (abertura é medida por
            imagem — quem bloqueia imagens pode ter lido e aparecer como &quot;Não abriu&quot;).
          </p>

          {linhasQuadro.length > 0 && (
            <FiltroProducao
              quadroId="quadro-producao-campanha"
              linhas={linhasQuadro.map((l) => ({ nomeNormalizado: normalizarBusca(l.imobiliariaNome), status: l.statusEnvio.chave }))}
              opcoesStatus={opcoesStatusFiltro}
            />
          )}

          {idsImpactados.length === 0 && (
            <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              Essa campanha ainda não tem destinatários confirmados — selecione e dispare a campanha (em &quot;Resumo do envio&quot;, acima) antes de lançar produção.
            </p>
          )}

          <div id="quadro-producao-campanha" className="overflow-x-auto rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
            <table className="w-full min-w-[960px] text-sm [&_td]:px-2 [&_th]:px-2">
              <thead>
                <tr className="border-b border-o2-navy/10 bg-quadro text-xs uppercase tracking-wide text-o2-navy">
                  <th className="min-w-[340px] p-3 text-left">Imobiliária</th>
                  <th className="whitespace-nowrap p-3 text-left">Status</th>
                  <th className="p-3 text-left">Produto</th>
                  <th className="p-3 text-right">Apólices</th>
                  <th className="p-3 text-right">Prêmio líquido</th>
                  <th className="p-3 text-right">Comissão gerada</th>
                  <th className="p-3 text-right">Repasse gerado</th>
                  <th className="p-3 text-right">Resultado</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-300">
                {linhasQuadro.map((l) => {
                  // form vazio (só campos ocultos), sem envolver as células --
                  // <tr> só aceita <td> como filho direto, então os inputs de
                  // cada coluna vivem em <td> normais (alinhados com o <th> da
                  // tabela) e se associam a este form de fora, via atributo
                  // `form`. É isso que evita a sobreposição que dava com um
                  // grid interno num <td colSpan> só (não respeitava a largura
                  // real de cada coluna do cabeçalho).
                  const formId = `producao-${l.imobiliariaId}`;
                  return (
                    <tr
                      key={l.imobiliariaId}
                      data-filtro-nome={normalizarBusca(l.imobiliariaNome)}
                      data-filtro-status={l.statusEnvio.chave}
                      className="transition-colors hover:bg-quadro/60 [&>td]:align-top"
                    >
                      <td className="p-3">
                        <form id={formId} action={salvarLinhaProducao}>
                          <input type="hidden" name="campanha_id" value={id} />
                          <input type="hidden" name="imobiliaria_id" value={l.imobiliariaId} />
                          {l.linhaId && <input type="hidden" name="linha_id" value={l.linhaId} />}
                        </form>
                        <span className="block max-w-[300px] truncate font-semibold text-o2-navy" title={l.imobiliariaNome}>
                          {l.imobiliariaNome}
                        </span>
                        <EmailsEnviados emails={l.statusEnvio.emails} />
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS_ENVIO[l.statusEnvio.chave]}`}
                          >
                            {ROTULO_STATUS_ENVIO[l.statusEnvio.chave]}
                          </span>
                          {l.statusEnvio.clicou && (
                            <span className="whitespace-nowrap rounded-full bg-o2-navy/10 px-2 py-0.5 text-xs font-medium text-o2-navy">Clicou</span>
                          )}
                        </div>
                        {l.statusEnvio.totalEmails > 1 && (
                          <span className="mt-0.5 block text-[11px] text-gray-400">
                            {l.statusEnvio.emailsAbertos} de {l.statusEnvio.totalEmails} e-mails abertos
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-gray-500">{rotuloProduto}</td>
                      <td className="p-3">
                        <input form={formId} name="quantidade_apolices" type="number" min="0" step="1" defaultValue={l.quantidade_apolices} className={numInputClass} />
                      </td>
                      <td className="p-3">
                        <input form={formId} name="premio_liquido" type="number" min="0" step="0.01" defaultValue={l.premio_liquido} className={numInputClass} />
                      </td>
                      <CelulasComissaoRepasse
                        formId={formId}
                        comissaoInicial={l.comissao_gerada}
                        repasseInicial={l.repasse_gerado}
                        className={numInputClass}
                      />
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
                    <td colSpan={9} className="p-8 text-center text-sm text-gray-500">
                      Nenhuma imobiliária impactada por essa campanha ainda.
                    </td>
                  </tr>
                )}
              </tbody>
              {linhasQuadro.length > 0 && (
                <tfoot>
                  <tr className="border-t border-o2-navy/10 bg-quadro text-sm font-semibold text-o2-navy">
                    <td className="p-3" colSpan={3}>
                      Total geral ({linhasQuadro.length} imobiliária{linhasQuadro.length > 1 ? "s" : ""})
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

        {outrosDestinatarios.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-o2-navy">Outros destinatários</h2>
            <p className="text-xs text-gray-500">
              Contatos de prospecção e equipe da O2 — não têm cadastro de imobiliária, então ficam fora do quadro de produção. As aberturas da equipe
              O2 não entram no painel &quot;Abriram&quot; acima, só aqui.
            </p>
            <FiltroProducao
              quadroId="quadro-outros-destinatarios"
              linhas={outrosDestinatarios.map((o) => ({ nomeNormalizado: normalizarBusca(`${o.rotulo} ${o.detalhe.email}`), status: o.detalhe.chave }))}
              opcoesStatus={opcoesStatusOutros}
              rotuloBusca="Buscar destinatário"
              placeholderBusca="Nome ou e-mail..."
              textoVazio="Ninguém encontrado com esse filtro."
            />
            <div id="quadro-outros-destinatarios" className="overflow-x-auto rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
              <table className="w-full text-sm [&_td]:px-3 [&_th]:px-3">
                <thead>
                  <tr className="border-b border-o2-navy/10 bg-quadro text-xs uppercase tracking-wide text-o2-navy">
                    <th className="p-3 text-left">Destinatário</th>
                    <th className="p-3 text-left">Status do e-mail</th>
                    <th className="p-3 text-left">Enviado em</th>
                    <th className="p-3 text-left">Abriu em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {outrosDestinatarios.map(({ rotulo, detalhe }) => (
                    <tr
                      key={detalhe.email}
                      data-filtro-nome={normalizarBusca(`${rotulo} ${detalhe.email}`)}
                      data-filtro-status={detalhe.chave}
                    >
                      <td className="p-3 align-top">
                        <span className="block break-all font-semibold text-o2-navy">{rotulo}</span>
                        {rotulo !== detalhe.email && <span className="block break-all text-[11px] text-gray-500">{detalhe.email}</span>}
                      </td>
                      <td className="p-3 align-top">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS_ENVIO[detalhe.chave]}`}>
                            {ROTULO_STATUS_ENVIO[detalhe.chave]}
                          </span>
                          {detalhe.clicadoEm && (
                            <span className="whitespace-nowrap rounded-full bg-o2-navy/10 px-2 py-0.5 text-xs font-medium text-o2-navy">Clicou</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 align-top text-xs text-gray-500">
                        {detalhe.enviadoEm
                          ? new Date(detalhe.enviadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
                          : "—"}
                      </td>
                      <td className="p-3 align-top text-xs text-gray-500">
                        {detalhe.abertoEm
                          ? new Date(detalhe.abertoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
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
