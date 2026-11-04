import "server-only";

import { listarMensagensComAnexos, baixarAnexo, type AnexoGmail, type MensagemGmail } from "@/lib/gestaoEmails/gmail";
import { extrairTextoPdfComPaginas } from "@/lib/extrairTextoPdf";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";
import { auditarContrato, type ClausulaReferencia, type DocumentoAuditoria, type RelatorioAuditoria, type StatusChecklist } from "@/lib/auditorContrato";
import { createServiceClient } from "@/lib/supabase/service";

// Auditoria automática do contrato de locação a partir do card do Seguro Fiança (decisão do Matheus, 04/11/2026): quando o card
// entra em "Contrato Recebido", ~30 min depois o sistema procura no Gmail (caixa que recebe fianca@) o contrato pelo NOME DO
// LOCATÁRIO (o card do Fiança não tem campo de arquivo), roda o Auditor e devolve o parecer completo como comentário no card.

export const ENTITY_TYPE_FIANCA = 1042;
export const ETAPA_CONTRATO_RECEBIDO = "DT1042_20:UC_RD3MTL";
export const ESPERA_MINUTOS = 30;
const DIAS_BUSCA = 25;

type Candidato = { mensagem: MensagemGmail & { anexos: AnexoGmail[] }; anexo: AnexoGmail };

const REGEX_CONTRATO = /contrat|loca[cç][aã]o|aditiv/i;
const REGEX_NAO_CONTRATO = /presta[cç][aã]o.{0,12}servi[cç]|procura[cç][aã]o|certificad|assinaturas|rescis|ficha|panorama|carta|comprov|boleto|ap[oó]lice|vistoria|laudo|cpf|identidade|rg\b|holerite|contracheque/i;
const REGEX_CERTIFICADO = /certificad.*assinatur|assinaturas?.*(certificad|_bg_sheet)|_bg_sheet/i;
const REGEX_COTACAO = /cartaresposta|cota[cç][aã]o|proposta/i;

const dataMs = (m: MensagemGmail) => new Date(m.data as unknown as string).getTime() || 0;
const ehArquivoLegivel = (nome: string) => /\.(pdf|docx)$/i.test(nome);

export type DocumentosLocalizados = {
  documentos: DocumentoAuditoria[];
  arquivos: { papel: string; nome: string; deEmail: string }[];
  avisos: string[];
};

// Texto do contrato: do PDF/DOCX quando tem texto de verdade; PDF escaneado ou carimbo de scanner vai como PDF (leitura visual).
async function paraDocumento(tipo: DocumentoAuditoria["tipo"], nome: string, buffer: Buffer): Promise<DocumentoAuditoria> {
  const ehPdf = /\.pdf$/i.test(nome);
  const visual = tipo === "cotacao" || tipo === "certificado"; // fichas preenchíveis: leitura visual (mesma regra do Auditor da tela)
  if (!ehPdf) return { tipo, nomeArquivo: nome, fonte: { tipo: "texto", texto: await extrairTextoDocx(buffer) } };
  const { texto, numPaginas } = await extrairTextoPdfComPaginas(buffer);
  const insuficiente = !texto.trim() || (numPaginas > 0 && texto.length / numPaginas < 200);
  if (visual || insuficiente) return { tipo, nomeArquivo: nome, fonte: { tipo: "pdf", base64: buffer.toString("base64") } };
  return { tipo, nomeArquivo: nome, fonte: { tipo: "texto", texto } };
}

export async function localizarDocumentosDoCard(card: { titulo: string; endereco?: string | null }): Promise<DocumentosLocalizados> {
  const avisos: string[] = [];
  // Locatários múltiplos aparecem no título separados por "/" (ex: "LUCAS DOS REIS / DENISE DA COSTA"): busca pelo primeiro nome completo.
  const nome = card.titulo.split("/")[0].replace(/[^\p{L}\p{N} .'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (nome.length < 5) return { documentos: [], arquivos: [], avisos: ["Título do card curto demais para procurar o contrato no e-mail."] };

  const consultas = [`has:attachment newer_than:${DIAS_BUSCA}d "${nome}"`];
  if (card.endereco && card.endereco.trim().length > 6) consultas.push(`has:attachment newer_than:${DIAS_BUSCA}d "${card.endereco.trim().replace(/"/g, "")}"`);
  const vistas = new Map<string, MensagemGmail & { anexos: AnexoGmail[] }>();
  for (const q of consultas) {
    for (const m of await listarMensagensComAnexos(q, 25)) vistas.set(m.id as string, m);
  }
  const mensagens = [...vistas.values()].sort((a, b) => dataMs(b) - dataMs(a));

  const contratos: Candidato[] = [];
  const certificados: Candidato[] = [];
  const cotacoes: Candidato[] = [];
  for (const m of mensagens) {
    for (const a of m.anexos) {
      if (!ehArquivoLegivel(a.nome) || a.tamanho < 20_000) continue;
      if (REGEX_CERTIFICADO.test(a.nome)) certificados.push({ mensagem: m, anexo: a });
      else if (REGEX_COTACAO.test(a.nome) && !/contrat/i.test(a.nome)) cotacoes.push({ mensagem: m, anexo: a });
      else if (REGEX_CONTRATO.test(a.nome) && !REGEX_NAO_CONTRATO.test(a.nome)) contratos.push({ mensagem: m, anexo: a });
    }
  }
  if (!contratos.length) return { documentos: [], arquivos: [], avisos: [`Nenhum anexo de contrato de locação encontrado no e-mail para "${nome}" nos últimos ${DIAS_BUSCA} dias.`] };

  // Contrato (+ aditivos) = anexos da mensagem mais recente que traz contrato; certificado = da mesma mensagem (ou o mais recente).
  const msgContrato = contratos[0].mensagem;
  const doContrato = contratos.filter((c) => c.mensagem.id === msgContrato.id);
  const doCertificado = certificados.find((c) => c.mensagem.id === msgContrato.id) ?? certificados[0];
  if (!doCertificado) avisos.push("Certificado de assinatura eletrônica não encontrado no e-mail.");
  if (!cotacoes.length) avisos.push("Cotação/proposta da seguradora não encontrada no e-mail.");

  const documentos: DocumentoAuditoria[] = [];
  const arquivos: DocumentosLocalizados["arquivos"] = [];
  const adicionar = async (tipo: DocumentoAuditoria["tipo"], c: Candidato) => {
    const buffer = await baixarAnexo(c.mensagem.id as string, c.anexo.attachmentId);
    documentos.push(await paraDocumento(tipo, c.anexo.nome, buffer));
    arquivos.push({ papel: tipo, nome: c.anexo.nome, deEmail: String(c.mensagem.assunto ?? "").slice(0, 80) });
  };
  for (const c of doContrato.slice(0, 3)) await adicionar("contrato", c);
  if (doCertificado) await adicionar("certificado", doCertificado);
  // Cotação: a carta cujo nome cita a seguradora do contrato (ex: CartaResposta_Pottencial_...); sem coincidência, até 2 mais recentes
  // (o Auditor sabe ignorar cartas/recusas de OUTRA seguradora).
  const textoContrato = documentos.filter((d) => d.tipo === "contrato" && d.fonte.tipo === "texto").map((d) => (d.fonte as { texto: string }).texto).join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const seguradoras = ["pottencial", "porto", "tokio", "allianz", "yelum", "liberty", "sulamerica", "junto"];
  const doContratoSeg = seguradoras.filter((s) => textoContrato.includes(s));
  const casadas = cotacoes.filter((c) => doContratoSeg.some((s) => c.anexo.nome.toLowerCase().includes(s)));
  for (const c of (casadas.length ? casadas : cotacoes).slice(0, 2)) await adicionar("cotacao", c);
  return { documentos, arquivos, avisos };
}

// Biblioteca oficial (cláusula-base + coberturas adicionais) -- mesma fonte do Auditor da tela.
export async function carregarBiblioteca(): Promise<ClausulaReferencia[]> {
  const sb = createServiceClient();
  const [{ data: produtos }, { data: coberturas }] = await Promise.all([
    sb.from("produtos").select("id, nome, clausula_base, seguradoras(nome)").not("seguradora_id", "is", null),
    sb.from("coberturas_adicionais").select("produto_id, nome, texto"),
  ]);
  return (produtos ?? []).map((p) => {
    const seguradora = Array.isArray(p.seguradoras) ? p.seguradoras[0] : p.seguradoras;
    return {
      seguradora: seguradora?.nome ?? "",
      produto: p.nome,
      clausulaBase: p.clausula_base,
      coberturas: (coberturas ?? []).filter((c) => c.produto_id === p.id).map((c) => ({ nome: c.nome as string, texto: c.texto as string })),
    };
  });
}

const ROTULO: Record<RelatorioAuditoria["status_geral"], string> = {
  APROVADO: "APROVADO",
  APROVADO_RESSALVAS: "APROVADO COM RESSALVAS",
  REPROVADO: "REPROVADO",
};
const ICONE: Record<StatusChecklist, string> = { ok: "OK", atencao: "ATENÇÃO", problema: "PROBLEMA", nao_avaliado: "NÃO AVALIADO" };

// Parecer completo em texto para o comentário do card (Bitrix aceita [B]negrito[/B] e quebra de linha).
export function formatarParecerBitrix(r: RelatorioAuditoria, arquivos: DocumentosLocalizados["arquivos"], avisos: string[]): string {
  const linha = (titulo: string, status: StatusChecklist, resumo: string) => `[B]${titulo}[/B] — ${ICONE[status]}\n${resumo}`;
  const partes: string[] = [
    `[B]PARECER AUTOMÁTICO DO CONTRATO DE LOCAÇÃO — ${ROTULO[r.status_geral]}[/B]`,
    `Locador: ${r.locador_identificado}\nLocatário: ${r.locatario_identificado}\nImóvel: ${r.endereco_identificado}\nGarantia: ${r.tipo_garantia_identificada}`,
    linha("1. Dados cadastrais", r.dados_cadastrais_status, r.dados_cadastrais_resumo),
    linha("2. Dados da locação", r.dados_locacao_status, r.dados_locacao_resumo),
    linha("3. Conferência com a cotação", r.conferencia_cotacao_status, r.conferencia_cotacao_resumo),
    linha("4. Cláusulas da seguradora", r.clausulas_seguradora_status, r.clausulas_seguradora_resumo),
    linha("5. Assinaturas", r.assinaturas_status, r.assinaturas_resumo),
  ];
  if (r.pontos_criticos?.length) partes.push(`[B]PONTOS CRÍTICOS[/B]\n${r.pontos_criticos.map((p) => `• ${p}`).join("\n")}`);
  const paragrafos = (r.paragrafos_texto_oficial ?? []).filter((p) => p.situacao === "divergente" || p.situacao === "ausente");
  if (paragrafos.length) partes.push(`[B]TEXTO OFICIAL DA SEGURADORA — PARÁGRAFOS A REVISAR[/B]\n${paragrafos.map((p) => `• ${p.assunto} (${p.situacao}): ${p.observacao ?? ""}`).join("\n")}`);
  partes.push(`Arquivos analisados (do e-mail): ${arquivos.map((a) => `${a.nome} [${a.papel}]`).join("; ")}`);
  if (avisos.length) partes.push(`Observações: ${avisos.join(" ")}`);
  partes.push("Análise feita pelo Auditor de Contrato do Workspace O2 — apoio à conferência, não substitui a revisão da equipe.");
  return partes.join("\n\n");
}

export async function auditarCardFianca(card: { id: number; titulo: string; endereco?: string | null }) {
  const achados = await localizarDocumentosDoCard(card);
  if (!achados.documentos.some((d) => d.tipo === "contrato")) return { ok: false as const, motivo: achados.avisos.join(" "), ...achados };
  const biblioteca = await carregarBiblioteca();
  const relatorio = await auditarContrato(achados.documentos, biblioteca);
  return { ok: true as const, relatorio, parecer: formatarParecerBitrix(relatorio, achados.arquivos, achados.avisos), ...achados };
}
