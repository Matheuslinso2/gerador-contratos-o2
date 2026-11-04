process.loadEnvFile(".env.local");
// Lê TODOS os comentários da linha do tempo dos cards do CRM (Fiança, RE/Incêndio, Capitalização, deals) uma vez
// e grava em bitrix_card_comentarios, com a tratativa ("TRATATIVA: <assunto do e-mail>") já separada.
// A API só devolve comentários card a card: lista os IDs de cada funil e consulta 20 cards por chamada (batch).
// Cards já lidos não são relidos (use --reler para refazer). Senhas escritas no comentário são mascaradas.
// Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/ler-comentarios-bitrix.ts [--reler]
import { chamarBitrix } from "@/lib/bitrix/client";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const RELER = process.argv.includes("--reler");
const TIPOS: [string, number][] = [["dynamic_1042", 1042], ["dynamic_1046", 1046], ["dynamic_1048", 1048], ["dynamic_1050", 1050], ["deal", 2]];

type Comentario = { ID: string; ENTITY_ID: string; CREATED?: string; AUTHOR_ID?: string; COMMENT?: string };

const mascarar = (t: string) => t.replace(/(senha|password|pwd)(\s*[:=-]?\s*)\S+/gi, "$1$2***");
// tira imagens/formatação do Bitrix ([IMG]...[/IMG], [B], [LIST]...) antes de procurar "TRATATIVA: <assunto>"
const tratativa = (t: string) =>
  /(?:^|\n)\s*TRATATIVA\s*:\s*([^\n]+)/i.exec(t.replace(/\[IMG[^\]]*\][\s\S]*?\[\/IMG\]/gi, "").replace(/\[\/?[A-Z*]+[^\]]*\]/gi, ""))?.[1]?.trim().slice(0, 300) ?? null;

async function idsDoFunil(entityTypeId: number): Promise<number[]> {
  const ids: number[] = [];
  let desde = 0;
  for (;;) {
    const r = entityTypeId === 2
      ? await chamarBitrix<{ result: { ID: string }[] }>("crm.deal.list", { "filter[>ID]": desde, "order[ID]": "ASC", select: ["ID"], start: -1 })
      : await chamarBitrix<{ result: { items: { id: number }[] } }>("crm.item.list", { entityTypeId, "filter[>id]": desde, "order[id]": "ASC", select: ["id"], start: -1 });
    const lote = entityTypeId === 2 ? (r.result as { ID: string }[]).map((x) => Number(x.ID)) : (r.result as { items: { id: number }[] }).items.map((x) => x.id);
    if (!lote.length) break;
    ids.push(...lote);
    desde = lote[lote.length - 1];
  }
  return ids;
}

async function lerTipo(tipo: string, entityTypeId: number) {
  let ids = await idsDoFunil(entityTypeId);
  if (!RELER) {
    const lidos = new Set<number>();
    for (let de = 0; ; de += 1000) {
      const { data } = await sb.from("bitrix_card_comentarios_lidos").select("item_id").eq("entity_type_id", entityTypeId).range(de, de + 999);
      (data ?? []).forEach((x) => lidos.add(Number(x.item_id)));
      if (!data || data.length < 1000) break;
    }
    ids = ids.filter((i) => !lidos.has(i));
  }
  console.log(new Date().toISOString(), tipo, "cards a ler:", ids.length);
  let total = 0;
  // batch vai por GET: 20 cards por chamada para a URL não passar do limite (HTTP 414)
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    const params: Record<string, string> = { halt: "0" };
    bloco.forEach((id) => {
      params[`cmd[c${id}]`] = `crm.timeline.comment.list?filter[ENTITY_ID]=${id}&filter[ENTITY_TYPE]=${tipo}`;
    });
    const r = await chamarBitrix<{ result: { result: Record<string, Comentario[]> } }>("batch", params);
    const linhas = Object.values(r.result?.result ?? {}).flat().map((c) => {
      const texto = mascarar(String(c.COMMENT ?? "")).replace(/\u0000/g, "");
      return {
        id: Number(c.ID), entity_type: tipo, entity_type_id: entityTypeId, item_id: Number(c.ENTITY_ID),
        criado: c.CREATED || null, autor_id: c.AUTHOR_ID ? Number(c.AUTHOR_ID) : null, comentario: texto, tratativa: tratativa(texto),
      };
    });
    if (linhas.length) {
      const { error } = await sb.from("bitrix_card_comentarios").upsert(linhas);
      if (error) throw new Error(`${tipo}: ${error.message}`);
    }
    const { error: e2 } = await sb.from("bitrix_card_comentarios_lidos").upsert(bloco.map((id) => ({ entity_type_id: entityTypeId, item_id: id, lido_em: new Date().toISOString() })));
    if (e2) throw new Error(`${tipo}: ${e2.message}`);
    total += linhas.length;
    if ((i / 20) % 25 === 0) console.log(new Date().toISOString(), tipo, `${i + bloco.length}/${ids.length} cards`, total, "comentários");
  }
  console.log(tipo, "comentários gravados:", total);
}

async function main() {
  for (const [tipo, id] of TIPOS) {
    try { await lerTipo(tipo, id); } catch (e) { console.error(String(e)); }
  }
}
main();
