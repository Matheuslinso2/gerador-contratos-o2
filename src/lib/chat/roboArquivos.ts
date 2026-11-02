import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { randomUUID } from "node:crypto";
import { normalizar, resolverImobiliarias } from "./roboFerramentas";
import { gerarPdfFotoCard, type FotoCard } from "./fotoCard";

// Entrega de ARQUIVOS (apólice, proposta, endosso, certificado em PDF) pelo chat do Robô O2 (Matheus, 01/11/2026:
// "eu quero a apólice de seguro fiança do cliente X ou do CPF Y e você traz o documento direto no chat pra download").
// Os arquivos já ficam em buckets privados (`anexos-documentos`, vindos do e-mail/Drive/API/Bitrix, e `corp-anexos`, trazidos
// pelo robô do Corp). Aqui só se acha o documento no banco e se gera um LINK ASSINADO TEMPORÁRIO (1 hora) para cada arquivo.
// Só equipe O2 chega aqui. Todo pedido é registrado em `chat_robo_arquivos_log` (quem pediu, o quê, quando).

const VALIDADE_SEG = 60 * 60;
const MAX_DOCUMENTOS = 15;
const MAX_ARQUIVOS = 10;

export const FERRAMENTA_ARQUIVOS: Anthropic.Tool = {
  name: "buscar_arquivos_documento",
  description:
    "Acha o ARQUIVO (PDF) de um documento da base — apólice, proposta, endosso ou certificado — e devolve um link para baixar direto no chat (válido por 1 hora). Com tipo_documento \"card\" devolve a FOTO DO CARD do Bitrix em PDF (campos, histórico de etapas e comentários), inclusive de cards RECUSADOS ou PERDIDOS que podem sumir do funil: busque por numero_card, nome do cliente (título do card), CPF, imobiliária, produto e situacao (recusado, perdido, cotacao, proposta, vigente). Use quando o usuário pedir 'quero a apólice', 'me traz o PDF/documento/cópia da apólice', 'a apólice do cliente X / do CPF Y / nº Z'. Procure por nº da apólice, CPF/CNPJ, nome do cliente (locatário/titular) ou imobiliária, combinando com produto, tipo e situação. Se vier mais de um documento, mostre os candidatos (nº, seguradora, vigência) e pergunte qual, em vez de despejar todos os links. Se o documento existe mas não tem arquivo guardado, diga isso.",
  input_schema: {
    type: "object",
    properties: {
      numero_apolice: { type: "string", description: "Nº da apólice (ou parte dele)." },
      cpf_cnpj: { type: "string", description: "CPF ou CNPJ do cliente (com ou sem pontuação)." },
      nome: { type: "string", description: "Nome (ou parte) do cliente/locatário/titular." },
      imobiliaria: { type: "string", description: "Nome da imobiliária ou grupo (todas as fichas)." },
      produto: { type: "string", description: "fianca, incendio, capitalizacao, automovel, vida, condominio, rc, saude, portateis, outros." },
      seguradora: { type: "string" },
      tipo_documento: { type: "string", enum: ["apolice", "proposta", "endosso", "cotacao", "todos", "card", "lote"], description: "Padrão: apolice (inclui certificado de capitalização). card = foto do card do Bitrix. lote = planilha/PDF original da lista de itens (lote) anexada ao card de Ramos Elementares; informe numero_card." },
      numero_card: { type: "string", description: "Nº do card no Bitrix (para tipo_documento card)." },
      situacao: { type: "string", description: "Situação do documento/card: recusado, perdido, cotacao, proposta, vigente, vencido, cancelado." },
      somente_vigentes: { type: "boolean", description: "Só documentos vigentes." },
    },
  },
};

type Entrada = {
  numero_apolice?: string;
  cpf_cnpj?: string;
  nome?: string;
  imobiliaria?: string;
  produto?: string;
  seguradora?: string;
  tipo_documento?: "apolice" | "proposta" | "endosso" | "cotacao" | "todos" | "card" | "lote";
  numero_card?: string;
  situacao?: string;
  somente_vigentes?: boolean;
};

const TIPOS_DOC: Record<string, string> = { A: "Apólice", C: "Endosso de cobrança", D: "Devolução", F: "Fatura", I: "End. cancelamento de item", M: "Endosso sem prêmio", R: "Endosso de restituição", X: "End. cancelamento de apólice" };
const ROTULO_ANEXO: Record<string, string> = { apolice: "Apólice", certificado: "Certificado", proposta: "Proposta", endosso: "Endosso", cotacao: "Cotação", outro: "Outro documento" };
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export async function buscarArquivosDocumento(e: Entrada, email: string): Promise<string> {
  const sb = createServiceClient();
  const tipoPedido = e.tipo_documento ?? "apolice";
  if (tipoPedido === "lote") {
    const card = (e.numero_card ?? "").replace(/\D/g, "");
    if (!card) return JSON.stringify({ erro: "Para o arquivo do lote, informe o nº do card do Bitrix (numero_card)." });
    const { data: arquivos } = await sb.storage.from("lotes-re").list(card, { limit: 50 });
    const links = [];
    for (const f of arquivos ?? []) {
      const { data: ass } = await sb.storage.from("lotes-re").createSignedUrl(`${card}/${f.name}`, VALIDADE_SEG, { download: `lote-card-${card}-${f.name}` });
      if (ass?.signedUrl) links.push({ arquivo: f.name, link: ass.signedUrl });
    }
    await registrar(email, e, links.length, links.map((l) => ({ arquivo: l.arquivo })));
    return JSON.stringify(links.length ? { cardBitrix: card, validadeDoLinkMinutos: VALIDADE_SEG / 60, arquivos: links } : { encontrou: false, observacao: "Esse card não tem arquivo de lote guardado." });
  }
  if (tipoPedido === "card" || e.numero_card) return await buscarFotosDeCards(e, email);
  if (!e.numero_apolice && !e.cpf_cnpj && !e.nome && !e.imobiliaria) return JSON.stringify({ erro: "Informe nº da apólice, CPF/CNPJ, nome do cliente ou imobiliária." });

  const [{ data: segs }, { data: ramos }] = await Promise.all([sb.from("erp_seguradoras").select("id, nome, abreviacao"), sb.from("erp_ramos").select("id, nome, produto")]);
  const segNome = new Map((segs ?? []).map((s) => [s.id as string, s.nome as string]));
  const ramoNome = new Map((ramos ?? []).map((r) => [r.id as string, r.nome as string]));
  const segIds = e.seguradora ? (segs ?? []).filter((s) => normalizar(`${s.nome} ${s.abreviacao}`).includes(normalizar(e.seguradora!))).map((s) => s.id as string) : null;
  const ramoIds = e.produto ? (ramos ?? []).filter((r) => normalizar(r.produto as string) === normalizar(e.produto!)).map((r) => r.id as string) : null;
  if ((segIds && !segIds.length) || (ramoIds && !ramoIds.length)) return JSON.stringify({ encontrou: false, observacao: "Seguradora ou produto não reconhecidos." });

  // 1) quem é (pessoa) -> documentos ligados a ela
  const titulares = new Map<string, string>(); // documento_id -> nome do titular, só para o usuário conferir quem é
  let docIdsPessoa: string[] | null = null;
  if (e.cpf_cnpj || e.nome) {
    let q = sb.from("locatarios").select("id, nome").limit(10);
    const dig = (e.cpf_cnpj ?? "").replace(/\D/g, "");
    if (dig.length >= 11) q = q.eq("cpf", dig);
    else {
      // nome PARECIDO (grafia/som): "Raquel" acha "Rachel"
      const { data: pr } = await sb.rpc("chat_nomes_parecidos", { p_termo: e.nome ?? "", p_limite: 20 });
      const idsCad = ((pr ?? []) as { fonte: string; ref: string }[]).filter((x) => x.fonte === "cadastro").map((x) => x.ref);
      q = q.in("id", idsCad.length ? idsCad : ["00000000-0000-0000-0000-000000000000"]);
    }
    const { data: pessoas } = await q;
    const ids = (pessoas ?? []).map((p) => p.id as string);
    const nomePessoa = new Map((pessoas ?? []).map((p) => [p.id as string, p.nome as string]));
    docIdsPessoa = [];
    if (ids.length) {
      const [{ data: d1 }, { data: d2 }, { data: ip }] = await Promise.all([
        sb.from("erp_documentos").select("id, locatario_id").in("locatario_id", ids).limit(300),
        sb.from("erp_doc_partes_acervo").select("documento_id, locatario_id").in("locatario_id", ids).limit(300),
        sb.from("erp_item_partes").select("item_id, locatario_id").in("locatario_id", ids).limit(300),
      ]);
      for (const r of d1 ?? []) { docIdsPessoa.push(r.id as string); titulares.set(r.id as string, nomePessoa.get(r.locatario_id as string) ?? ""); }
      for (const r of d2 ?? []) { docIdsPessoa.push(r.documento_id as string); titulares.set(r.documento_id as string, nomePessoa.get(r.locatario_id as string) ?? ""); }
      const itens = [...new Set((ip ?? []).map((r) => r.item_id as string))];
      if (itens.length) {
        const { data: it } = await sb.from("erp_documento_itens").select("id, documento_id").in("id", itens);
        const doc = new Map((it ?? []).map((r) => [r.id as string, r.documento_id as string]));
        for (const r of ip ?? []) { const d = doc.get(r.item_id as string); if (d) { docIdsPessoa.push(d); titulares.set(d, nomePessoa.get(r.locatario_id as string) ?? ""); } }
      }
    }
    if (!docIdsPessoa.length) {
      await registrar(email, e, 0, []);
      return JSON.stringify({ encontrou: false, observacao: "Nenhum documento ligado a essa pessoa no ERP." });
    }
  }

  // 2) documentos que atendem a todos os filtros
  let q = sb
    .from("erp_documentos")
    .select("id, tipo, tipo_corp, situacao, numero_apolice, numero_proposta, numero_endosso, nosso_numero_corp, seguradora_id, ramo_id, imobiliaria_principal_id, vigencia_inicio, vigencia_fim")
    .not("situacao", "in", "(duplicado,perdido,recusado)")
    .order("vigencia_inicio", { ascending: false })
    .limit(MAX_DOCUMENTOS * 3);
  if (docIdsPessoa) q = q.in("id", [...new Set(docIdsPessoa)]);
  if (e.numero_apolice) q = q.ilike("numero_apolice", `%${e.numero_apolice.trim()}%`);
  if (e.imobiliaria) {
    const { fichas, ambiguo } = await resolverImobiliarias(e.imobiliaria);
    if (!fichas.length) return JSON.stringify({ encontrou: false, observacao: "Imobiliária não encontrada no banco único." });
    if (ambiguo) return JSON.stringify({ erro: "Nome de imobiliária ambíguo; peça um nome mais específico." });
    q = q.in("imobiliaria_principal_id", fichas.map((f) => f.id));
  }
  if (segIds) q = q.in("seguradora_id", segIds);
  if (ramoIds) q = q.in("ramo_id", ramoIds);
  if (e.somente_vigentes) q = q.eq("situacao", "vigente");
  if (tipoPedido === "apolice") q = q.eq("tipo", "A");
  else if (tipoPedido === "endosso") q = q.in("tipo", ["C", "D", "I", "M", "R", "X"]);
  const { data: docs, error } = await q;
  if (error) return `Erro: ${error.message}`;
  const documentos = (docs ?? []).slice(0, MAX_DOCUMENTOS);
  if (!documentos.length) {
    await registrar(email, e, 0, []);
    return JSON.stringify({ encontrou: false, observacao: "Nenhum documento com esses filtros." });
  }

  // 3) arquivos guardados (ERP e Corp)
  const docIds = documentos.map((d) => d.id as string);
  const nossos = documentos.map((d) => d.nosso_numero_corp).filter((v): v is number => v != null).map(String);
  const [{ data: anexos }, { data: anexosCorp }] = await Promise.all([
    sb.from("erp_documento_anexos").select("documento_id, tipo, nome_arquivo, storage_path, sha256, tamanho, situacao").in("documento_id", docIds).not("storage_path", "is", null),
    nossos.length ? sb.from("corp_anexos").select("id, nosso_numero, nome, storage_path, sha256, bytes, apolice").in("nosso_numero", nossos) : Promise.resolve({ data: [] as { nosso_numero: string; nome: string; storage_path: string; sha256: string | null; bytes: number | null; apolice: boolean }[] }),
  ]);
  const querAnexo = (t: string | null) => {
    if (tipoPedido === "todos") return true;
    if (tipoPedido === "apolice") return t === "apolice" || t === "certificado";
    return t === tipoPedido;
  };

  type Arq = { documentoId: string; rotulo: string; nome: string; bucket: string; caminho: string; bytes: number | null; sha: string | null };
  const arqs: Arq[] = [];
  for (const a of anexos ?? []) {
    if (!querAnexo(a.tipo as string | null) || a.situacao === "descartado") continue;
    arqs.push({ documentoId: a.documento_id as string, rotulo: ROTULO_ANEXO[a.tipo as string] ?? "Documento", nome: (a.nome_arquivo as string) || "arquivo.pdf", bucket: "anexos-documentos", caminho: a.storage_path as string, bytes: (a.tamanho as number) ?? null, sha: (a.sha256 as string) ?? null });
  }
  const docPorNosso = new Map(documentos.filter((d) => d.nosso_numero_corp != null).map((d) => [String(d.nosso_numero_corp), d.id as string]));
  // anexo que a conferência do PDF marcou como de OUTRO documento (seguradora diferente: bug antigo do robô, caso 84846) não é oferecido
  const idsCorp = (anexosCorp ?? []).map((c) => (c as { id: string }).id);
  const errados = new Set<string>();
  if (idsCorp.length) { const { data: conf } = await sb.from("corp_anexos_conferencia").select("anexo_id").eq("resultado", "seguradora_diferente").in("anexo_id", idsCorp); for (const x of conf ?? []) errados.add(x.anexo_id as string); }
  for (const c of anexosCorp ?? []) {
    if (errados.has((c as { id: string }).id)) continue;
    if (tipoPedido === "apolice" && !c.apolice) continue;
    if (tipoPedido !== "apolice" && tipoPedido !== "todos") continue; // no Corp só a apólice tem rótulo confiável
    arqs.push({ documentoId: docPorNosso.get(String(c.nosso_numero)) ?? "", rotulo: c.apolice ? "Apólice (Corp)" : "Anexo do Corp", nome: (c.nome as string) || "arquivo.pdf", bucket: "corp-anexos", caminho: c.storage_path as string, bytes: (c.bytes as number) ?? null, sha: (c.sha256 as string) ?? null });
  }
  // mesmo arquivo vindo das duas fontes: fica um só
  const vistos = new Set<string>();
  const unicos = arqs.filter((a) => {
    const k = a.sha ?? `${a.bucket}/${a.caminho}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });

  const porDoc = new Map(documentos.map((d) => [d.id as string, d]));
  const escolhidos = unicos.filter((a) => porDoc.has(a.documentoId)).slice(0, MAX_ARQUIVOS);
  const resultado = [];
  for (const a of escolhidos) {
    const d = porDoc.get(a.documentoId)!;
    const ext = (a.nome.match(/\.[A-Za-z0-9]{2,5}$/)?.[0] ?? ".pdf").toLowerCase();
    const nomeBaixar = `${a.rotulo.split(" ")[0].toLowerCase()}-${d.numero_apolice ?? d.numero_proposta ?? d.numero_endosso ?? "documento"}-${(segNome.get(d.seguradora_id as string) ?? "").split(" ")[0].toLowerCase()}${ext}`.replace(/[^\w.-]+/g, "-");
    const { data: ass } = await sb.storage.from(a.bucket).createSignedUrl(a.caminho, VALIDADE_SEG, { download: nomeBaixar });
    if (!ass?.signedUrl) continue;
    resultado.push({
      arquivo: a.rotulo,
      nomeDoArquivo: nomeBaixar,
      tamanhoKB: a.bytes ? Math.round(a.bytes / 1024) : null,
      link: ass.signedUrl,
      documento: {
        tipo: TIPOS_DOC[d.tipo as string] ?? d.tipo,
        situacao: d.situacao,
        numeroApolice: d.numero_apolice,
        numeroEndosso: d.numero_endosso,
        seguradora: segNome.get(d.seguradora_id as string) ?? null,
        ramo: ramoNome.get(d.ramo_id as string) ?? null,
        vigencia: `${dataBr(d.vigencia_inicio as string | null)} a ${dataBr(d.vigencia_fim as string | null)}`,
        titular: titulares.get(d.id as string) || undefined,
      },
    });
  }
  const semArquivo = documentos.filter((d) => !escolhidos.some((a) => a.documentoId === d.id)).slice(0, 10).map((d) => ({
    tipo: TIPOS_DOC[d.tipo as string] ?? d.tipo,
    situacao: d.situacao,
    numeroApolice: d.numero_apolice,
    seguradora: segNome.get(d.seguradora_id as string) ?? null,
    vigencia: `${dataBr(d.vigencia_inicio as string | null)} a ${dataBr(d.vigencia_fim as string | null)}`,
  }));

  await registrar(email, e, documentos.length, resultado.map((r) => ({ arquivo: r.nomeDoArquivo, apolice: r.documento.numeroApolice })));
  const porto = resultado.some((r) => /porto/i.test(String(r.documento.seguradora)));
  return JSON.stringify({
    documentosEncontrados: documentos.length,
    arquivosComLink: resultado.length,
    validadeDoLinkMinutos: VALIDADE_SEG / 60,
    arquivos: resultado,
    ...(semArquivo.length ? { documentosSemArquivoGuardado: semArquivo, aviso: "Estes documentos existem no ERP mas não têm o arquivo guardado na base." } : {}),
    ...(unicos.length > MAX_ARQUIVOS ? { avisoLimite: `Há mais de ${MAX_ARQUIVOS} arquivos; mostrei os primeiros. Peça ao usuário para refinar (nº da apólice, produto, vigência).` } : {}),
    ...(porto ? { avisoSenha: "PDFs da Porto Seguro costumam vir protegidos por senha." } : {}),
  });
}

async function registrar(email: string, busca: Entrada, documentos: number, arquivos: unknown[]) {
  try {
    // O termo pesquisado (CPF/nome) fica mascarado no registro; guarda-se só o que identifica o pedido.
    const mascarado = { ...busca, cpf_cnpj: busca.cpf_cnpj ? busca.cpf_cnpj.replace(/\d(?=\d{2})/g, "*") : undefined };
    await createServiceClient().from("chat_robo_arquivos_log").insert({ email, busca: mascarado, documentos, arquivos });
  } catch {
    // o registro não pode impedir a entrega, mas falha silenciosa é aceitável só aqui
  }
}

// ---------------------------------------------------------------- FOTO DO CARD (Bitrix)
const ENTIDADE_POR_PRODUTO: Record<string, number> = { fianca: 1042, incendio: 1046, re: 1046, capitalizacao: 1048, automovel: 1050 };
const FUNIL: Record<number, string> = { 1042: "Seguro Fiança", 1046: "Ramos Elementares (incêndio e demais)", 1048: "Capitalização", 1050: "Seguro Automóvel" };

type LinhaCard = {
  entity_type_id: number;
  item_id: number;
  etapa: string | null;
  situacao: string | null;
  motivo: string | null;
  titulo: string | null;
  url: string | null;
  imobiliaria_id: string | null;
  dados_legiveis: Record<string, unknown> | null;
  historico_etapas: FotoCard["historico"] | null;
  comentarios: FotoCard["comentarios"] | null;
  card_criado_em: string | null;
  card_atualizado_em: string | null;
  capturado_em: string | null;
  origem: string;
};

async function buscarFotosDeCards(e: Entrada, email: string): Promise<string> {
  const sb = createServiceClient();
  const entidade = e.produto ? ENTIDADE_POR_PRODUTO[normalizar(e.produto)] : undefined;
  if (e.produto && !entidade) return JSON.stringify({ erro: "Produto sem funil no Bitrix (use fianca, incendio/re, capitalizacao ou automovel)." });
  if (!e.numero_card && !e.nome && !e.cpf_cnpj && !e.imobiliaria && !e.situacao) return JSON.stringify({ erro: "Informe nº do card, nome do cliente, CPF, imobiliária ou situação (ex.: recusado)." });

  let imobIds: string[] | null = null;
  if (e.imobiliaria) {
    const { fichas, ambiguo } = await resolverImobiliarias(e.imobiliaria);
    if (!fichas.length) return JSON.stringify({ encontrou: false, observacao: "Imobiliária não encontrada no banco único." });
    if (ambiguo) return JSON.stringify({ erro: "Nome de imobiliária ambíguo; peça um nome mais específico." });
    imobIds = fichas.map((f) => f.id);
  }
  // pessoa (CPF) -> id no cadastro único
  let pessoaIds: string[] | null = null;
  const dig = (e.cpf_cnpj ?? "").replace(/\D/g, "");
  if (dig.length >= 11) {
    const { data } = await sb.from("locatarios").select("id").eq("cpf", dig).limit(10);
    pessoaIds = (data ?? []).map((p) => p.id as string);
  }
  // nome do cliente no título do card: busca por nome PARECIDO ("Raquel" acha "Rachel")
  let refsArquivo: number[] | null = null;
  let refsErp: number[] | null = null;
  if (e.nome) {
    const { data: pr } = await sb.rpc("chat_nomes_parecidos", { p_termo: e.nome, p_limite: 30 });
    const linhasPr = (pr ?? []) as { fonte: string; ref: string }[];
    refsArquivo = linhasPr.filter((x) => x.fonte === "card_arquivo").map((x) => Number(x.ref));
    refsErp = linhasPr.filter((x) => x.fonte === "card_erp").map((x) => Number(x.ref));
  }
  const situacao = e.situacao ? normalizar(e.situacao) : null;
  const candidatos: LinhaCard[] = [];

  // A) cards perdidos/recusados guardados sem documento (bitrix_cards_arquivo)
  {
    let q = sb
      .from("bitrix_cards_arquivo")
      .select("entity_type_id, item_id, etapa, situacao, motivo, titulo, url, imobiliaria_id, dados_legiveis, historico_etapas, comentarios, card_criado_em, card_atualizado_em, capturado_em")
      .order("card_atualizado_em", { ascending: false })
      .limit(8);
    if (e.numero_card) q = q.eq("item_id", Number(e.numero_card));
    if (refsArquivo) q = q.in("item_id", refsArquivo.length ? refsArquivo : [-1]);
    if (imobIds) q = q.in("imobiliaria_id", imobIds);
    if (entidade) q = q.eq("entity_type_id", entidade);
    if (situacao) q = q.eq("situacao", situacao);
    if (pessoaIds) q = pessoaIds.length ? q.in("locatario_id", pessoaIds) : q.eq("item_id", -1);
    const { data } = await q;
    for (const r of (data ?? []) as unknown as Omit<LinhaCard, "origem">[]) candidatos.push({ ...r, origem: "arquivo de cards recusados/perdidos" });
  }

  // B) cards ligados a documento do ERP (erp_origens)
  {
    let docIds: string[] | null = null;
    if (imobIds || situacao || pessoaIds) {
      let qd = sb.from("erp_documentos").select("id").limit(400);
      if (imobIds) qd = qd.in("imobiliaria_principal_id", imobIds);
      if (situacao) qd = qd.eq("situacao", situacao);
      if (pessoaIds) qd = pessoaIds.length ? qd.in("locatario_id", pessoaIds) : qd.eq("id", "00000000-0000-0000-0000-000000000000");
      const { data } = await qd;
      docIds = (data ?? []).map((d) => d.id as string);
    }
    if (!docIds || docIds.length) {
      let q = sb
        .from("erp_origens")
        .select("documento_id, entity_type_id, item_id, etapa_id, titulo, url, dados_legiveis, historico_etapas, comentarios, card_criado_em, card_atualizado_em, capturado_em")
        .eq("sistema", "bitrix")
        .order("card_atualizado_em", { ascending: false })
        .limit(8);
      if (e.numero_card) q = q.eq("item_id", Number(e.numero_card));
      if (refsErp) q = q.in("item_id", refsErp.length ? refsErp : [-1]);
      if (entidade) q = q.eq("entity_type_id", entidade);
      if (docIds) q = q.in("documento_id", docIds.slice(0, 300));
      const { data } = await q;
      const origens = (data ?? []) as unknown as (Omit<LinhaCard, "origem" | "etapa" | "situacao" | "motivo" | "imobiliaria_id"> & { documento_id: string; etapa_id: string | null })[];
      const ids = origens.map((o) => o.documento_id);
      const { data: docs } = ids.length
        ? await sb.from("erp_documentos").select("id, situacao, motivo_cancelamento, imobiliaria_principal_id").in("id", ids)
        : { data: [] as { id: string; situacao: string; motivo_cancelamento: string | null; imobiliaria_principal_id: string | null }[] };
      const porDoc = new Map((docs ?? []).map((d) => [d.id as string, d]));
      for (const o of origens) {
        const d = porDoc.get(o.documento_id);
        candidatos.push({
          ...o,
          etapa: o.etapa_id,
          situacao: (d?.situacao as string) ?? null,
          motivo: (d?.motivo_cancelamento as string) ?? null,
          imobiliaria_id: (d?.imobiliaria_principal_id as string) ?? null,
          origem: "card ligado a documento do ERP",
        });
      }
    }
  }

  // sem duplicar o mesmo card; os mais recentes primeiro
  const vistos = new Set<string>();
  const unicos = candidatos
    .filter((c) => {
      const k = `${c.entity_type_id}-${c.item_id}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .sort((a, b) => String(b.card_atualizado_em ?? "").localeCompare(String(a.card_atualizado_em ?? "")));
  if (!unicos.length) {
    await registrar(email, e, 0, []);
    return JSON.stringify({ encontrou: false, observacao: "Nenhum card com esses filtros guardado no banco." });
  }
  const escolhidos = unicos.slice(0, 5);
  const imobsIds = [...new Set(escolhidos.map((c) => c.imobiliaria_id).filter((v): v is string => !!v))];
  const { data: imobs } = imobsIds.length ? await sb.from("imobiliarias").select("id, nome").in("id", imobsIds) : { data: [] as { id: string; nome: string }[] };
  const nomeImob = new Map((imobs ?? []).map((i) => [i.id as string, i.nome as string]));

  const cards = [];
  for (const c of escolhidos) {
    const foto: FotoCard = {
      titulo: c.titulo ?? `Card ${c.item_id}`,
      funil: FUNIL[c.entity_type_id] ?? `Funil ${c.entity_type_id}`,
      etapa: c.etapa,
      situacao: c.situacao,
      motivo: c.motivo,
      imobiliaria: c.imobiliaria_id ? nomeImob.get(c.imobiliaria_id) ?? null : null,
      cardId: Number(c.item_id),
      criadoEm: c.card_criado_em,
      atualizadoEm: c.card_atualizado_em,
      capturadoEm: c.capturado_em,
      url: c.url,
      campos: c.dados_legiveis ?? {},
      historico: Array.isArray(c.historico_etapas) ? c.historico_etapas : [],
      comentarios: Array.isArray(c.comentarios) ? c.comentarios : [],
      origemDaFoto: c.origem,
    };
    const bytes = await gerarPdfFotoCard(foto, email);
    const caminho = `cards/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.pdf`;
    const { error: eUp } = await sb.storage.from("relatorios-robo").upload(caminho, bytes, { contentType: "application/pdf" });
    if (eUp) continue;
    const { data: ass } = await sb.storage.from("relatorios-robo").createSignedUrl(caminho, VALIDADE_SEG, { download: `foto-card-${c.item_id}-${c.situacao ?? "card"}.pdf` });
    if (!ass?.signedUrl) continue;
    cards.push({
      cardNumero: Number(c.item_id),
      titulo: foto.titulo,
      funil: foto.funil,
      etapa: c.etapa,
      situacao: c.situacao,
      motivo: c.motivo,
      imobiliaria: foto.imobiliaria,
      criadoEm: c.card_criado_em,
      atualizadoEm: c.card_atualizado_em,
      fotoGuardadaEm: c.capturado_em,
      campos: Object.keys(foto.campos).length,
      comentarios: foto.comentarios.length,
      linkDaFoto: ass.signedUrl,
    });
  }
  await registrar(email, { ...e, tipo_documento: "card" }, cards.length, cards.map((c) => ({ card: c.cardNumero, situacao: c.situacao })));
  return JSON.stringify({
    cardsEncontrados: unicos.length,
    cardsComFoto: cards.length,
    validadeDoLinkMinutos: VALIDADE_SEG / 60,
    cards,
    ...(unicos.length > escolhidos.length ? { aviso: `Há mais ${unicos.length - escolhidos.length} cards; mostrei os 5 mais recentes. Peça para refinar (nº do card, nome, situação).` } : {}),
    nota: "A foto é o card como estava na última vez que foi guardado no banco (data em fotoGuardadaEm); o Bitrix pode ter mudado depois.",
  });
}

export async function executarFerramentaArquivos(nome: string, entrada: unknown, email: string): Promise<string | null> {
  if (nome !== FERRAMENTA_ARQUIVOS.name) return null;
  try {
    return await buscarArquivosDocumento(entrada as Entrada, email);
  } catch (err) {
    return `Erro ao buscar o arquivo: ${err instanceof Error ? err.message : String(err)}`;
  }
}
