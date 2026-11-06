import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarDefinicaoCampos, listarItensSpaCategoria } from "@/lib/bitrix/client";

// ERP O2 — botão "Autorizar criação" da tela de Renovação (Matheus 06/11/2026). Cria no Bitrix os cards de renovação nos funis de destino, na primeira etapa:
//  - Ramos Elementares (SPA 1046, cat. 34): lotes de incêndio imobiliário e demais produtos, no padrão do robô de renovações RE;
//  - Seguro Fiança (SPA 1042, cat. 32), Capitalização (SPA 1048, cat. 38) e Automóvel (SPA 1050, cat. 30, funil padrão: só o título muda): 1 card por apólice.
// Quem opera o card depois é a equipe. Segurança: só roda a pedido de quem tem acesso ao ERP (checado na ação), confere duplicidade no Bitrix e no ERP e registra cada card em erp_renovacao_criacoes.
export const MAX_CARDS_POR_PEDIDO = 60;
export type BlocoCriacao = "fianca" | "cap" | "auto" | "re_lotes" | "re_demais";
export type PedidoCard = { titulo: string; documentoIds: string[] };
export type ResultadoCard = { titulo: string; itens: number; resultado: "criado" | "ignorado" | "erro" | "simulado"; bitrixId?: number; detalhe?: string };

const FUNIL: Record<BlocoCriacao, { entity: number; categoria: number; etapa: string }> = {
  re_lotes: { entity: 1046, categoria: 34, etapa: "DT1046_34:NEW" },
  re_demais: { entity: 1046, categoria: 34, etapa: "DT1046_34:NEW" },
  fianca: { entity: 1042, categoria: 32, etapa: "DT1042_32:NEW" },
  cap: { entity: 1048, categoria: 38, etapa: "DT1048_38:NEW" },
  auto: { entity: 1050, categoria: 30, etapa: "DT1050_30:NEW" },
};
// campo do card que guarda o Nº da apólice anterior em cada funil (para não duplicar)
const CAMPO_APOLICE: Record<BlocoCriacao, string> = { re_lotes: "ufCrm12NumApolice", re_demais: "ufCrm12NumApolice", fianca: "ufCrm10_1790800677", cap: "ufCrm14_1792781102", auto: "" };
const ITEM_UNICO = new Set<BlocoCriacao>(["fianca", "cap", "auto", "re_demais"]);

const NOME_SEG: Record<string, string> = { TOKI: "TOKIO", YELU: "YELLUM", PORT: "PORTO", ALLI: "ALLIANZ", ZURI: "ZURICH", ALF: "ALFA", BRAD: "BRADESCO" };
const SEG_FIANCA: Record<string, string> = { TOKI: "Tokio", PORT: "Porto", POTT: "Pottencial", TOO: "Too", JUNT: "Junto" };
const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const digitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

type DocBanco = {
  id: string; tipo: string; situacao: string; numero_apolice: string | null; numero_proposta: string | null; nosso_numero_corp: number | null; vigencia_inicio: string | null; vigencia_fim: string;
  premio_total: number | null; comissao_pct: number | null; imobiliaria_principal_id: string | null; seguradora_id: string | null; ramo_id: string | null; locatario_id: string | null;
};
type Loc = { id: string; nome: string | null; cpf: string | null; email: string | null; telefone: string | null; tipo_documento: string | null };
type Defs = Record<string, { items?: { ID: string; VALUE: string }[]; title?: string; formLabel?: string }>;

async function bitrixPost<T>(metodo: string, corpo: unknown): Promise<T> {
  const url = process.env.BITRIX_WEBHOOK_URL;
  if (!url) throw new Error("BITRIX_WEBHOOK_URL não configurada");
  const base = url.replace(/\/?$/, "/");
  for (let t = 0; ; t++) {
    const r = await fetch(`${base}${metodo}.json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), cache: "no-store" });
    const j = (await r.json()) as { result?: T; error?: string; error_description?: string };
    if (j.error === "QUERY_LIMIT_EXCEEDED" && t < 5) { await new Promise((s) => setTimeout(s, 1500 * (t + 1))); continue; }
    if (j.error || !r.ok) throw new Error(`${metodo}: ${j.error_description ?? j.error ?? r.status}`);
    return j.result as T;
  }
}

export async function criarCardsRenovacao(
  pedidos: PedidoCard[],
  ctx: { bloco: BlocoCriacao; de: string; ate: string; usuarioEmail: string; simular: boolean },
): Promise<ResultadoCard[]> {
  if (!pedidos.length) return [];
  if (pedidos.length > MAX_CARDS_POR_PEDIDO) throw new Error(`Máximo de ${MAX_CARDS_POR_PEDIDO} cards por vez; filtre por imobiliária ou seguradora e autorize em partes.`);
  const { entity: ENTITY, categoria: CATEGORIA, etapa: ETAPA } = FUNIL[ctx.bloco];
  const sb = createServiceClient();
  const lote = randomUUID();
  const resultados: ResultadoCard[] = [];

  const [{ data: segs }, { data: ramos }] = await Promise.all([
    sb.from("erp_seguradoras").select("id, abreviacao, nome"),
    sb.from("erp_ramos").select("id, nome, abreviacao, produto"),
  ]);
  const segPorId = new Map((segs ?? []).map((s) => [s.id as string, { abrev: String(s.abreviacao ?? ""), nome: String(s.nome ?? "") }]));
  const ramoPorId = new Map((ramos ?? []).map((r) => [r.id as string, { nome: String(r.nome ?? ""), produto: String(r.produto ?? "") }]));

  // Bitrix (só leitura até o momento de criar): opções de campos, cards existentes, responsável padrão
  const defs = (await buscarDefinicaoCampos(ENTITY)) as Defs;
  const opcaoOpc = (campo: string, valor: string) => {
    const alvo = norm(valor);
    const it = defs[campo]?.items?.find((i) => norm(i.VALUE) === alvo) ?? defs[campo]?.items?.find((i) => norm(i.VALUE).startsWith(alvo));
    return it ? Number(it.ID) : undefined;
  };
  const opcao = (campo: string, valor: string) => {
    const v = opcaoOpc(campo, valor);
    if (v === undefined) throw new Error(`opção "${valor}" não existe no campo ${campo} do Bitrix`);
    return v;
  };
  const campoAnterior = Object.entries(defs).find(([, d]) => /pr[eê]mio total anterior/i.test(d.title ?? d.formLabel ?? ""))?.[0];
  const existentes = (await listarItensSpaCategoria(ENTITY, CATEGORIA)) as unknown as Record<string, unknown>[];
  const titulosExistentes = new Set(existentes.map((i) => norm(String(i.title ?? ""))));
  const chavesExistentes = new Set<string>();
  const campoChave = CAMPO_APOLICE[ctx.bloco];
  if (campoChave) for (const i of existentes) for (const a of String(i[campoChave] ?? "").split(/[;,]/).map((x) => x.trim()).filter(Boolean)) chavesExistentes.add(a);
  const responsavel = [...existentes].sort((a, b) => String(b.createdTime ?? "").localeCompare(String(a.createdTime ?? "")))[0]?.assignedById as number | undefined;

  const registrar = async (r: ResultadoCard, ids: string[]) => {
    if (ctx.simular) return;
    await sb.from("erp_renovacao_criacoes").insert({
      lote_id: lote, usuario_email: ctx.usuarioEmail, bloco: ctx.bloco, periodo_de: ctx.de, periodo_ate: ctx.ate, titulo: r.titulo, itens: r.itens,
      documento_ids: ids, resultado: r.resultado === "simulado" ? "ignorado" : r.resultado, bitrix_card_id: r.bitrixId ? `${ENTITY}:${r.bitrixId}` : null, detalhe: r.detalhe ?? null,
    });
  };
  const ignorar = async (base: ResultadoCard, ids: string[], detalhe: string) => { const r = { ...base, resultado: "ignorado" as const, detalhe }; resultados.push(r); await registrar(r, ids); };

  for (const p of pedidos) {
    const ids = [...new Set(p.documentoIds)];
    const base: ResultadoCard = { titulo: p.titulo, itens: ids.length, resultado: "ignorado" };
    try {
      if (!p.titulo.trim() || !ids.length) throw new Error("pedido inválido");
      if ((ctx.bloco === "re_lotes" || ctx.bloco === "re_demais") && !/^RENOVAÇÃO - /.test(p.titulo)) throw new Error("título fora do padrão de Ramos Elementares");
      if (ITEM_UNICO.has(ctx.bloco) && ids.length !== 1) throw new Error("este funil tem 1 card por apólice");
      const { data: docsRaw } = await sb.from("erp_documentos")
        .select("id, tipo, situacao, numero_apolice, numero_proposta, nosso_numero_corp, vigencia_inicio, vigencia_fim, premio_total, comissao_pct, imobiliaria_principal_id, seguradora_id, ramo_id, locatario_id").in("id", ids);
      const docs = (docsRaw ?? []) as DocBanco[];
      if (docs.length !== ids.length) throw new Error("há documentos que não existem mais no ERP");
      if (docs.some((d) => d.tipo !== "A" || d.situacao !== "vigente")) throw new Error("há documento que não é apólice vigente");
      const funilDoDoc = docs.map((d) => ramoPorId.get(d.ramo_id ?? "")?.produto ?? "");
      const esperado = ctx.bloco === "fianca" ? "fianca" : ctx.bloco === "cap" ? "capitalizacao" : ctx.bloco === "auto" ? "automovel" : null;
      if (esperado && funilDoDoc.some((x) => x !== esperado)) throw new Error("a apólice não é do produto deste funil");
      if (!esperado && funilDoDoc.some((x) => ["fianca", "capitalizacao", "automovel"].includes(x))) throw new Error("a apólice pertence a outro funil");

      // já tem card? (ERP e Bitrix)
      const { data: lig } = await sb.from("erp_renovacoes").select("documento_id, bitrix_card_id").in("documento_id", ids).not("bitrix_card_id", "is", null);
      if (lig?.length) { await ignorar(base, ids, `${lig.length} apólice(s) já ligada(s) a card (${lig[0].bitrix_card_id})`); continue; }
      if (titulosExistentes.has(norm(p.titulo))) { await ignorar(base, ids, "já existe card com este título no funil (a equipe pode ter criado ou unido)"); continue; }
      const numeros = docs.map((d) => String(d.numero_apolice ?? "").trim()).filter((n) => /[1-9]/.test(n));
      const jaNoBitrix = numeros.filter((n) => chavesExistentes.has(n));
      if (jaNoBitrix.length) { await ignorar(base, ids, `apólice ${jaNoBitrix[0]} já está em card do funil`); continue; }

      // cancelada por endosso ou já renovada: não cria
      const { data: canc } = await sb.from("erp_documentos").select("documento_pai_id").in("documento_pai_id", ids).eq("tipo", "X").in("situacao", ["vigente", "proposta", "cancelado"]);
      if (canc?.length) throw new Error("há apólice com endosso de cancelamento");
      for (const id of ids) { const { data: suc } = await sb.rpc("erp_renovacao_tem_sucessora", { doc: id }); if (suc) throw new Error("há apólice que já tem renovação emitida"); }

      const fim = docs.map((d) => d.vigencia_fim).sort()[0];
      const premio = Math.round(docs.reduce((s, d) => s + Number(d.premio_total ?? 0), 0) * 100) / 100;
      const pcts = docs.map((d) => Number(d.comissao_pct ?? 0)).filter((x) => x > 0);
      const imobIds = [...new Set(docs.map((d) => d.imobiliaria_principal_id).filter(Boolean))] as string[];
      let companyId: number | null = null;
      let imobNome: string | null = null;
      if (imobIds.length === 1) {
        const [{ data: emp }, { data: im }] = await Promise.all([
          sb.from("imobiliaria_registros_fonte").select("chave_externa").eq("fonte", "bitrix_empresa").eq("situacao", "confirmado").eq("imobiliaria_id", imobIds[0]).limit(1),
          sb.from("imobiliarias").select("nome").eq("id", imobIds[0]).limit(1),
        ]);
        companyId = emp?.[0]?.chave_externa ? Number(emp[0].chave_externa) : null;
        imobNome = (im?.[0]?.nome as string | undefined) ?? null;
      }
      let parceriaEncerrada = false;
      for (const id of ids) { const { data: pe } = await sb.rpc("erp_parceria_encerrada", { p_doc: id }); if (pe) parceriaEncerrada = true; }
      const avisoParceria = parceriaEncerrada ? "Parceria encerrada com a imobiliária: comunicar a renovação ao segurado; sem previsão de receita de renovação." : "";
      const carimbo = `Card criado pelo ERP (botão Autorizar criação) por ${ctx.usuarioEmail} em ${dataBr(new Date().toISOString().slice(0, 10))}.`;
      let loc: Loc | null = null;
      if (ITEM_UNICO.has(ctx.bloco) && docs[0].locatario_id) {
        const { data: l } = await sb.from("locatarios").select("id, nome, cpf, email, telefone, tipo_documento").eq("id", docs[0].locatario_id).limit(1);
        loc = (l?.[0] as Loc | undefined) ?? null;
      }
      const seg = segPorId.get(docs[0].seguradora_id ?? "");

      let fields: Record<string, unknown>;
      let resumo: string;
      if (ctx.bloco === "re_lotes" || ctx.bloco === "re_demais") {
        const ramoNomes = docs.map((d) => ramoPorId.get(d.ramo_id ?? "")?.nome ?? "");
        const ehImob = ramoNomes.some((n) => /IMOBILIARIO/.test(n));
        const ramoUm = ramoNomes[0] ?? "";
        const produto = ehImob ? "Incêndio Imobiliário" : /RESIDENCIAL/.test(ramoUm) ? "Incêndio Individual Residencial" : /EMPRESARIAL/.test(ramoUm) ? "Incêndio Individual Empresarial" : /CONDOMINIO/.test(ramoUm) ? "Condomínio" : "";
        const segimob = /- SEG\//.test(p.titulo);
        const abrevSeg = [...new Set(docs.map((d) => segPorId.get(d.seguradora_id ?? "")?.abrev ?? ""))];
        if (abrevSeg.length !== 1 || !abrevSeg[0]) throw new Error("o card mistura seguradoras ou há apólice sem seguradora");
        const segCampo = `${segimob ? "SEG/" : ""}${NOME_SEG[abrevSeg[0]] ?? abrevSeg[0]}`;
        const { data: prods } = await sb.from("erp_documento_produtores").select("produtor_corp_nome").in("documento_id", ids);
        const nomesProd = (prods ?? []).map((x) => norm(String(x.produtor_corp_nome ?? "")));
        const superlogica = nomesProd.some((n) => n.startsWith("SUPERLOGICA"));
        const origem = segimob ? "Segimob" : superlogica && !ehImob ? "Outro" : "Ficha";
        const obs = [
          `Quantidade de itens: ${docs.length}`,
          numeros.length ? `Apólices: ${numeros.join("; ")}` : "Apólice sem número no ERP — conferir.",
          `Prêmio total do ano anterior: ${reais(premio)}.`, carimbo,
          companyId ? "" : "Empresa do Bitrix não identificada pelo cadastro único — vincular à mão.", avisoParceria,
        ].filter(Boolean).join("\n");
        fields = {
          ...(companyId ? { companyId } : {}),
          ufCrm12TipoProcesso: opcao("ufCrm12TipoProcesso", "Renovação"),
          ...(produto ? { ufCrm12Produto: opcao("ufCrm12Produto", produto) } : {}),
          ufCrm12SeguradoraFinalMulti: [opcao("ufCrm12SeguradoraFinalMulti", segCampo)],
          ufCrm12OrigemProducao: opcao("ufCrm12OrigemProducao", origem),
          ufCrm12CompetenciaOperacional: `${fim.slice(0, 7)}-01`, ufCrm12FimVigencia: fim, ufCrm12QtdEnderecos: docs.length,
          ...(pcts.length ? { ufCrm12_1788368973918: Math.min(...pcts) } : {}),
          ...(campoAnterior ? { [campoAnterior]: `${premio}|BRL` } : {}),
          ufCrm12Observacoes: obs,
          ...(numeros.length ? { ufCrm12NumApolice: numeros.join("; ") } : {}),
        };
        resumo = `${segCampo} · ${produto || "sem produto"} · ${docs.length} item(ns) · fim ${dataBr(fim)} · empresa ${companyId ?? "não identificada"}`;
      } else if (ctx.bloco === "fianca") {
        const d = docs[0];
        const segAnt = seg ? opcaoOpc("ufCrm10_1790800679", SEG_FIANCA[seg.abrev] ?? seg.nome) : undefined;
        const tel = Number(digitos(loc?.telefone));
        fields = {
          ...(companyId ? { companyId } : {}),
          ...(responsavel ? { assignedById: responsavel } : {}),
          ufCrm10_1790800677: d.numero_apolice ?? "",
          ufCrm10_1790800678: d.vigencia_fim,
          ...(segAnt ? { ufCrm10_1790800679: segAnt } : {}),
          ...(d.nosso_numero_corp ? { ufCrm10_1778258392: d.nosso_numero_corp } : {}),
          ...(loc?.nome ? { ufCrm10_1776354897: loc.nome } : {}),
          ...(digitos(loc?.cpf).length === 11 ? { ufCrm10_1776351609: digitos(loc?.cpf) } : {}),
          ...(loc?.email ? { ufCrm10_1783366659: loc.email } : {}),
          ...(tel ? { ufCrm10_1783366668: tel } : {}),
        };
        resumo = `Fiança · apólice anterior ${d.numero_apolice} · fim ${dataBr(d.vigencia_fim)} · empresa ${companyId ?? "não identificada"}${avisoParceria ? " · parceria encerrada" : ""}`;
      } else if (ctx.bloco === "cap") {
        const d = docs[0];
        const pj = digitos(loc?.cpf).length > 11 || /cnpj/i.test(loc?.tipo_documento ?? "");
        const segCap = seg?.nome ? opcaoOpc("ufCrm14_1786578873414", seg.nome) : undefined;
        fields = {
          ufCrm14_1792781102: d.numero_apolice ?? "",
          ...(imobNome ? { ufCrm14CapImobAdmin: imobNome } : {}),
          ufCrm14CapValorTit: `${Number(d.premio_total ?? 0)}|BRL`,
          ...(seg?.nome ? { ufCrm14CapSeguradora: seg.nome.toUpperCase() } : {}),
          ...(segCap ? { ufCrm14_1786578873414: segCap } : {}),
          ...(d.vigencia_inicio ? { ufCrm14CapVigInicio: d.vigencia_inicio } : {}),
          ufCrm14CapVigFim: d.vigencia_fim,
          ...(pcts.length ? { ufCrm14CapComissaoPct: pcts[0] } : {}),
          ...(responsavel ? { assignedById: responsavel } : {}),
          ...(opcaoOpc("ufCrm14CapTipoLocat", pj ? "Pessoa jurídica" : "Pessoa física") ? { ufCrm14CapTipoLocat: opcaoOpc("ufCrm14CapTipoLocat", pj ? "Pessoa jurídica" : "Pessoa física") } : {}),
          ...(pj ? { ufCrm14CapLocatPjRazao: loc?.nome ?? "", ufCrm14CapLocatPjCnpj: digitos(loc?.cpf) } : { ufCrm14CapLocatPfNome: loc?.nome ?? "", ufCrm14CapLocatPfCpf: digitos(loc?.cpf) }),
          ...(loc?.email ? { ufCrm14CapLocatEmail: loc.email } : {}),
          ...(loc?.telefone ? { ufCrm14CapLocatFone: digitos(loc.telefone) } : {}),
          ufCrm14CapGarantia: [carimbo, avisoParceria].filter(Boolean).join(" "),
        };
        resumo = `Capitalização · título ${d.numero_apolice} · fim ${dataBr(d.vigencia_fim)} · valor ${reais(Number(d.premio_total ?? 0))}${avisoParceria ? " · parceria encerrada" : ""}`;
      } else {
        const tel = loc?.telefone ? String(loc.telefone) : "";
        fields = {
          ...(responsavel ? { assignedById: responsavel } : {}),
          ...(loc?.nome ? { ufCrm16_1787056933080: loc.nome } : {}),
          ...(loc?.email ? { ufCrm16_1787056957386: loc.email } : {}),
          ...(tel ? { ufCrm16_1787056962877: tel } : {}),
        };
        resumo = `Automóvel · funil padrão (SPA 1050) · apólice anterior ${docs[0].numero_apolice} · fim ${dataBr(docs[0].vigencia_fim)}`;
      }
      fields = { title: p.titulo, categoryId: CATEGORIA, stageId: ETAPA, ...fields };

      if (ctx.simular) { resultados.push({ ...base, resultado: "simulado", detalhe: `criaria: ${resumo}` }); continue; }

      const r = await bitrixPost<{ item: { id: number } }>("crm.item.add", { entityTypeId: ENTITY, fields });
      const bitrixId = r.item.id;
      titulosExistentes.add(norm(p.titulo));
      for (const n of numeros) chavesExistentes.add(n);
      // liga ao ERP (a equipe opera o card depois; o ERP só acompanha)
      const agora = new Date().toISOString();
      for (const d of docs) {
        const valor = { bitrix_card_id: `${ENTITY}:${bitrixId}`, status: "a_renovar", vence_em: d.vigencia_fim, card_titulo: p.titulo, card_etapa: ETAPA, card_ligado_via: "criado_pelo_erp", fonte: "ERP", fonte_nivel: 6, lido_em: agora, card_criado_em: agora, updated_at: agora };
        const { data: ja } = await sb.from("erp_renovacoes").select("id").eq("documento_id", d.id).limit(1);
        if (ja?.length) await sb.from("erp_renovacoes").update(valor).eq("id", ja[0].id);
        else await sb.from("erp_renovacoes").insert({ documento_id: d.id, ...valor });
      }
      const ok: ResultadoCard = { ...base, resultado: "criado", bitrixId };
      resultados.push(ok);
      await registrar(ok, ids);
    } catch (e) {
      const err: ResultadoCard = { ...base, resultado: "erro", detalhe: e instanceof Error ? e.message : String(e) };
      resultados.push(err);
      await registrar(err, ids);
    }
  }
  return resultados;
}
