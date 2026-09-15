import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { envolverEmailCampanha, type TemplateCampanha } from "@/lib/integracoes/emailCampanha";
import { linkDescadastro, linkDescadastroApi } from "./unsubscribeToken";

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
};

export type ResultadoLote = { processados: number; restantes: number; concluida: boolean };

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
    .select("id, assunto, template, titulo, introducao, valido_de, valido_ate, corpo_html, cta_texto, cta_href")
    .eq("id", campanhaId)
    .single<CampanhaRow>();
  if (!campanha) throw new Error("Campanha não encontrada");

  const { data: pendentes } = await supabase
    .from("campanhas_envios")
    .select("id, email, tentativas")
    .eq("campanha_id", campanhaId)
    .eq("status", "pendente")
    .order("created_at", { ascending: true })
    .limit(limite);

  let processados = 0;
  for (const envio of pendentes ?? []) {
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
      const unsubscribeHref = linkDescadastro(envio.email, siteUrl);
      const unsubscribeHrefApi = linkDescadastroApi(envio.email, siteUrl);
      const html = montarHtmlCampanha(campanha, unsubscribeHref);

      await enviarEmail({
        para: envio.email,
        assunto: campanha.assunto,
        html,
        remetente: "O2 Seguros",
        enderecoRemetente: ENDERECO_REMETENTE_CAMPANHAS,
        headers: {
          "List-Unsubscribe": `<${unsubscribeHrefApi}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        throwSeFalhar: true,
      });

      await supabase
        .from("campanhas_envios")
        .update({ status: "enviado", enviado_em: new Date().toISOString() })
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
