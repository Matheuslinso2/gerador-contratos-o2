import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarDefinicaoCampos, listarItensSpaCategoria } from "@/lib/bitrix/client";

// ERP O2 — botão "Autorizar criação" da tela de Renovação (Matheus 06/11/2026): cria no Bitrix os cards de renovação de Ramos Elementares
// (SPA 1046, funil Renovações, categoria 34, etapa "Entrada e conferência"), no mesmo padrão do robô de renovações RE. Quem opera o card depois é a equipe.
// Segurança: só roda a pedido de quem tem acesso ao ERP (checado na ação), confere duplicidade no Bitrix e no ERP, e registra cada card em erp_renovacao_criacoes.
const ENTITY = 1046;
const CATEGORIA = 34;
const ETAPA = "DT1046_34:NEW";
export const MAX_CARDS_POR_PEDIDO = 60;

export type PedidoCard = { titulo: string; documentoIds: string[] };
export type ResultadoCard = { titulo: string; itens: number; resultado: "criado" | "ignorado" | "erro" | "simulado"; bitrixId?: number; detalhe?: string };

const NOME_SEG: Record<string, string> = { TOKI: "TOKIO", YELU: "YELLUM", PORT: "PORTO", ALLI: "ALLIANZ", ZURI: "ZURICH", ALF: "ALFA", BRAD: "BRADESCO" };
const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

type DocBanco = {
  id: string; tipo: string; situacao: string; numero_apolice: string | null; vigencia_fim: string; premio_total: number | null; comissao_pct: number | null;
  imobiliaria_principal_id: string | null; seguradora_id: string | null; ramo_id: string | null;
};

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

export async function criarCardsRenovacaoRE(
  pedidos: PedidoCard[],
  ctx: { bloco: string; de: string; ate: string; usuarioEmail: string; simular: boolean },
): Promise<ResultadoCard[]> {
  if (!pedidos.length) return [];
  if (pedidos.length > MAX_CARDS_POR_PEDIDO) throw new Error(`Máximo de ${MAX_CARDS_POR_PEDIDO} cards por vez; filtre por imobiliária ou seguradora e autorize em partes.`);
  const sb = createServiceClient();
  const lote = randomUUID();
  const resultados: ResultadoCard[] = [];

  // tabelas pequenas de apoio
  const [{ data: segs }, { data: ramos }] = await Promise.all([
    sb.from("erp_seguradoras").select("id, abreviacao"),
    sb.from("erp_ramos").select("id, nome, abreviacao, produto"),
  ]);
  const segPorId = new Map((segs ?? []).map((s) => [s.id as string, String(s.abreviacao ?? "")]));
  const ramoPorId = new Map((ramos ?? []).map((r) => [r.id as string, { nome: String(r.nome ?? ""), produto: String(r.produto ?? "") }]));

  // Bitrix (só leitura até aqui): opções de campos, cards existentes, responsável padrão
  const defs = (await buscarDefinicaoCampos(ENTITY)) as Record<string, { items?: { ID: string; VALUE: string }[]; title?: string; formLabel?: string }>;
  const opcao = (campo: string, valor: string) => {
    const it = defs[campo]?.items?.find((i) => i.VALUE.toUpperCase() === valor.toUpperCase());
    if (!it) throw new Error(`opção "${valor}" não existe no campo ${campo} do Bitrix`);
    return Number(it.ID);
  };
  const campoAnterior = Object.entries(defs).find(([, d]) => /pr[eê]mio total anterior/i.test(d.title ?? d.formLabel ?? ""))?.[0];
  const existentes = await listarItensSpaCategoria(ENTITY, CATEGORIA);
  const titulosExistentes = new Set(existentes.map((i) => norm(String(i.title ?? ""))));
  const apolicesExistentes = new Set<string>();
  for (const i of existentes as unknown as Record<string, unknown>[]) for (const a of String(i["ufCrm12NumApolice"] ?? "").split(/[;,]/).map((x) => x.trim()).filter(Boolean)) apolicesExistentes.add(a);
  const responsavel = ([...existentes] as unknown as Record<string, unknown>[]).sort((a, b) => String(b.createdTime ?? "").localeCompare(String(a.createdTime ?? "")))[0]?.assignedById as number | undefined;

  const registrar = async (r: ResultadoCard, ids: string[]) => {
    if (ctx.simular) return;
    await sb.from("erp_renovacao_criacoes").insert({
      lote_id: lote, usuario_email: ctx.usuarioEmail, bloco: ctx.bloco, periodo_de: ctx.de, periodo_ate: ctx.ate, titulo: r.titulo, itens: r.itens,
      documento_ids: ids, resultado: r.resultado === "simulado" ? "ignorado" : r.resultado, bitrix_card_id: r.bitrixId ? `${ENTITY}:${r.bitrixId}` : null, detalhe: r.detalhe ?? null,
    });
  };

  for (const p of pedidos) {
    const ids = [...new Set(p.documentoIds)];
    const base: ResultadoCard = { titulo: p.titulo, itens: ids.length, resultado: "ignorado" };
    try {
      if (!/^RENOVAÇÃO - /.test(p.titulo) || !ids.length) throw new Error("pedido inválido");
      const { data: docsRaw } = await sb.from("erp_documentos")
        .select("id, tipo, situacao, numero_apolice, vigencia_fim, premio_total, comissao_pct, imobiliaria_principal_id, seguradora_id, ramo_id").in("id", ids);
      const docs = (docsRaw ?? []) as DocBanco[];
      if (docs.length !== ids.length) throw new Error("há documentos que não existem mais no ERP");
      if (docs.some((d) => d.tipo !== "A" || d.situacao !== "vigente")) throw new Error("há documento que não é apólice vigente");

      // já tem card? (ERP e Bitrix)
      const { data: lig } = await sb.from("erp_renovacoes").select("documento_id, bitrix_card_id").in("documento_id", ids).not("bitrix_card_id", "is", null);
      if (lig?.length) { Object.assign(base, { resultado: "ignorado", detalhe: `${lig.length} apólice(s) já ligada(s) a card (${lig[0].bitrix_card_id})` }); resultados.push(base); await registrar(base, ids); continue; }
      if (titulosExistentes.has(norm(p.titulo))) { Object.assign(base, { resultado: "ignorado", detalhe: "já existe card com este título no funil (a equipe pode ter criado ou unido)" }); resultados.push(base); await registrar(base, ids); continue; }
      const numeros = docs.map((d) => String(d.numero_apolice ?? "").trim()).filter((n) => /[1-9]/.test(n));
      const jaNoBitrix = numeros.filter((n) => apolicesExistentes.has(n));
      if (jaNoBitrix.length) { Object.assign(base, { resultado: "ignorado", detalhe: `apólice ${jaNoBitrix[0]} já está em card do funil` }); resultados.push(base); await registrar(base, ids); continue; }

      // cancelada por endosso ou já renovada: não cria
      const { data: canc } = await sb.from("erp_documentos").select("documento_pai_id").in("documento_pai_id", ids).eq("tipo", "X").in("situacao", ["vigente", "proposta", "cancelado"]);
      if (canc?.length) throw new Error("há apólice com endosso de cancelamento");
      for (const id of ids) { const { data: suc } = await sb.rpc("erp_renovacao_tem_sucessora", { doc: id }); if (suc) throw new Error("há apólice que já tem renovação emitida"); }

      // campos do card
      const ramoNomes = docs.map((d) => ramoPorId.get(d.ramo_id ?? "")?.nome ?? "");
      const ehImob = ramoNomes.some((n) => /IMOBILIARIO/.test(n));
      const ramoUm = ramoNomes[0] ?? "";
      const produto = ehImob ? "Incêndio Imobiliário" : /RESIDENCIAL/.test(ramoUm) ? "Incêndio Individual Residencial" : /EMPRESARIAL/.test(ramoUm) ? "Incêndio Individual Empresarial" : /CONDOMINIO/.test(ramoUm) ? "Condomínio" : "";
      const segimob = /- SEG\//.test(p.titulo);
      const abrevSeg = [...new Set(docs.map((d) => segPorId.get(d.seguradora_id ?? "") ?? ""))];
      if (abrevSeg.length !== 1 || !abrevSeg[0]) throw new Error("o card mistura seguradoras ou há apólice sem seguradora");
      const segCampo = `${segimob ? "SEG/" : ""}${NOME_SEG[abrevSeg[0]] ?? abrevSeg[0]}`;
      const imobIds = [...new Set(docs.map((d) => d.imobiliaria_principal_id).filter(Boolean))] as string[];
      let companyId: number | null = null;
      if (imobIds.length === 1) {
        const { data: emp } = await sb.from("imobiliaria_registros_fonte").select("chave_externa").eq("fonte", "bitrix_empresa").eq("situacao", "confirmado").eq("imobiliaria_id", imobIds[0]).limit(1);
        companyId = emp?.[0]?.chave_externa ? Number(emp[0].chave_externa) : null;
      }
      const { data: prods } = await sb.from("erp_documento_produtores").select("produtor_corp_nome").in("documento_id", ids);
      const nomesProd = (prods ?? []).map((x) => norm(String(x.produtor_corp_nome ?? "")));
      const superlogica = nomesProd.some((n) => n.startsWith("SUPERLOGICA"));
      const origem = segimob ? "Segimob" : superlogica && !ehImob ? "Outro" : "Ficha";
      let parceriaEncerrada = false;
      for (const id of ids) { const { data: pe } = await sb.rpc("erp_parceria_encerrada", { p_doc: id }); if (pe) parceriaEncerrada = true; }

      const fim = docs.map((d) => d.vigencia_fim).sort()[0];
      const premio = Math.round(docs.reduce((s, d) => s + Number(d.premio_total ?? 0), 0) * 100) / 100;
      const pcts = docs.map((d) => Number(d.comissao_pct ?? 0)).filter((x) => x > 0);
      const obs = [
        `Quantidade de itens: ${docs.length}`,
        numeros.length ? `Apólices: ${numeros.join("; ")}` : "Apólice sem número no ERP — conferir.",
        `Prêmio total do ano anterior: ${reais(premio)}.`,
        `Card criado pelo ERP (botão Autorizar criação) por ${ctx.usuarioEmail} em ${dataBr(new Date().toISOString().slice(0, 10))}.`,
        companyId ? "" : "Empresa do Bitrix não identificada pelo cadastro único — vincular à mão.",
        parceriaEncerrada ? "Parceria encerrada com a imobiliária: comunicar a renovação ao segurado; sem previsão de receita de renovação." : "",
      ].filter(Boolean).join("\n");
      const fields: Record<string, unknown> = {
        title: p.titulo, categoryId: CATEGORIA, stageId: ETAPA,
        ...(companyId ? { companyId } : {}),
        ufCrm12TipoProcesso: opcao("ufCrm12TipoProcesso", "Renovação"),
        ...(produto ? { ufCrm12Produto: opcao("ufCrm12Produto", produto) } : {}),
        ufCrm12SeguradoraFinalMulti: [opcao("ufCrm12SeguradoraFinalMulti", segCampo)],
        ufCrm12OrigemProducao: opcao("ufCrm12OrigemProducao", origem),
        ...(responsavel ? { assignedById: responsavel } : {}),
        ufCrm12CompetenciaOperacional: `${fim.slice(0, 7)}-01`,
        ufCrm12FimVigencia: fim,
        ufCrm12QtdEnderecos: docs.length,
        ...(pcts.length ? { ufCrm12_1788368973918: Math.min(...pcts) } : {}),
        ...(campoAnterior ? { [campoAnterior]: `${premio}|BRL` } : {}),
        ufCrm12Observacoes: obs,
        ...(numeros.length ? { ufCrm12NumApolice: numeros.join("; ") } : {}),
      };

      if (ctx.simular) { resultados.push({ ...base, resultado: "simulado", detalhe: `criaria: ${segCampo} · ${produto || "sem produto"} · ${docs.length} item(ns) · fim ${dataBr(fim)} · empresa ${companyId ?? "não identificada"}` }); continue; }

      const r = await bitrixPost<{ item: { id: number } }>("crm.item.add", { entityTypeId: ENTITY, fields });
      const bitrixId = r.item.id;
      titulosExistentes.add(norm(p.titulo));
      for (const n of numeros) apolicesExistentes.add(n);
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
