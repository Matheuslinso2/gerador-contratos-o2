import { FONTE, O2_CINZA_ESCURO, O2_CINZA_MEDIO, O2_LARANJA } from "@/lib/integracoes/emailO2";
import { dataBr, enderecoDoClique, resumoEmTexto, type DadosPanorama } from "./panoramaCampanha";

// E-mail de PARCIAL de uma campanha com metas: um texto da equipe + a imagem do
// PANORAMA da imobiliária (versão gravada em campanhas_panoramas) + os mesmos
// números em texto, para quem bloqueia imagens. Cada imobiliária recebe só os
// PRÓPRIOS números.
//
// 03/11/2026: o texto inicial já vem PREENCHIDO (HTML editável no editor rico),
// com campos {nome}, {campanha}, {data}, o marcador {{panorama}} e um botão
// ("Falar com a nossa equipe") com link configurável. Trechos entre ** viram
// negrito, sem asteriscos, na prévia e no e-mail recebido (mesma função).

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const TOKEN_PANORAMA = "{{panorama}}";
// Contato da equipe (mesmo WhatsApp do site). Editável no próprio botão, antes do envio.
export const LINK_PADRAO_BOTAO = "https://wa.me/5521979349415";

const ESTILO_LINHA = `padding:6px 28px;font-size:14px;color:${O2_CINZA_ESCURO};font-family:${FONTE};line-height:1.6;`;
const linha = (conteudo: string) => `<tr><td style="${ESTILO_LINHA}">${conteudo}</td></tr>`;

const BOTAO = (texto: string, href: string) =>
  `<a href="${href}" contenteditable="false" data-botao="1" style="display:inline-block;background:${O2_LARANJA};color:#ffffff;font-family:${FONTE};font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:999px;margin:8px 0;">${texto}</a>`;

// Texto inicial (pedido de 03/11/2026). Fica no editor para ser alterado antes do envio.
export const TEXTO_PADRAO_PARCIAL_HTML = [
  linha("<b>Olá, parceiro O2!</b>"),
  linha("Segue o acompanhamento da <b>{nome}</b> na campanha <b>{campanha}</b>, com os números até <b>{data}</b>."),
  linha("Cada nova contratação aproxima vocês da meta! Aproveitem as próximas locações para oferecer Capitalização e Seguro Fiança aos clientes."),
  linha("<b>Ao atingir a meta, vocês conquistam:</b>"),
  linha("🏆 <b>Troféu Exclusivo O2 Elite – 2026</b>"),
  linha("🎥 <b>Vídeo de marketing:</b> gravação profissional no escritório de vocês sobre a trajetória da imobiliária, para uso nas redes e mídias da O2."),
  linha("📊 <b>Confira sua parcial abaixo:</b>"),
  linha(`<span class="merge-token" contenteditable="false">${TOKEN_PANORAMA}</span>`),
  linha(BOTAO("Falar com a nossa equipe", LINK_PADRAO_BOTAO)),
].join("");

/** Destinos (href) dos botões do texto, na ordem em que aparecem. Só botões marcados com data-botao. */
export function extrairBotoes(html: string): string[] {
  const destinos: string[] = [];
  const re = /<a\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!/data-botao/i.test(m[0])) continue;
    const href = m[0].match(/href\s*=\s*"([^"]*)"/i);
    destinos.push(href ? href[1].replace(/&amp;/g, "&") : "");
  }
  return destinos;
}

/** Destino permitido para redirecionar (nunca um esquema perigoso como javascript:). */
export function destinoSeguro(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : null;
}

/** Faz cada botão passar pelo endereço rastreado do panorama (o destino real fica no texto salvo). */
function rastrearBotoes(html: string, token: string): string {
  let i = 0;
  return html.replace(/<a\b[^>]*>/gi, (tag) => {
    if (!/data-botao/i.test(tag)) return tag;
    const novo = enderecoDoClique(token, i++);
    return /href\s*=\s*"[^"]*"/i.test(tag) ? tag.replace(/href\s*=\s*"[^"]*"/i, 'href="' + novo + '"') : tag;
  });
}

/** Trechos entre ** viram negrito (e os asteriscos somem). */
export function aplicarNegrito(html: string): string {
  return html.replace(/\*\*([^*][\s\S]*?)\*\*/g, "<b>$1</b>");
}

/** Troca {nome}, {campanha} e {data} pelos dados da imobiliária (já escapados) e aplica o negrito. */
export function aplicarTexto(html: string, d: DadosPanorama): string {
  const t = html
    .replace(/\{nome\}/gi, escapar(d.participante))
    .replace(/\{campanha\}/gi, escapar(d.campanha))
    .replace(/\{data\}/gi, dataBr(d.posicaoEm));
  return aplicarNegrito(t);
}

function blocoPanorama(d: DadosPanorama, imagemUrl: string): string {
  const alt = `Panorama da ${d.participante} na campanha ${d.campanha}: ${resumoEmTexto(d)}`;
  return `
    <tr>
      <td style="padding:12px 28px 0;" align="center">
        <img src="${imagemUrl}" width="544" alt="${escapar(alt)}" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:12px;" />
        <p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${O2_CINZA_MEDIO};font-family:${FONTE};">${escapar(resumoEmTexto(d))}</p>
      </td>
    </tr>`;
}

/** Texto (linhas <tr>) com o marcador {{panorama}} trocado pelo panorama; sem marcador, o panorama vai ao fim do texto.
 *  Marcador repetido nunca aparece cru: só o primeiro vira o panorama, os demais somem. */
export function montarCorpoParcial(textoHtml: string, d: DadosPanorama, imagemUrl: string, token?: string): { corpoHtml: string; semMarcador: boolean } {
  const preenchido0 = aplicarTexto(textoHtml, d);
  // Com token, os botões passam pelo rastreador (clique registrado só depois do envio real).
  const preenchido = token ? rastrearBotoes(preenchido0, token) : preenchido0;
  const bloco = blocoPanorama(d, imagemUrl);
  const tira = (l: string) => l.replace(/<span[^>]*merge-token[^>]*>\s*\{\{panorama\}\}\s*<\/span>/gi, "").split(TOKEN_PANORAMA).join("");
  const temTexto = (l: string) => l.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
  let achou = false;
  const saida = preenchido.split(/(?<=<\/tr>)/i).map((l) => {
    if (!l.includes(TOKEN_PANORAMA)) return l;
    const resto = tira(l);
    const sobra = temTexto(resto) ? resto : "";
    if (achou) return sobra;
    achou = true;
    return sobra + bloco;
  });
  return { corpoHtml: (achou ? saida.join("") : saida.join("") + bloco) + `<tr><td style="padding:12px 0 0;"></td></tr>`, semMarcador: !achou };
}

export function montarEmailParcial(d: DadosPanorama, textoHtml: string, imagemUrl: string, token?: string) {
  const { corpoHtml } = montarCorpoParcial(textoHtml, d, imagemUrl, token);
  return {
    nome: `Parcial ${d.versao} — ${d.campanha} — ${d.participante} (${dataBr(d.posicaoEm).slice(0, 5)})`,
    assunto: `Parcial da campanha ${d.campanha} — ${d.participante}`,
    titulo: d.campanha,
    introducao: `Campanha de ${dataBr(d.inicio)} a ${dataBr(d.fim)} · produção apurada até ${dataBr(d.apuradoAte)}`,
    corpoHtml,
  };
}
