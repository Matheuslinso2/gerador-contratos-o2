import { enviarEmail } from "@/lib/email";
import { blocoSecao, botaoPill, envolverEmailO2, linhaCampo } from "@/lib/integracoes/emailO2";
import { ETAPAS, TIPOS, formatarData, formatarReais, type EtapaSinistro, type TipoSinistro } from "./regras";

// Caixa do Setor de Garantias -- é pra onde os avisos de sinistro já vão
// hoje por e-mail (Manual de Abertura de Sinistro, ago/2026).
const EMAIL_O2 = process.env.SINISTROS_EMAIL_O2 || "sinistro@o2seguros.com.br";

function urlSinistro(id: string) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://gerador-contratos-o2.vercel.app";
  return `${base.replace(/\/$/, "")}/sinistros/${id}`;
}

// Rodando local (dev), os e-mails do sinistro só vão pro log -- testar o
// fluxo não pode disparar e-mail de verdade pra equipe nem pra imobiliária.
function ehAmbienteLocal() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "").includes("localhost");
}

async function enviar(para: string[], assunto: string, html: string) {
  const destinos = [...new Set(para.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!destinos.length) return;
  if (ehAmbienteLocal()) {
    console.log(`[sinistros] e-mail (local, não enviado) para ${destinos.join(", ")}: ${assunto}`);
    return;
  }
  await enviarEmail({ para: destinos, assunto, html, remetente: "O2 Seguros — Sinistros", replyTo: EMAIL_O2 });
}

export type SinistroEmail = {
  id: string;
  codigo: number;
  tipo: TipoSinistro;
  etapa: EtapaSinistro;
  seguradora: string;
  numero_apolice: string | null;
  locatario_nome: string;
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
      linhaCampo("Tipo", TIPOS[s.tipo].titulo),
      linhaCampo("Seguradora", s.seguradora),
      linhaCampo("Apólice", s.numero_apolice ?? ""),
      linhaCampo("Locatário", s.locatario_nome),
      linhaCampo("Imóvel", endereco(s)),
      s.valor_avisado ? linhaCampo("Valor avisado", formatarReais(s.valor_avisado)) : "",
      s.numero_sinistro_seguradora ? linhaCampo("Nº do sinistro na seguradora", s.numero_sinistro_seguradora) : "",
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
  await enviar([EMAIL_O2], `Novo sinistro SIN-${s.codigo} — ${imobiliariaNome} — ${s.locatario_nome}`, html);
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
  await enviar([EMAIL_O2], `Pendência respondida SIN-${s.codigo} — ${imobiliariaNome}`, html);
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
    introducao: `Para seguirmos com o sinistro de ${escapar(s.locatario_nome)}, responda pelo Workspace até ${formatarData(prazo)}.`,
    corpoHtml: resumo(s) + listaHtml(itens) + paragrafo(mensagem) + botaoPill(urlSinistro(s.id), "Resolver pendência"),
    protocolo: `SIN-${s.codigo}`,
    origem: "Módulo Sinistro",
  });
  await enviar(destinos, `Pendência no sinistro SIN-${s.codigo} — ${s.locatario_nome}`, html);
}

export async function emailAtualizacaoParaImobiliaria(s: SinistroEmail, destinos: string[], titulo: string, texto: string, itens: string[] = []) {
  const html = envolverEmailO2({
    badge: ETAPAS[s.etapa].tituloImobiliaria,
    titulo,
    introducao: `Sinistro de ${escapar(s.locatario_nome)}.`,
    corpoHtml: resumo(s) + paragrafo(texto) + listaHtml(itens) + botaoPill(urlSinistro(s.id), "Acompanhar no Workspace"),
    protocolo: `SIN-${s.codigo}`,
    origem: "Módulo Sinistro",
  });
  await enviar(destinos, `${titulo} — SIN-${s.codigo} — ${s.locatario_nome}`, html);
}
