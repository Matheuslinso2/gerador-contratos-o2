import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarDefinicaoCampos, chamarBitrix, listarHistoricoEtapas, listarItensSpa, type BitrixDefinicaoCampo, type BitrixItemRaw, type BitrixStageHistoryEvent } from "@/lib/bitrix/client";
import { gerarLinkCard } from "@/lib/bitrix/entidadesCard";
import { CATEGORIA_ANALISE, CATEGORIA_NEGOCIACAO, CATEGORIA_RENOVACAO, ENTITY_TYPE_ID, ETAPAS, SEGURADORAS } from "@/lib/bitrix/seguroFianca";

// ERP O2 — Fase 1b / T2: o card do Bitrix (SPA Seguro Fiança, 1042) vira documento do ERP.
//
// Princípio do Matheus (25/10/2026): o card é o início da informação; tudo que ele tem
// acompanha o documento até virar apólice. Aqui, para cada card:
//   1. acha ou cria o documento (Código O2 nasce aqui — interno, não volta ao card ainda);
//   2. se o card já tem "Nosso Nº Corp", LIGA ao documento que veio do Corp (casamento),
//      em vez de criar outro;
//   3. preenche o que o card sabe: produtor (Empresa do card → ficha da base única),
//      cliente (cofre, por CPF), seguradora escolhida, prêmio, parcelas, vigência,
//      imóvel (endereço, aluguel, plano, tipo) e coberturas (aluguel, IPTU, condomínio,
//      água, luz) — como pré-cadastro, marcado para revisão humana;
//   4. guarda o card inteiro, a trilha de etapas e (quando pedido) os comentários em
//      erp_origens, ligados ao documento.
// Nada aqui escreve no Bitrix.

const C = {
  logradouro: "ufCrm10_1776351662", numero: "ufCrm10_1776351686", complemento: "ufCrm10_1776351702",
  cidade: "ufCrm10_1776351708", uf: "ufCrm10_1776351720", cep: "ufCrm10_1776351647",
  aluguel: "ufCrm10_1776352052", iptu: "ufCrm10_1776352100", condominio: "ufCrm10_1776352074",
  agua: "ufCrm10_1776352111", luz: "ufCrm10_1776352123", pacoteTotal: "ufCrm10_1776352154",
  tipoLocacao: "ufCrm10_1776351302", finalidade: "ufCrm10_1781116634", plano: "ufCrm10_1776351571",
  locatario1Nome: "ufCrm10_1776354897", locatario1Cpf: "ufCrm10_1776351609", locatario1Tel: "ufCrm10_1783366668", locatario1Email: "ufCrm10_1783366659",
  locatario2Nome: "ufCrm10_1783438270", locatario2Cpf: "ufCrm10_1783438283",
  tipoPessoa: "ufCrm10_1781118439",
  seguradoraEscolhida: "ufCrm10_1776352200", comissaoTrabalhada: "ufCrm10_1779820737",
  vigenciaInicial: "ufCrm10_1779821934", vigenciaFinal: "ufCrm10_1779821962",
  premioLiquido: "ufCrm10_1781029986152", dataEfetivacao: "ufCrm10_1776352369",
  nossoNumeroCorp: "ufCrm10_1778258392", motivoRecusa: "ufCrm10_1776352403", observacoes: "ufCrm10_1776352503",
} as const;

const etapaPorId = new Map(ETAPAS.map((e) => [e.statusId, e]));

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const [s] = String(v).split("|");
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function data(v: unknown): string | null {
  const s = texto(v);
  return s ? s.slice(0, 10) : null;
}
function digitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}
function rotuloEnum(defs: Record<string, BitrixDefinicaoCampo>, campo: string, v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  const item = defs[campo]?.items?.find((i) => String(i.ID) === s);
  return item ? item.VALUE : s;
}

/** Situação do ERP a partir do funil/etapa do card. */
export function situacaoDoCard(item: BitrixItemRaw): { situacao: string; tipo_corp: "NOVO" | "RENV"; motivo?: string } {
  const et = etapaPorId.get(item.stageId);
  const sem = et?.semantica ?? (item.stageId.endsWith(":SUCCESS") ? "S" : item.stageId.endsWith(":FAIL") ? "F" : "P");
  const tipo_corp = Number(item.categoryId) === CATEGORIA_RENOVACAO ? "RENV" : "NOVO";
  if (sem === "F") return { situacao: Number(item.categoryId) === CATEGORIA_NEGOCIACAO ? "perdido" : "recusado", tipo_corp, motivo: et?.nome ?? "recusado/perdido" };
  if (Number(item.categoryId) === CATEGORIA_NEGOCIACAO) return { situacao: sem === "S" ? "digitado" : "proposta", tipo_corp };
  return { situacao: "cotacao", tipo_corp };
}

/** Campos do card com rótulo e valor legíveis (só os preenchidos). */
export function dadosLegiveis(item: BitrixItemRaw, defs: Record<string, BitrixDefinicaoCampo & { title?: string; type?: string }>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [campo, def] of Object.entries(defs)) {
    const v = (item as Record<string, unknown>)[campo];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    const rotulo = def.title ?? campo;
    if (def.type === "enumeration") out[rotulo] = Array.isArray(v) ? v.map((x) => rotuloEnum(defs, campo, x)) : rotuloEnum(defs, campo, v);
    else if (def.type === "money") out[rotulo] = num(v);
    else out[rotulo] = v;
  }
  return out;
}

export type ResumoSincronizacao = {
  cards: number;
  criados: number;
  ligados_ao_corp: number;
  atualizados: number;
  sem_imobiliaria: number;
  sem_cpf: number;
  comentarios_capturados: number;
  erros: { card: number; erro: string }[];
};

type Opcoes = { desde: string; gravar: boolean; comentarios: number; apenasCards?: number[] };

export async function sincronizarFiancaBitrix(sb: SupabaseClient, o: Opcoes): Promise<ResumoSincronizacao> {
  const r: ResumoSincronizacao = { cards: 0, criados: 0, ligados_ao_corp: 0, atualizados: 0, sem_imobiliaria: 0, sem_cpf: 0, comentarios_capturados: 0, erros: [] };
  const [todos, historico, defsBrutas] = await Promise.all([listarItensSpa(ENTITY_TYPE_ID), listarHistoricoEtapas(ENTITY_TYPE_ID), buscarDefinicaoCampos(ENTITY_TYPE_ID)]);
  const defs = defsBrutas as Record<string, BitrixDefinicaoCampo & { title?: string; type?: string }>;
  const cats = new Set([CATEGORIA_ANALISE, CATEGORIA_NEGOCIACAO, CATEGORIA_RENOVACAO]);
  let itens = todos.filter((i) => cats.has(Number(i.categoryId)) && String(i.createdTime).slice(0, 10) >= o.desde);
  if (o.apenasCards?.length) itens = itens.filter((i) => o.apenasCards!.includes(Number(i.id)));
  r.cards = itens.length;
  const eventosPorCard = new Map<number, BitrixStageHistoryEvent[]>();
  for (const e of historico) {
    const l = eventosPorCard.get(Number(e.OWNER_ID)) ?? [];
    l.push(e);
    eventosPorCard.set(Number(e.OWNER_ID), l);
  }

  // referências do ERP
  const [{ data: ramo }, { data: corretora }, { data: segs }, { data: vinculos }, { data: chavesExistentes }] = await Promise.all([
    sb.from("erp_ramos").select("id").eq("abreviacao", "FIAN").maybeSingle(),
    sb.from("erp_corretoras").select("id").ilike("apelido", "%corretora%").maybeSingle(),
    sb.from("erp_seguradoras").select("id, nome, abreviacao"),
    sb.from("imobiliaria_registros_fonte").select("chave_externa, imobiliaria_id").eq("fonte", "bitrix_empresa").not("imobiliaria_id", "is", null),
    sb.from("erp_chaves_externas").select("chave, entidade_id").eq("sistema", "bitrix").eq("entidade", "documento"),
  ]);
  if (!ramo || !corretora) throw new Error("erp_ramos FIAN / erp_corretoras não encontrados");
  const imobPorEmpresa = new Map((vinculos ?? []).map((v) => [String(v.chave_externa), v.imobiliaria_id as string]));
  const docPorChave = new Map((chavesExistentes ?? []).map((c) => [c.chave as string, c.entidade_id as string]));
  const segPorNome = (nome: string | null) => {
    if (!nome) return null;
    const n = nome.toLowerCase();
    const s = (segs ?? []).find((x) => n.includes(x.nome.toLowerCase().split(" ")[0]) || n.includes(x.abreviacao.toLowerCase()));
    return s?.id ?? null;
  };

  let comentariosRestantes = o.comentarios;
  for (const item of itens) {
    const id = Number(item.id);
    try {
      const chave = `${ENTITY_TYPE_ID}:${id}`;
      const sit = situacaoDoCard(item);
      const imobId = item.companyId ? imobPorEmpresa.get(String(item.companyId)) ?? null : null;
      if (!imobId) r.sem_imobiliaria++;
      const segNome = rotuloEnum(defs, C.seguradoraEscolhida, (item as Record<string, unknown>)[C.seguradoraEscolhida]);
      const segId = segPorNome(segNome);
      const cfgSeg = SEGURADORAS.find((s) => segNome && segNome.toLowerCase().includes(s.nome.toLowerCase()));
      const parcelas = cfgSeg?.parcelas ? num((item as Record<string, unknown>)[cfgSeg.parcelas]) : null;
      const valorParcela = cfgSeg ? num((item as Record<string, unknown>)[cfgSeg.valor]) : null;
      const premioLiquido = num((item as Record<string, unknown>)[C.premioLiquido]) ?? (valorParcela && parcelas ? Math.round(valorParcela * parcelas * 100) / 100 : null);
      const comissaoPct = num((item as Record<string, unknown>)[C.comissaoTrabalhada]) ?? (cfgSeg?.comissao ? num((item as Record<string, unknown>)[cfgSeg.comissao]) : null);
      const vigIni = data((item as Record<string, unknown>)[C.vigenciaInicial]);
      const vigFim = data((item as Record<string, unknown>)[C.vigenciaFinal]);
      const nnCorp = num((item as Record<string, unknown>)[C.nossoNumeroCorp]);
      const cpf1 = digitos((item as Record<string, unknown>)[C.locatario1Cpf]);
      if (!cpf1) r.sem_cpf++;

      // cliente no cofre (service role)
      let locatarioId: string | null = null;
      if (cpf1 && o.gravar) {
        const nome1 = texto((item as Record<string, unknown>)[C.locatario1Nome]);
        const { data: loc } = await sb
          .from("locatarios")
          .upsert({ cpf: cpf1, nome: nome1, email: texto((item as Record<string, unknown>)[C.locatario1Email]), telefone: texto((item as Record<string, unknown>)[C.locatario1Tel]), primeira_fonte: `bitrix:${chave}` }, { onConflict: "cpf", ignoreDuplicates: true })
          .select("id")
          .maybeSingle();
        locatarioId = loc?.id ?? (await sb.from("locatarios").select("id").eq("cpf", cpf1).maybeSingle()).data?.id ?? null;
      }

      // 1) documento: já ligado? casa com o Corp? ou cria
      let docId = docPorChave.get(chave) ?? null;
      let modo: "criado" | "ligado" | "atualizado" = "atualizado";
      if (!docId && nnCorp) {
        const { data: doCorp } = await sb.from("erp_documentos").select("id").eq("nosso_numero_corp", nnCorp).maybeSingle();
        if (doCorp) { docId = doCorp.id; modo = "ligado"; }
      }
      const camposDoCard = {
        tipo_contratacao: imobId ? "indicacao_imobiliaria" : null,
        canal_venda: imobId ? null : "venda_direta",
      };
      if (!docId) {
        modo = "criado";
        if (!o.gravar) { r.criados++; continue; }
        const competencia = (vigIni ?? String(item.createdTime).slice(0, 10)).slice(0, 7) + "-01";
        const { data: novo, error } = await sb
          .from("erp_documentos")
          .insert({
            corretora_id: corretora.id, tipo: "A", tipo_corp: sit.tipo_corp, seguradora_id: segId, ramo_id: ramo.id,
            locatario_id: locatarioId, imobiliaria_principal_id: imobId, canal_venda: camposDoCard.canal_venda,
            tipo_contratacao: camposDoCard.tipo_contratacao, modo_cobranca: "individual",
            dt_proposta: String(item.createdTime).slice(0, 10), vigencia_inicio: vigIni, vigencia_fim: vigFim,
            qtd_parcelas: parcelas, premio_liquido: premioLiquido ?? 0, premio_total: premioLiquido ?? 0,
            comissao_pct: comissaoPct ?? 0, comissao_valor: premioLiquido && comissaoPct ? Math.round(premioLiquido * comissaoPct) / 100 : 0,
            situacao: sit.situacao, motivo_cancelamento: sit.motivo ?? null, competencia,
            origem: "bitrix", origem_ref: chave, observacoes: texto((item as Record<string, unknown>)[C.observacoes]),
            digitado_em: item.createdTime, revisao_pendente: true,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        docId = novo.id;
      } else if (o.gravar) {
        // documento já existe: só avança situação/vigência e completa o que estiver vazio
        const { data: atual } = await sb.from("erp_documentos").select("origem, situacao, locatario_id, imobiliaria_principal_id, tipo_contratacao, vigencia_inicio, vigencia_fim, seguradora_id").eq("id", docId).single();
        const patch: Record<string, unknown> = {};
        if (atual?.origem === "bitrix") { patch.situacao = sit.situacao; patch.motivo_cancelamento = sit.motivo ?? null; patch.vigencia_inicio = vigIni; patch.vigencia_fim = vigFim; patch.seguradora_id = segId ?? atual.seguradora_id; patch.qtd_parcelas = parcelas; if (premioLiquido) { patch.premio_liquido = premioLiquido; patch.premio_total = premioLiquido; } if (comissaoPct) patch.comissao_pct = comissaoPct; }
        if (!atual?.locatario_id && locatarioId) patch.locatario_id = locatarioId;
        if (!atual?.imobiliaria_principal_id && imobId) patch.imobiliaria_principal_id = imobId;
        if (!atual?.tipo_contratacao && camposDoCard.tipo_contratacao) patch.tipo_contratacao = camposDoCard.tipo_contratacao;
        if (Object.keys(patch).length) await sb.from("erp_documentos").update(patch).eq("id", docId);
      }
      if (modo === "criado") r.criados++; else if (modo === "ligado") r.ligados_ao_corp++; else r.atualizados++;
      if (!o.gravar || !docId) continue;

      // 2) chave externa
      await sb.from("erp_chaves_externas").upsert({ sistema: "bitrix", entidade: "documento", entidade_id: docId, chave, dados: { entityTypeId: ENTITY_TYPE_ID, itemId: id } }, { onConflict: "sistema,entidade,chave" });

      // 3) item (imóvel), partes e coberturas — pré-cadastro só quando o documento ainda não tem item
      const { data: itemExistente } = await sb.from("erp_documento_itens").select("id").eq("documento_id", docId).eq("item_n", 1).maybeSingle();
      if (!itemExistente) {
        const tipoLoc = (rotuloEnum(defs, C.tipoLocacao, (item as Record<string, unknown>)[C.tipoLocacao]) ?? "").toLowerCase();
        const { data: it, error: eIt } = await sb
          .from("erp_documento_itens")
          .insert({
            documento_id: docId, item_n: 1,
            tipo_imovel: tipoLoc.includes("comerc") ? "comercial" : tipoLoc.includes("resid") ? "residencial" : null,
            cep: texto((item as Record<string, unknown>)[C.cep]), logradouro: texto((item as Record<string, unknown>)[C.logradouro]), numero: texto((item as Record<string, unknown>)[C.numero]),
            complemento: texto((item as Record<string, unknown>)[C.complemento]), cidade: texto((item as Record<string, unknown>)[C.cidade]), uf: rotuloEnum(defs, C.uf, (item as Record<string, unknown>)[C.uf]),
            valor_aluguel: num((item as Record<string, unknown>)[C.aluguel]), plano: rotuloEnum(defs, C.plano, (item as Record<string, unknown>)[C.plano]),
            contrato_inicio: vigIni, contrato_fim: vigFim,
            observacoes: [rotuloEnum(defs, C.finalidade, (item as Record<string, unknown>)[C.finalidade]), rotuloEnum(defs, C.tipoPessoa, (item as Record<string, unknown>)[C.tipoPessoa])].filter(Boolean).join(" · ") || null,
          })
          .select("id")
          .single();
        if (eIt) throw new Error(eIt.message);
        const partes = [
          { papel: "locatario", ordem: 1, nome: texto((item as Record<string, unknown>)[C.locatario1Nome]), documento_numero: cpf1 || null, locatario_id: locatarioId },
          { papel: "locatario", ordem: 2, nome: texto((item as Record<string, unknown>)[C.locatario2Nome]), documento_numero: digitos((item as Record<string, unknown>)[C.locatario2Cpf]) || null, locatario_id: null },
        ].filter((p) => p.nome || p.documento_numero);
        if (partes.length) await sb.from("erp_item_partes").insert(partes.map((p) => ({ ...p, item_id: it.id })));
        const cob = [
          ["Aluguel", C.aluguel], ["IPTU", C.iptu], ["Condomínio", C.condominio], ["Água", C.agua], ["Luz", C.luz],
        ].map(([nome, campo]) => ({ nome, importancia_segurada: num((item as Record<string, unknown>)[campo]) })).filter((c) => c.importancia_segurada);
        if (cob.length) await sb.from("erp_item_coberturas").insert(cob.map((c) => ({ ...c, item_id: it.id })));
      }

      // 4) origem: card inteiro + trilha (+ comentários, até o limite por rodada)
      const eventos = (eventosPorCard.get(id) ?? []).sort((a, b) => a.CREATED_TIME.localeCompare(b.CREATED_TIME)).map((e) => ({
        quando: e.CREATED_TIME, categoria: e.CATEGORY_ID, etapa: etapaPorId.get(e.STAGE_ID)?.nome ?? e.STAGE_ID, semantica: e.STAGE_SEMANTIC_ID,
      }));
      const { data: origemAtual } = await sb.from("erp_origens").select("id, comentarios_capturados_em, card_atualizado_em").eq("sistema", "bitrix").eq("entity_type_id", ENTITY_TYPE_ID).eq("item_id", id).maybeSingle();
      let comentarios: unknown[] | undefined;
      const precisaComentarios = comentariosRestantes > 0 && (!origemAtual?.comentarios_capturados_em || String(origemAtual.card_atualizado_em ?? "") < String(item.updatedTime));
      if (precisaComentarios) {
        comentarios = await lerComentarios(id);
        comentariosRestantes--;
        r.comentarios_capturados++;
      }
      const registro = {
        documento_id: docId, sistema: "bitrix", entity_type_id: ENTITY_TYPE_ID, item_id: id,
        categoria_id: Number(item.categoryId), etapa_id: item.stageId, titulo: item.title, url: gerarLinkCard(ENTITY_TYPE_ID, id),
        dados: item, dados_legiveis: dadosLegiveis(item, defs), historico_etapas: eventos,
        card_criado_em: item.createdTime, card_atualizado_em: item.updatedTime, capturado_em: new Date().toISOString(),
        ...(comentarios ? { comentarios, comentarios_capturados_em: new Date().toISOString() } : {}),
      };
      const { error: eOri } = await sb.from("erp_origens").upsert(registro, { onConflict: "sistema,entity_type_id,item_id" });
      if (eOri) throw new Error(eOri.message);
    } catch (e) {
      r.erros.push({ card: id, erro: (e as Error).message });
    }
  }
  return r;
}

async function lerComentarios(itemId: number): Promise<{ quando: string; autor: number | null; texto: string }[]> {
  try {
    const resp = await chamarBitrix<{ result: { COMMENT?: string; CREATED?: string; AUTHOR_ID?: string | number }[] }>("crm.timeline.comment.list", {
      "filter[ENTITY_ID]": itemId,
      "filter[ENTITY_TYPE]": `dynamic_${ENTITY_TYPE_ID}`,
      "select[]": ["ID", "COMMENT", "CREATED", "AUTHOR_ID"],
    } as never);
    return (resp.result ?? [])
      .map((c) => ({ quando: c.CREATED ?? "", autor: c.AUTHOR_ID ? Number(c.AUTHOR_ID) : null, texto: (c.COMMENT ?? "").replace(/\[\/?[A-Z]+[^\]]*\]/g, "").trim() }))
      .filter((c) => c.texto)
      .sort((a, b) => a.quando.localeCompare(b.quando));
  } catch {
    return [];
  }
}
