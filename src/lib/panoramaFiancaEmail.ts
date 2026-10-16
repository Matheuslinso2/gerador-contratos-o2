// Corpo do e-mail do Panorama de Preços do Seguro Fiança (Fase 2,
// 16/10/2026). Usado na prévia da janela de envio (navegador) e no envio de
// verdade (servidor) -- por isso sem nenhuma dependência de servidor.
// Texto montado a partir de 5 e-mails reais de aprovação da equipe (Kelly,
// Cassia, Rayane, Carlos; 09-16/10/2026). Spec:
// seguro-fianca-analise/ESPECIFICACAO-ENVIO-EMAIL-PANORAMA-FIANCA.md

import { LINHAS_PANORAMA, statusEditavel, type LinhaPanorama } from "@/lib/panoramaFiancaConstantes";

// Mesmo texto do AVISO LEGAL que a equipe usa na assinatura do Gmail (e que
// o "E-mail no card" também usa).
export const AVISO_LEGAL =
  "Esta mensagem é destinada exclusivamente para a(s) pessoa(s) a quem é dirigida, podendo conter informação confidencial e/ou legalmente privilegiada. Se você não for o destinatário desta mensagem, desde já fica notificado de abster-se a divulgar, copiar, distribuir, examinar ou, de qualquer forma, utilizar a informação contida nesta mensagem, por ser ilegal. Caso você tenha recebido esta mensagem por engano, pedimos que nos retorne este E-Mail, promovendo, desde logo, a eliminação do seu conteúdo em sua base de dados, registros ou sistema de controle.";

// Pasta única com cláusulas e condições gerais de TODAS as seguradoras --
// conferido em 16/10: os 5 e-mails reais usam este mesmo link.
export const LINK_CLAUSULAS = "https://drive.google.com/drive/folders/1E8vR_TdZ0uIeiX6f9iEBQf66DhKUlbP3";

export const EMAIL_FIANCA = "fianca@o2seguros.com.br";

export type StatusEmail = "PRÉ-APROVADO" | "APROVADO";
export type BiometriaSeguradora = { seguradora: string; link: string };

// Seguradoras (sem repetir plano: Porto Tradicional/Essencial = "Porto")
// com pelo menos uma linha aprovada/pré-aprovada no panorama.
export function seguradorasAprovadas(linhas: LinhaPanorama[]): string[] {
  const nomes = linhas
    .filter((l) => statusEditavel(l.status))
    .map((l) => LINHAS_PANORAMA.find((d) => d.chave === l.chave)!.seguradora);
  return [...new Set(nomes)];
}

// PRÉ-APROVADO é o mais comum nos e-mails reais; APROVADO só quando tudo o
// que aparece aprovado no panorama está "Aprovado" no Bitrix.
export function statusSugerido(linhas: LinhaPanorama[]): StatusEmail {
  const ativas = linhas.filter((l) => statusEditavel(l.status));
  return ativas.length && ativas.every((l) => l.status === "aprovado") ? "APROVADO" : "PRÉ-APROVADO";
}

export function assuntoSugerido(inquilino: string, status: StatusEmail): string {
  return `ANÁLISE FIANÇA - ${inquilino.toUpperCase()} - ${status}`;
}

export function escaparHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Tokio não manda link: a seguradora dispara pro celular cadastrado.
const ehTokio = (seguradora: string) => seguradora.toLowerCase().startsWith("tokio");

function blocoBiometria(b: BiometriaSeguradora): string {
  const nome = b.seguradora.toUpperCase();
  if (ehTokio(b.seguradora)) {
    return `<p><b>BIOMETRIA FACIAL ${nome} - </b>Informamos que será necessário realizar a validação de biometria solicitada pela <b>Tokio</b> Seguros. O link é encaminhado pela seguradora ao número de celular cadastrado.</p>`;
  }
  const link = escaparHtml(b.link.trim());
  return `<p><b>BIOMETRIA FACIAL ${nome} - </b>Informamos que será necessário realizar a validação de biometria através do link:<br /><a href="${link}">${link}</a></p>`;
}

export const precisaLinkBiometria = (seguradora: string) => !ehTokio(seguradora);

// imagemSrc: "cid:panorama" no envio real; data URL na prévia da tela.
export function montarHtmlEmailPanorama(p: {
  inquilino: string;
  status: StatusEmail;
  validade: string; // "dd/mm"
  imagemSrc: string;
  biometrias: BiometriaSeguradora[]; // só as que vão no e-mail (Tokio marcada, ou com link)
  observacoes: string;
}): string {
  const laranja = "color:#f8540d;";
  const obs = p.observacoes.trim()
    ? `<p>${escaparHtml(p.observacoes.trim()).replace(/\n/g, "<br />")}</p>`
    : "";
  return `
    <div style="font-family:verdana,sans-serif;font-size:small;line-height:1.5;color:#073763;">
      <p>Olá, tudo bem?</p>
      <p>Cliente <b>${escaparHtml(p.inquilino)}</b> <b style="${laranja}">${p.status}! ✅🎉</b></p>
      <p>O prazo das cartas aprovadas <b>tem validade até o dia ${escaparHtml(p.validade)}.</b></p>
      <p><img src="${p.imagemSrc}" alt="Panorama de preços" style="width:100%;max-width:900px;height:auto;border:1px solid #d9d9d9;border-radius:6px;" /></p>
      <p><b><i>(PANORAMA DISPONÍVEL EM ANEXO)</i></b></p>
      <p>✅ <b>Atenção:</b> As cláusulas obrigatórias para inclusão no contrato e as condições gerais encontram-se no link abaixo:<br /><a href="${LINK_CLAUSULAS}">${LINK_CLAUSULAS}</a></p>
      <p><b><i>É fundamental que todas as pessoas que irão residir no imóvel sejam devidamente informadas no momento da análise cadastral, seja como locatários solidários ou moradores sem composição de renda. Essa inclusão garante maior transparência e segurança jurídica para todas as partes, além de evitar divergências futuras quanto às responsabilidades pelo uso do imóvel.</i></b></p>
      <p>⚠️ <b>Importante:</b> O valor pode sofrer reajuste conforme a vigência do contrato. Também pode haver alteração no plano de pagamento considerando possível redução de parcelas, impactando o valor cotado (para mais ou para menos).</p>
      ${p.biometrias.map(blocoBiometria).join("\n")}
      ${obs}
      <p>🚨🚨🚨 Ler atentamente as informações em anexo</p>
      <p>Atenciosamente,</p>
      <div><i><b>AVISO LEGAL</b> ${AVISO_LEGAL}</i></div>
    </div>`;
}
