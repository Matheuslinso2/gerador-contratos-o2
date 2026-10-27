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
// conferido em 16/10; trocado em 27/10/2026 pelo link certo das cláusulas
// de aprovado (enviado ao Matheus pela equipe).
export const LINK_CLAUSULAS = "https://drive.google.com/drive/folders/1E-ZupsEkMThKurjRip5Kdw1pNpQYybQk";

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
  recusadasComCarta?: string[]; // seguradoras recusadas cujas cartas vão anexas (caso real: Rayane, 15/10)
}): string {
  return envolver(`
      <p>Olá, tudo bem?</p>
      <p>Cliente <b>${escaparHtml(p.inquilino)}</b> <b style="${LARANJA}">${p.status}! ✅🎉</b></p>
      <p>O prazo das cartas aprovadas <b>tem validade até o dia ${escaparHtml(p.validade)}.</b></p>
      <p><img src="${p.imagemSrc}" alt="Panorama de preços" style="width:100%;max-width:900px;height:auto;border:1px solid #d9d9d9;border-radius:6px;" /></p>
      <p><b><i>(PANORAMA DISPONÍVEL EM ANEXO)</i></b></p>
      <p>✅ <b>Atenção:</b> As cláusulas obrigatórias para inclusão no contrato e as condições gerais encontram-se no link abaixo:<br /><a href="${LINK_CLAUSULAS}">${LINK_CLAUSULAS}</a></p>
      <p><b><i>É fundamental que todas as pessoas que irão residir no imóvel sejam devidamente informadas no momento da análise cadastral, seja como locatários solidários ou moradores sem composição de renda. Essa inclusão garante maior transparência e segurança jurídica para todas as partes, além de evitar divergências futuras quanto às responsabilidades pelo uso do imóvel.</i></b></p>
      <p>⚠️ <b>Importante:</b> O valor pode sofrer reajuste conforme a vigência do contrato. Também pode haver alteração no plano de pagamento considerando possível redução de parcelas, impactando o valor cotado (para mais ou para menos).</p>
      ${p.biometrias.map(blocoBiometria).join("\n")}
      ${p.recusadasComCarta?.length ? `<p>📎 Seguem anexas as cartas de recusa das demais seguradoras consultadas: <b>${escaparHtml(p.recusadasComCarta.join(", "))}</b>.</p>` : ""}
      ${blocoObservacoes(p.observacoes)}
      <p>🚨🚨🚨 Ler atentamente as informações em anexo</p>`);
}

// -- Recusa e pendências (16/10/2026) ---------------------------------------
// Mesmos textos do modelo "Fiança — Recusado" / "Fiança — Pendências +
// Recusas" do E-mail no card (lib/bitrix/modelosEmail.ts) e dos e-mails
// reais da equipe (Kelly, casos Soraia Fuchs e Ginga Tropical, 16/10).

const LARANJA = "color:#f8540d;";

// Ficha pública de Capitalização -- sugerida como alternativa na recusa.
export const LINK_FICHA_CAPITALIZACAO = "https://contratos.o2seguros.com.br/capitalizacao";

export type TipoEmail = "aprovado" | "recusado" | "pendencias";

function blocoObservacoes(observacoes: string): string {
  return observacoes.trim() ? `<p>${escaparHtml(observacoes.trim()).replace(/\n/g, "<br />")}</p>` : "";
}

function envolver(corpo: string): string {
  return `
    <div style="font-family:verdana,sans-serif;font-size:small;line-height:1.5;color:#073763;">
      ${corpo}
      <p>Atenciosamente,</p>
      <div><i><b>AVISO LEGAL</b> ${AVISO_LEGAL}</i></div>
    </div>`;
}

// Seguradoras (com o plano, quando houver) recusadas no card -- vão citadas
// no texto e é delas que o colaborador anexa as cartas.
// Seguradora com TODOS os planos recusados aparece só pelo nome ("Porto");
// com recusa parcial, cita o plano ("Porto Essencial 20").
export function seguradorasRecusadas(linhas: { chave: string; status: string }[]): string[] {
  const recusa = (s: string) => s === "recusado" || s === "limite_insuficiente";
  const resultado: string[] = [];
  const porSeguradora = new Map<string, { plano: string | null; status: string }[]>();
  for (const l of linhas) {
    if (l.status === "oculto") continue;
    const d = LINHAS_PANORAMA.find((x) => x.chave === l.chave)!;
    porSeguradora.set(d.seguradora, [...(porSeguradora.get(d.seguradora) ?? []), { plano: d.plano, status: l.status }]);
  }
  for (const [seguradora, planos] of porSeguradora) {
    if (planos.every((p) => recusa(p.status))) resultado.push(seguradora);
    else for (const p of planos) if (recusa(p.status)) resultado.push(p.plano ? `${seguradora} ${p.plano}` : seguradora);
  }
  return resultado;
}

// A Porto é a única seguradora que fornece telefone para consultar o motivo
// da recusa (informado pelo Matheus em 22/10/2026) -- a frase só entra quando
// a Porto está entre as recusadas, e já vem pronta.
export const TELEFONE_PORTO = "0800 727 0901";
export const temRecusaDaPorto = (recusadas: string[]) => recusadas.some((s) => s.startsWith("Porto"));

export function montarHtmlEmailRecusa(p: {
  inquilino: string;
  recusadas: string[]; // seguradoras recusadas no card (ver seguradorasRecusadas)
  observacoes: string;
}): string {
  const contato = temRecusaDaPorto(p.recusadas)
    ? `<p><b>Para maiores esclarecimentos, por gentileza, entrar em contato com a </b><b style="${LARANJA}">Porto Seguro</b><b> através do telefone ${TELEFONE_PORTO}.</b></p>`
    : "";
  return envolver(`
      <p>Prezados, tudo bem?</p>
      <p><b style="${LARANJA}">RECUSADO! 😓</b></p>
      <p>Infelizmente <b style="${LARANJA}">${escaparHtml(p.inquilino)}</b>, foi recusado.</p>
      <p>Seguem cartas recusas.</p>
      ${contato}
      <p>De modo a orientar e viabilizar a locação, mediante a recusa, sugerimos o <b style="${LARANJA}">Título de Capitalização</b>.</p>
      <p>Garantia sem perda pecuniária para o locatário, pois, o mesmo resgata o valor corrigido ao fim da locação.</p>
      <p>Vale ressaltar que a partir de R$ 6.000,00, a Seguradora atua com seu jurídico, no tocante à ação de despejo. O que de certa forma é muito conveniente para a imobiliária e locador, que não se preocuparão com a demanda judicial.</p>
      <p>👉 Para seguir com o Título de Capitalização, preencha a ficha: <a href="${LINK_FICHA_CAPITALIZACAO}">${LINK_FICHA_CAPITALIZACAO}</a></p>
      ${blocoObservacoes(p.observacoes)}`);
}

export function montarHtmlEmailPendencias(p: {
  inquilino: string;
  seguradoraPendente: string;
  documentos: string; // um por linha
  recusadas: string[];
  observacoes: string;
}): string {
  const itens = p.documentos
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `<li>${escaparHtml(d)}</li>`)
    .join("");
  return envolver(`
      <p>Prezados, tudo bem? 😀</p>
      <p><b style="${LARANJA}">⏳ SOLICITAÇÃO DE DOCUMENTOS</b></p>
      <p>Temos uma atualização sobre a análise do cliente <b style="${LARANJA}">${escaparHtml(p.inquilino)}</b>.</p>
      <p>A seguradora <b style="${LARANJA}">${escaparHtml(p.seguradoraPendente.trim() || "[SEGURADORA]")}</b> solicitou documentos complementares para dar continuidade à análise. Com isso, será necessário o envio dos seguintes documentos:</p>
      <ul>${itens || "<li>[documentos]</li>"}</ul>
      <p><b>📎 Segue anexa a carta de pendência para conhecimento.</b></p>
      ${p.recusadas.length ? `<p>Informamos também que houve recusa nas demais seguradoras consultadas: <b style="${LARANJA}">${escaparHtml(p.recusadas.join(", "))}</b>, conforme cartas anexas.</p>` : ""}
      <p>Ficamos no aguardo da documentação para prosseguirmos com a análise e buscarmos a possibilidade de aceitação do cliente.</p>
      ${blocoObservacoes(p.observacoes)}`);
}

export function assuntoPorTipo(tipo: TipoEmail, inquilino: string, imobiliaria: string, status: StatusEmail): string {
  const nome = inquilino.toUpperCase();
  if (tipo === "recusado") return `ANÁLISE FIANÇA - ${nome} - RECUSADO`;
  if (tipo === "pendencias") return `PENDÊNCIAS - SOLICITAÇÃO DE DOCUMENTOS - ${nome}${imobiliaria ? ` - ${imobiliaria.toUpperCase()}` : ""}`;
  return assuntoSugerido(inquilino, status);
}
