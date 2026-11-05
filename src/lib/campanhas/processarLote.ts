import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { envolverEmailCampanha, type TemplateCampanha } from "@/lib/integracoes/emailCampanha";
import { linkDescadastro, linkDescadastroApi } from "./unsubscribeToken";
import { aplicarApelido, type ModoPersonalizacao } from "./personalizacao";
import { nomeParaComunicacao } from "@/lib/nomeParaComunicacao";
import { nomeExibidoRemetente } from "./remetente";
import { bccDoCard, continuarConversa, gravarDestinatarios } from "@/lib/bitrix/conversasEmail";
import { ENTITY_TYPE_ID_DEAL } from "@/lib/bitrix/entidadesCard";
import { registrarAtividadeEmail } from "@/lib/bitrix/atividades";

// Endereço separado do transacional (avisos@...) -- rejeições/denúncias de
// marketing não podem contaminar a reputação do domínio usado hoje por
// faturas/repasses (decisão confirmada com o Matheus).
export const ENDERECO_REMETENTE_CAMPANHAS = "campanhas@notificacoes.o2seguros.com.br";

// ~50 e-mails por invocação com ~400ms de intervalo -- folga confortável
// dentro dos 60s do Vercel, sem rajada no Resend.
const TAMANHO_LOTE_PADRAO = 50;
const INTERVALO_ENTRE_ENVIOS_MS = 400;
const MAX_TENTATIVAS = 3;

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CampanhaRow = {
  id: string;
  assunto: string;
  template: TemplateCampanha;
  titulo: string;
  introducao: string | null;
  valido_de: string | null;
  valido_ate: string | null;
  corpo_html: string;
  cta_texto: string | null;
  cta_href: string | null;
  personalizacao: ModoPersonalizacao;
  remetente_nome: string | null;
};

export const COLUNAS_CAMPANHA_ENVIO =
  "id, assunto, template, titulo, introducao, valido_de, valido_ate, corpo_html, cta_texto, cta_href, personalizacao, remetente_nome";

// Troca {{apelido}} pelo nome do destinatário em todos os textos da campanha
// (assunto é texto puro; o resto vai pro HTML). `nome` null = sem imobiliária.
export function personalizarCampanha(campanha: CampanhaRow, nome: string | null): CampanhaRow {
  if (campanha.personalizacao !== "apelido") return campanha;
  return {
    ...campanha,
    assunto: aplicarApelido(campanha.assunto, nome, { html: false }),
    titulo: aplicarApelido(campanha.titulo, nome),
    introducao: campanha.introducao ? aplicarApelido(campanha.introducao, nome) : campanha.introducao,
    corpo_html: aplicarApelido(campanha.corpo_html, nome),
  };
}

export type ResultadoLote = { processados: number; restantes: number; concluida: boolean };

// Parcial na conversa única da imobiliária (04/11/2026): UMA mensagem para todos os endereços
// dela, para a thread encadear de verdade. Sem rodapé de descadastro por pessoa (a mensagem é uma
// só): o link abre um e-mail para a equipe, que faz o descadastro.
export const LINK_DESCADASTRO_MENSAGEM_UNICA = "mailto:comercial@o2seguros.com.br?subject=Descadastrar%20de%20campanhas";

type EnvioReivindicado = { id: string; email: string; tentativas: number | null };

/**
 * Campanha com cards ligados (05/11/2026): quem tem card sai em UMA mensagem por imobiliária, dentro da conversa do card; os demais
 * (sem card, contatos de prospecção, equipe interna) seguem um por um, como sempre. Pura, para poder ser testada sem enviar nada.
 */
export function agruparPorCard(
  envios: EnvioReivindicado[],
  imobiliariaDoEnvio: Map<string, string | null>,
  cardDaImobiliaria: Map<string, number>
): { grupos: { dealId: number; imobiliariaId: string; envios: EnvioReivindicado[] }[]; individuais: EnvioReivindicado[] } {
  const grupos = new Map<string, { dealId: number; imobiliariaId: string; envios: EnvioReivindicado[] }>();
  const individuais: EnvioReivindicado[] = [];
  for (const e of envios) {
    const imob = imobiliariaDoEnvio.get(e.id) ?? null;
    const deal = imob ? cardDaImobiliaria.get(imob) : undefined;
    if (!imob || !deal) {
      individuais.push(e);
      continue;
    }
    const g = grupos.get(imob) ?? { dealId: deal, imobiliariaId: imob, envios: [] };
    g.envios.push(e);
    grupos.set(imob, g);
  }
  return { grupos: [...grupos.values()], individuais };
}

async function enviarMensagemUnica(
  supabase: ReturnType<typeof createServiceClient>,
  campanha: CampanhaRow,
  pendentes: EnvioReivindicado[],
  cardDealId: number | null
) {
  // Descadastro entre a fila ser montada e o envio: esse endereço sai da mensagem.
  const { data: descadastrados } = await supabase.from("campanhas_descadastros").select("email").in("email", pendentes.map((p) => p.email));
  const fora = new Set((descadastrados ?? []).map((d) => String(d.email).toLowerCase()));
  const saem = pendentes.filter((p) => fora.has(p.email.toLowerCase()));
  const vao = pendentes.filter((p) => !fora.has(p.email.toLowerCase()));
  if (saem.length) await supabase.from("campanhas_envios").update({ status: "descadastrado" }).in("id", saem.map((p) => p.id));
  if (!vao.length) return;

  try {
    // Com card: entra SEMPRE na conversa mais recente dele (Re: + In-Reply-To) e leva o endereço do
    // card em cópia oculta, como o "E-mail no card". Sem card (ou sem conversa ainda): abre a conversa.
    let assunto = campanha.assunto;
    let headers: Record<string, string> | undefined;
    let bcc: string[] | undefined;
    if (cardDealId) {
      const continuacao = await continuarConversa(ENTITY_TYPE_ID_DEAL, cardDealId);
      if (continuacao) {
        assunto = continuacao.assunto;
        headers = continuacao.headers;
      }
      bcc = [bccDoCard(ENTITY_TYPE_ID_DEAL, cardDealId)];
    }
    const html = montarHtmlCampanha(campanha, LINK_DESCADASTRO_MENSAGEM_UNICA);
    const { id: resendEmailId } = await enviarEmail({
      para: vao.map((p) => p.email),
      bcc,
      assunto,
      html,
      remetente: nomeExibidoRemetente(campanha.remetente_nome),
      enderecoRemetente: ENDERECO_REMETENTE_CAMPANHAS,
      headers,
      throwSeFalhar: true,
    });
    // Mesmo id nos endereços da mensagem: a abertura vale para a imobiliária (um e-mail só).
    await supabase.from("campanhas_envios").update({ status: "enviado", enviado_em: new Date().toISOString(), resend_email_id: resendEmailId }).in("id", vao.map((p) => p.id));
    // "E-mail no card" abre com esses endereços já preenchidos para a equipe continuar a conversa.
    if (cardDealId) await gravarDestinatarios(ENTITY_TYPE_ID_DEAL, cardDealId, { para: vao.map((p) => p.email), cc: [] }, "envio");
    // Registro no campo de e-mails do próprio card (atividade de e-mail enviado), como o "E-mail no card".
    // O e-mail já saiu: se o Bitrix falhar aqui, só avisa nos logs -- nunca refaz o envio.
    if (cardDealId) {
      try {
        await registrarAtividadeEmail({ entityTypeId: ENTITY_TYPE_ID_DEAL, itemId: cardDealId, assunto, corpo: html, direcao: "enviado", enderecoEnvolvido: vao[0].email });
      } catch (erroAtividade) {
        console.error("Parcial enviada, mas falhou ao registrar o e-mail no card do Bitrix:", erroAtividade);
      }
    }
  } catch (erro) {
    for (const p of vao) {
      const tentativas = (p.tentativas ?? 0) + 1;
      await supabase
        .from("campanhas_envios")
        .update({ tentativas, erro_detalhe: erro instanceof Error ? erro.message : String(erro), status: tentativas >= MAX_TENTATIVAS ? "falhou" : "pendente" })
        .eq("id", p.id);
    }
  }
}

// Compartilhada entre o loop de envio real (abaixo) e o botão de "enviar
// teste" da tela de revisão -- garante que o teste mostra exatamente o HTML
// que vai sair de verdade, inclusive o rodapé de descadastro.
// dd/mm/aaaa direto da string "aaaa-mm-dd" que o Postgres devolve pra uma
// coluna `date` -- sem passar por Date/timezone, que já causou bug de "um
// dia a menos" em outro lugar do projeto quando a data vinha só como
// calendário (sem hora) e o navegador local não era UTC.
function formatarDataBr(isoData: string): string {
  const [ano, mes, dia] = isoData.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function montarHtmlCampanha(campanha: CampanhaRow, unsubscribeHref: string): string {
  return envolverEmailCampanha({
    template: campanha.template,
    titulo: campanha.titulo,
    introducao: campanha.introducao ?? undefined,
    corpoHtml: campanha.corpo_html,
    ctaTexto: campanha.cta_texto ?? undefined,
    ctaHref: campanha.cta_href ?? undefined,
    destaquePromocao: campanha.template === "promocao" ? (campanha.introducao ?? undefined) : undefined,
    validoDe: campanha.valido_de ? formatarDataBr(campanha.valido_de) : undefined,
    validoAte: campanha.valido_ate ? formatarDataBr(campanha.valido_ate) : undefined,
    unsubscribeHref,
  });
}

// Função compartilhada entre a rota de polling (src/app/api/campanhas/[id]/
// processar-lote/route.ts, caminho principal enquanto o admin acompanha a
// tela) e o cron de rede de segurança (src/app/api/cron/enviar-campanhas/
// route.ts, retoma se a aba fechar no meio). Processa um lote pequeno por
// chamada -- nunca a fila inteira de uma vez -- pra caber nos 60s do Vercel
// mesmo com ~500 destinatários numa campanha.
export async function processarLote(campanhaId: string, limite = TAMANHO_LOTE_PADRAO): Promise<ResultadoLote> {
  const supabase = createServiceClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL não configurada");

  const { data: campanha } = await supabase
    .from("campanhas")
    .select(COLUNAS_CAMPANHA_ENVIO)
    .eq("id", campanhaId)
    .single<CampanhaRow>();
  if (!campanha) throw new Error("Campanha não encontrada");

  // Reivindica o lote de forma atômica (FOR UPDATE SKIP LOCKED, dentro da
  // função) -- pendente -> processando numa única transação no banco, pra
  // duas chamadas concorrentes (polling da tela + cron de rede de
  // segurança) nunca pegarem a mesma linha e mandarem o e-mail em
  // duplicidade. Ver migração fix_race_condition_disparo_campanhas.
  const { data: pendentes } = await supabase.rpc("reivindicar_lote_campanha_envios", {
    p_campanha_id: campanhaId,
    p_limite: limite,
  });

  // Nome de cada destinatário do lote (só quando a campanha personaliza) --
  // a RPC de reivindicar devolve só id/email/tentativas, então o
  // imobiliaria_id vem de campanhas_envios.
  const nomePorEnvio = new Map<string, string>();
  if (campanha.personalizacao === "apelido" && pendentes?.length) {
    const { data: vinculos } = await supabase
      .from("campanhas_envios")
      .select("id, imobiliaria_id")
      .in("id", pendentes.map((p: { id: string }) => p.id));
    const imobiliariaIds = [...new Set((vinculos ?? []).map((v) => v.imobiliaria_id).filter(Boolean))] as string[];
    const { data: imobiliarias } = imobiliariaIds.length
      ? await supabase.from("imobiliarias").select("id, nome, apelido").in("id", imobiliariaIds)
      : { data: [] };
    const imobPorId = new Map((imobiliarias ?? []).map((i) => [i.id, i]));
    for (const v of vinculos ?? []) {
      const imob = v.imobiliaria_id ? imobPorId.get(v.imobiliaria_id) : undefined;
      if (imob) nomePorEnvio.set(v.id, nomeParaComunicacao(imob));
    }
  }

  let processados = 0;
  const { data: modo } = await supabase.from("campanhas").select("mensagem_unica, card_deal_id, campanha_pai_id, reenvio_de").eq("id", campanhaId).single();
  const mensagemUnica = !!modo?.mensagem_unica;
  if (mensagemUnica && pendentes?.length) {
    processados = pendentes.length;
    await enviarMensagemUnica(supabase, campanha, pendentes as EnvioReivindicado[], modo?.card_deal_id ? Number(modo.card_deal_id) : null);
  }

  // Cards ligados à campanha (ou à campanha-mãe / à original, no caso de e-mail filho e de reenvio): quem tem card entra na conversa dele.
  let individuais: EnvioReivindicado[] = mensagemUnica ? [] : ((pendentes ?? []) as EnvioReivindicado[]);
  if (individuais.length) {
    // Raiz dos cards: a campanha-mãe (e-mail filho); no reenvio, a original -- ou a mãe dela, se a original era um filho.
    let raiz = (modo?.campanha_pai_id as string | null) ?? null;
    if (!raiz && modo?.reenvio_de) {
      const { data: original } = await supabase.from("campanhas").select("campanha_pai_id").eq("id", modo.reenvio_de as string).maybeSingle();
      raiz = (original?.campanha_pai_id as string | null) ?? (modo.reenvio_de as string);
    }
    raiz = raiz ?? campanhaId;
    const { data: cardsRows } = await supabase.from("campanhas_cards_bitrix").select("imobiliaria_id, bitrix_deal_id").eq("campanha_id", raiz);
    const cardDaImobiliaria = new Map(((cardsRows ?? []) as { imobiliaria_id: string; bitrix_deal_id: number }[]).map((c) => [c.imobiliaria_id, Number(c.bitrix_deal_id)]));
    if (cardDaImobiliaria.size) {
      const { data: vinc } = await supabase.from("campanhas_envios").select("id, imobiliaria_id").in("id", individuais.map((e) => e.id));
      const imobiliariaDoEnvio = new Map(((vinc ?? []) as { id: string; imobiliaria_id: string | null }[]).map((v) => [v.id, v.imobiliaria_id]));
      const { grupos, individuais: restantes } = agruparPorCard(individuais, imobiliariaDoEnvio, cardDaImobiliaria);
      individuais = restantes;
      for (const g of grupos) {
        processados += g.envios.length;
        await enviarMensagemUnica(supabase, personalizarCampanha(campanha, nomePorEnvio.get(g.envios[0].id) ?? null), g.envios, g.dealId);
        await aguardar(INTERVALO_ENTRE_ENVIOS_MS);
      }
    }
  }
  for (const envio of individuais) {
    processados++;

    // Pode ter havido descadastro entre a fila ser montada e o envio de
    // fato -- checagem extra além da exclusão feita ao popular a fila.
    const { data: descadastro } = await supabase
      .from("campanhas_descadastros")
      .select("id")
      .eq("email", envio.email)
      .maybeSingle();
    if (descadastro) {
      await supabase.from("campanhas_envios").update({ status: "descadastrado" }).eq("id", envio.id);
      continue;
    }

    try {
      const unsubscribeHref = linkDescadastro(envio.email, siteUrl, campanhaId);
      const unsubscribeHrefApi = linkDescadastroApi(envio.email, siteUrl, campanhaId);
      const campanhaDoEnvio = personalizarCampanha(campanha, nomePorEnvio.get(envio.id) ?? null);
      const html = montarHtmlCampanha(campanhaDoEnvio, unsubscribeHref);

      const { id: resendEmailId } = await enviarEmail({
        para: envio.email,
        assunto: campanhaDoEnvio.assunto,
        html,
        remetente: nomeExibidoRemetente(campanhaDoEnvio.remetente_nome),
        enderecoRemetente: ENDERECO_REMETENTE_CAMPANHAS,
        headers: {
          "List-Unsubscribe": `<${unsubscribeHrefApi}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        throwSeFalhar: true,
      });

      await supabase
        .from("campanhas_envios")
        .update({ status: "enviado", enviado_em: new Date().toISOString(), resend_email_id: resendEmailId })
        .eq("id", envio.id);
    } catch (erro) {
      const tentativas = (envio.tentativas ?? 0) + 1;
      await supabase
        .from("campanhas_envios")
        .update({
          tentativas,
          erro_detalhe: erro instanceof Error ? erro.message : String(erro),
          status: tentativas >= MAX_TENTATIVAS ? "falhou" : "pendente",
        })
        .eq("id", envio.id);
    }

    await aguardar(INTERVALO_ENTRE_ENVIOS_MS);
  }

  const [{ count: enviados }, { count: falhas }, { count: restantes }] = await Promise.all([
    supabase.from("campanhas_envios").select("id", { count: "exact", head: true }).eq("campanha_id", campanhaId).eq("status", "enviado"),
    supabase.from("campanhas_envios").select("id", { count: "exact", head: true }).eq("campanha_id", campanhaId).eq("status", "falhou"),
    supabase.from("campanhas_envios").select("id", { count: "exact", head: true }).eq("campanha_id", campanhaId).eq("status", "pendente"),
  ]);

  const concluida = (restantes ?? 0) === 0;
  await supabase
    .from("campanhas")
    .update({
      total_enviados: enviados ?? 0,
      total_falhas: falhas ?? 0,
      status: concluida ? "concluida" : "enviando",
      concluida_em: concluida ? new Date().toISOString() : null,
    })
    .eq("id", campanhaId);

  return { processados, restantes: restantes ?? 0, concluida };
}
