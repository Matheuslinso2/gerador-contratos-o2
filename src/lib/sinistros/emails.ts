import { enviarEmail } from "@/lib/email";
import { blocoSecao, botaoPill, envolverEmailO2, linhaCampo } from "@/lib/integracoes/emailO2";
import { ETAPAS, tituloTipo, formatarData, formatarReais, type EtapaSinistro, type TipoSinistro } from "./regras";

// Caixa do Setor de Garantias -- é pra onde os avisos de sinistro já vão
// hoje por e-mail (Manual de Abertura de Sinistro, ago/2026).
const EMAIL_O2 = process.env.SINISTROS_EMAIL_O2 || "sinistro@o2seguros.com.br";
// Grupo da Capitalização: entra em toda notificação de sinistro de Capitalização
// (inclusive resgate) -- pedido do Matheus, 28/10/2026.
const EMAIL_CAP = process.env.SINISTROS_EMAIL_CAP || "cap@o2seguros.com.br";
const ehCap = (s: { produto?: string | null }) => s.produto === "capitalizacao";

function urlSinistro(id: string) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://gerador-contratos-o2.vercel.app";
  return `${base.replace(/\/$/, "")}/sinistros/${id}`;
}

// Rodando local (dev), os e-mails do sinistro só vão pro log -- testar o
// fluxo não pode disparar e-mail de verdade pra equipe nem pra imobiliária.
function ehAmbienteLocal() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "").includes("localhost");
}

// cap = sinistro de Capitalização: o grupo cap@ recebe junto (nos e-mails para a
// O2 como destinatário; nos e-mails para a imobiliária, em cópia oculta).
async function enviar(para: string[], assunto: string, html: string, cap = false) {
  const paraO2 = para.some((e) => e.trim().toLowerCase() === EMAIL_O2.toLowerCase());
  let destinos = [...new Set([...para, ...(cap && paraO2 ? [EMAIL_CAP] : [])].map((e) => e.trim().toLowerCase()).filter(Boolean))];
  // Imobiliária sem e-mail cadastrado: o grupo da Capitalização ainda recebe.
  if (!destinos.length && cap) destinos = [EMAIL_CAP.toLowerCase()];
  if (!destinos.length) return;
  const bcc = cap && !paraO2 && !destinos.includes(EMAIL_CAP.toLowerCase()) ? [EMAIL_CAP] : undefined;
  if (ehAmbienteLocal()) {
    console.log(`[sinistros] e-mail (local, não enviado) para ${destinos.join(", ")}${bcc ? ` (cco ${bcc.join(", ")})` : ""}: ${assunto}`);
    return;
  }
  await enviarEmail({ para: destinos, bcc, assunto, html, remetente: "O2 Seguros — Sinistros", replyTo: EMAIL_O2 });
}

export type SinistroEmail = {
  id: string;
  codigo: number;
  tipo: TipoSinistro | null;
  produto?: string | null;
  etapa: EtapaSinistro;
  seguradora: string | null;
  numero_apolice: string | null;
  locatario_nome: string | null;
  imovel_logradouro: string | null;
  imovel_numero: string | null;
  imovel_complemento: string | null;
  prazo_aviso: string | null;
  aviso_fora_prazo: boolean;
  valor_avisado: number | null;
  numero_sinistro_seguradora: string | null;
  criado_por_email: string | null;
};

function endereco(s: SinistroEmail) {
  return [s.imovel_logradouro, s.imovel_numero, s.imovel_complemento].filter(Boolean).join(", ");
}

function resumo(s: SinistroEmail, imobiliariaNome?: string) {
  return blocoSecao(
    "Sinistro",
    [
      linhaCampo("Protocolo O2", `SIN-${s.codigo}`),
      imobiliariaNome ? linhaCampo("Imobiliária", imobiliariaNome) : "",
      linhaCampo("Tipo", tituloTipo(s.tipo)),
      linhaCampo("Seguradora", s.seguradora ?? ""),
      linhaCampo("Apólice", s.numero_apolice ?? ""),
      linhaCampo("Locatário", s.locatario_nome ?? ""),
      linhaCampo("Imóvel", endereco(s)),
      s.valor_avisado ? linhaCampo("Valor avisado", formatarReais(s.valor_avisado)) : "",
      s.numero_sinistro_seguradora ? linhaCampo("Nº do aviso na seguradora", s.numero_sinistro_seguradora) : "",
    ].join("")
  );
}

function listaHtml(itens: string[]) {
  if (!itens.length) return "";
  return `
    <tr><td style="padding:18px 28px 0;">
      <ul style="margin:0;padding-left:20px;font-size:14px;color:#444440;font-family:'Poppins',Arial,sans-serif;line-height:1.6;">
        ${itens.map((i) => `<li>${escapar(i)}</li>`).join("")}
      </ul>
    </td></tr>`;
}

function paragrafo(texto: string) {
  if (!texto.trim()) return "";
  return `<tr><td style="padding:18px 28px 0;"><p style="margin:0;font-size:14px;color:#444440;font-family:'Poppins',Arial,sans-serif;line-height:1.6;white-space:pre-wrap;">${escapar(texto)}</p></td></tr>`;
}

function escapar(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function emailNovoSinistroParaO2(s: SinistroEmail, imobiliariaNome: string, faltando: string[]) {
  const html = envolverEmailO2({
    badge: s.aviso_fora_prazo ? "Novo sinistro · fora do prazo" : "Novo sinistro",
    titulo: `${imobiliariaNome} avisou um sinistro`,
    introducao: `Aviso enviado pelo Workspace. Prazo de aviso: ${formatarData(s.prazo_aviso)}.`,
    corpoHtml:
      resumo(s, imobiliariaNome) +
      (faltando.length ? paragrafo(`Documentos obrigatórios ainda faltando (${faltando.length}):`) + listaHtml(faltando) : "") +
      botaoPill(urlSinistro(s.id), "Abrir pré-análise"),
    protocolo: `SIN-${s.codigo}`,
    origem: "Módulo Sinistro",
  });
  await enviar([EMAIL_O2], `Novo sinistro SIN-${s.codigo} — ${imobiliariaNome} — ${s.locatario_nome ?? "locatário não informado"}`, html, ehCap(s));
}

export async function emailRespostaPendenciaParaO2(s: SinistroEmail, imobiliariaNome: string, mensagem: string) {
  const html = envolverEmailO2({
    badge: "Pendência respondida",
    titulo: `${imobiliariaNome} respondeu a pendência`,
    introducao: "O sinistro voltou para a pré-análise da O2.",
    corpoHtml: resumo(s, imobiliariaNome) + paragrafo(mensagem) + botaoPill(urlSinistro(s.id), "Ver sinistro"),
    protocolo: `SIN-${s.codigo}`,
    origem: "Módulo Sinistro",
  });
  await enviar([EMAIL_O2], `Pendência respondida SIN-${s.codigo} — ${imobiliariaNome}`, html, ehCap(s));
}

export async function emailPendenciaParaImobiliaria(
  s: SinistroEmail,
  destinos: string[],
  itens: string[],
  mensagem: string,
  prazo: string
) {
  const html = envolverEmailO2({
    badge: "Pendência no sinistro",
    titulo: "Precisamos de alguns ajustes",
    introducao: `Para seguirmos com o sinistro de ${escapar(s.locatario_nome ?? "locatário não informado")}, responda pelo Workspace até ${formatarData(prazo)}.`,
    corpoHtml: resumo(s) + listaHtml(itens) + paragrafo(mensagem) + botaoPill(urlSinistro(s.id), "Resolver pendência"),
    protocolo: `SIN-${s.codigo}`,
    origem: "Módulo Sinistro",
  });
  await enviar(destinos, `Pendência no sinistro SIN-${s.codigo} — ${s.locatario_nome ?? "locatário não informado"}`, html, ehCap(s));
}

export async function emailAtualizacaoParaImobiliaria(s: SinistroEmail, destinos: string[], titulo: string, texto: string, itens: string[] = []) {
  const html = envolverEmailO2({
    badge: ETAPAS[s.etapa].tituloImobiliaria,
    titulo,
    introducao: `Sinistro de ${escapar(s.locatario_nome ?? "locatário não informado")}.`,
    corpoHtml: resumo(s) + paragrafo(texto) + listaHtml(itens) + botaoPill(urlSinistro(s.id), "Acompanhar no Workspace"),
    protocolo: `SIN-${s.codigo}`,
    origem: "Módulo Sinistro",
  });
  await enviar(destinos, `${titulo} — SIN-${s.codigo} — ${s.locatario_nome ?? "locatário não informado"}`, html, ehCap(s));
}

// Resumo diário dos alertas automáticos (vencimento da apólice e parcelas de
// acordo) para a caixa do Setor de Garantias -- reunião 21/10/2026.
export async function emailAlertasParaO2(itens: { id: string; codigo: number; texto: string; produto?: string | null }[]) {
  if (!itens.length) return;
  // Cópia só com os alertas de Capitalização para o grupo cap@.
  const dosCap = itens.filter((i) => i.produto === "capitalizacao");
  if (dosCap.length) await enviarResumoAlertas(dosCap, [EMAIL_CAP]);
  await enviarResumoAlertas(itens, [EMAIL_O2]);
}

async function enviarResumoAlertas(itens: { id: string; codigo: number; texto: string }[], para: string[]) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://gerador-contratos-o2.vercel.app").replace(/\/$/, "");
  const html = envolverEmailO2({
    badge: "Alertas de sinistros",
    titulo: `${itens.length} alerta(s) para hoje`,
    introducao: "Vencimento de apólice e parcelas de acordo para conferir. Cada item já entrou na agenda do responsável.",
    corpoHtml:
      listaHtml(itens.map((i) => `SIN-${i.codigo}: ${i.texto}`)) +
      botaoPill(`${base}/sinistros/gestao?ordem=agenda`, "Abrir a agenda na Gestão"),
    protocolo: "Alertas",
    origem: "Módulo Sinistro",
  });
  await enviar(para, `Sinistros — ${itens.length} alerta(s) para hoje`, html);
}

// Tela de visualização (22/10/2026): notificação de mensagem recebida no chat
// e de novo documento anexado para validação, sempre para sinistro@ com a
// identidade O2 (nº do aviso ou SIN no protocolo).
export async function emailNovidadeParaO2(
  s: SinistroEmail,
  imobiliariaNome: string,
  tipo: "mensagem" | "documento",
  detalhe: string
) {
  const protocolo = s.numero_sinistro_seguradora ? `Aviso ${s.numero_sinistro_seguradora}` : `SIN-${s.codigo}`;
  const mensagem = tipo === "mensagem";
  const html = envolverEmailO2({
    badge: mensagem ? "Mensagem no chat" : "Novo documento para validação",
    titulo: mensagem ? `${imobiliariaNome} enviou uma mensagem` : `${imobiliariaNome} anexou um documento para validação`,
    introducao: mensagem ? "Nova mensagem no chat do sinistro." : "Um novo documento aguarda aceite ou recusa da O2.",
    corpoHtml: resumo(s, imobiliariaNome) + paragrafo(detalhe) + botaoPill(urlSinistro(s.id), mensagem ? "Responder no chat" : "Validar documento"),
    protocolo,
    origem: "Módulo Sinistro",
  });
  await enviar([EMAIL_O2], `${mensagem ? "Mensagem no chat" : "Novo documento para validação"} — ${protocolo} — ${imobiliariaNome}`, html, ehCap(s));
}
