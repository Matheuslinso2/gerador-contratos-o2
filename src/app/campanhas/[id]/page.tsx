import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2, DOMINIO_O2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconMail } from "@/components/icons";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { produtosDaCampanha, rotuloProdutoCampanha, rotulosProdutosCampanha } from "@/lib/campanhas/produtos";
import { montarHtmlCampanha, personalizarCampanha, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { NOME_EXEMPLO_PREVIA } from "@/lib/campanhas/personalizacao";
import { nomeExibidoRemetente } from "@/lib/campanhas/remetente";
import { emailsElegiveisCampanha } from "@/lib/campanhas/elegibilidade";
import { buscarEmailsEquipeInterna } from "@/lib/campanhas/equipeInterna";
import SubmitButton from "@/components/SubmitButton";
import { CampanhaProgresso } from "./CampanhaProgresso";
import { GerenciarDestinatarios } from "./GerenciarDestinatarios";
import { EditarConteudoCampanha } from "./EditarConteudoCampanha";
import { ResumoEnvios, type NumerosEmail } from "./ResumoEnvios";
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
import ProducaoCampanha from "./metas/ProducaoCampanha";
import EmailsDaCampanha, { type EmailFilho } from "./metas/EmailsDaCampanha";
import ExportarEste from "@/components/ExportarEste";

export const dynamic = "force-dynamic";

const ROTULO_TEMPLATE: Record<string, string> = {
  comunicado: "Comunicado geral",
  promocao: "Promoção / oferta",
  newsletter: "Newsletter",
};

function formatarDataBr(data: string) {
  return new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

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

  const [{ data: enviosData }, { count: totalAbertos }, { count: totalCliques }, { count: totalDescadastros }, { data: filhosData }, { data: paiData }] =
    await Promise.all([
      supabase
        .from("campanhas_envios")
        .select("imobiliaria_id, email, status, enviado_em, aberto_em, clicado_em, erro_detalhe")
        .eq("campanha_id", id),
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
      // E-mails desta campanha (parciais, boas-vindas por imobiliária) e, se
      // este for um deles, a campanha principal (22/10/2026).
      supabase
        .from("campanhas")
        .select("id, nome, status, created_at, disparada_em, agendado_para, total_enviados")
        .eq("campanha_pai_id", id)
        .order("created_at", { ascending: false }),
      campanha.campanha_pai_id
        ? supabase.from("campanhas").select("id, nome").eq("id", campanha.campanha_pai_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
  const filhosBrutos = (filhosData ?? []) as Omit<EmailFilho, "abertos" | "falhas" | "cliques">[];
  const { data: enviosFilhosData } = filhosBrutos.length
    ? await supabase
        .from("campanhas_envios")
        .select("campanha_id, imobiliaria_id, email, status, enviado_em, aberto_em, clicado_em, erro_detalhe")
        .in(
          "campanha_id",
          filhosBrutos.map((f) => f.id)
        )
    : { data: [] };
  const filhos: EmailFilho[] = filhosBrutos.map((f) => ({
    ...f,
    abertos: (enviosFilhosData ?? []).filter((e) => e.campanha_id === f.id && e.aberto_em && !String(e.email).toLowerCase().endsWith(DOMINIO_O2)).length,
    falhas: (enviosFilhosData ?? []).filter((e) => e.campanha_id === f.id && e.status === "falhou").length,
    cliques: (enviosFilhosData ?? []).filter((e) => e.campanha_id === f.id && e.clicado_em && !String(e.email).toLowerCase().endsWith(DOMINIO_O2)).length,
  }));
  const campanhaPai = paiData as { id: string; nome: string } | null;

  // Campanha com vários e-mails (27/10/2026): os envios ficam nas filhas, então
  // o resumo soma pai + filhos e deixa escolher um e-mail só. Antes mostrava
  // total_enviados do pai (71) com 0 aberturas, porque o pai não tem envios.
  const temEmailsFilhos = filhos.length > 0;
  const { data: descadastrosEmailsData } = temEmailsFilhos
    ? await supabase.from("campanhas_descadastros").select("origem_campanha_id").in("origem_campanha_id", [id, ...filhos.map((f) => f.id)])
    : { data: [] };
  type EnvioNumeros = { email: unknown; status: string; aberto_em: string | null; clicado_em: string | null };
  const numerosDoEmail = (emailId: string, rotulo: string, envios: EnvioNumeros[]): NumerosEmail => {
    const externos = envios.filter((e) => !String(e.email).toLowerCase().endsWith(DOMINIO_O2));
    return {
      id: emailId,
      rotulo,
      destinatarios: envios.length,
      enviados: envios.filter((e) => e.status === "enviado").length,
      enviadosExternos: externos.filter((e) => e.status === "enviado").length,
      falhas: envios.filter((e) => e.status === "falhou").length,
      abriram: externos.filter((e) => e.aberto_em).length,
      clicaram: externos.filter((e) => e.clicado_em).length,
      descadastros: (descadastrosEmailsData ?? []).filter((d) => d.origem_campanha_id === emailId).length,
    };
  };
  const emailsResumo: NumerosEmail[] = temEmailsFilhos
    ? [
        ...((enviosData ?? []).length ? [numerosDoEmail(id, `${campanha.nome} (e-mail principal)`, (enviosData ?? []) as EnvioNumeros[])] : []),
        ...filhos.map((f) =>
          numerosDoEmail(
            f.id,
            f.nome,
            (enviosFilhosData ?? []).filter((e) => e.campanha_id === f.id) as EnvioNumeros[]
          )
        ),
      ].filter((n) => n.destinatarios > 0 || n.id !== id)
    : [];
  const mostrarResumoAgregado = temEmailsFilhos && emailsResumo.some((n) => n.destinatarios > 0);
  const responsaveis = (await buscarEmailsEquipeInterna(supabase)).filter((e) => e.endsWith(DOMINIO_O2) && !e.startsWith("comercial@"));

  // Status de envio/abertura por imobiliária (pedido do Matheus,
  // 07/10/2026). Antes do disparo não há linhas em campanhas_envios, então
  // todo mundo fica "Aguardando envio".
  // Inclui os e-mails desta campanha (parciais etc.): o status no quadro é
  // de todos os e-mails que a imobiliária recebeu da campanha.
  const statusPorImobiliaria = resumirStatusPorImobiliaria([...(enviosData ?? []), ...(enviosFilhosData ?? [])] as EnvioParaStatus[]);

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

  // Campanha pode ter vários produtos (pedido do Matheus, 07/10/2026).
  const produtosCampanha = produtosDaCampanha(campanha);
  const rotuloProduto = rotulosProdutosCampanha(produtosCampanha);

  // Reenvio (pedido do Matheus, 02/10/2026) só faz sentido depois do disparo
  // terminar -- enquanto "enviando", ainda tem gente na fila.
  const reenvio = campanha.status === "concluida" ? await listarDestinatariosReenvio(supabase, id) : null;
  const validadeExpirada = !!campanha.valido_ate && campanha.valido_ate < hojeSaoPauloISO();

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

        {campanhaPai && (
          <p className="-mt-4 rounded-lg border border-o2-navy/10 bg-quadro p-3 text-sm text-o2-navy">
            Este é um e-mail da campanha{" "}
            <Link href={`/campanhas/${campanhaPai.id}`} className="font-semibold underline">
              {campanhaPai.nome}
            </Link>
            . Metas e produção ficam na campanha.
          </p>
        )}

        <div className="-mt-4 space-y-0.5">
          {/* Pedido do Matheus, 07/10/2026: login de quem criou a campanha. */}
          <p className="text-xs text-gray-500">
            Criada por <strong className="font-semibold text-o2-navy">{campanha.criado_por_email ?? "—"}</strong> em{" "}
            {new Date(campanha.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
          </p>
          <p className="text-xs text-gray-500">
            Remetente exibido: <strong className="font-semibold text-o2-navy">{nomeExibidoRemetente(campanha.remetente_nome)}</strong>
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
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-o2-navy">Resumo do envio<ExportarEste /></h2>

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

          {mostrarResumoAgregado && <ResumoEnvios key={id} emails={emailsResumo} />}

          {jaEnviadaOuEnviando && (
            <>
              {!mostrarResumoAgregado && (<>
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
              </>)}

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

          {!campanhaPai && (
            <EmailsDaCampanha campanhaId={id} filhos={filhos} podeGerarParcial={!!campanha.meta_metrica && !!campanha.valido_de && !!campanha.valido_ate} />
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
            remetente_nome: campanha.remetente_nome ?? null,
          }}
          htmlEmail={htmlEmail}
          rascunho={rascunho}
          tituloSecao={
            mostrarResumoAgregado && !campanhaPai
              ? "E-mail principal da campanha (modelo)"
              : jaEnviadaOuEnviando
                ? "Template do e-mail enviado"
                : "Prévia do e-mail"
          }
        />

        {/* Produção gerada -- sempre presente (mesmo motivo do Resumo do
            envio acima). Desde 22/10/2026 é automática (funil + Corp), com
            meta, responsável da O2 e resultado por imobiliária. */}
        <section id="producao" className="space-y-3">
          <h2 className="text-sm font-semibold text-o2-navy">Produção gerada</h2>
          {campanhaPai ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              A produção e as metas ficam na campanha{" "}
              <Link href={`/campanhas/${campanhaPai.id}#producao`} className="font-semibold text-o2-navy underline">
                {campanhaPai.nome}
              </Link>
              .
            </p>
          ) : (
            // A produção (funil + Corp + contatos do Bitrix) chega depois: o
            // resto da campanha abre na hora (22/10/2026, lentidão ao abrir).
            <Suspense
              fallback={
                <div className="animate-pulse rounded-xl border border-o2-navy/10 bg-quadro p-6 text-sm text-gray-500">
                  Calculando a produção da campanha (funil, Corp e últimos contatos)…
                </div>
              }
            >
            <ProducaoCampanha
              campanha={{
                id,
                nome: campanha.nome,
                imobiliarias_selecionadas: campanha.imobiliarias_selecionadas,
                valido_de: campanha.valido_de,
                valido_ate: campanha.valido_ate,
                meta_metrica: campanha.meta_metrica ?? null,
                premiacao_descricao: campanha.premiacao_descricao ?? null,
                custo_premiacao_geral: campanha.custo_premiacao_geral ?? 0,
                data_apuracao: campanha.data_apuracao ?? null,
              }}
              produtosCampanha={produtosCampanha}
              statusPorImobiliaria={statusPorImobiliaria}
              responsaveis={responsaveis}
            />
            </Suspense>
          )}
        </section>

        {outrosDestinatarios.length > 0 && (
          <section className="space-y-3">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-o2-navy">Outros destinatários<ExportarEste /></h2>
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
