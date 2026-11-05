process.loadEnvFile(".env.local");
// Baixa (SÓ LEITURA no Bitrix) TODOS os arquivos anexados aos comentários dos cards das SPAs (1042 Fiança, 1046 RE, 1048 Capitalização, 1050 Auto),
// guarda no bucket privado bitrix-cards-arquivos, tabela em bitrix_card_arquivos (tipo inferido, sha256, vínculo ao documento pelo card em erp_origens).
// PDFs: grava também a leitura estruturada (bitrix_comentario_pdf_leitura, sem texto bruto). Proposta/apólice/endosso ligados a documento viram anexo da
// ficha (erp_documento_anexos, origem 'bitrix'). Retomável (pula file_id já baixado), um download por vez.
// Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/baixar-arquivos-cards-bitrix.ts [--so 1042,1046] [--limite N]
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { chamarBitrix } from "@/lib/bitrix/client";
import { chamadorBitrix } from "@/lib/erp/tarefaCadastro";
import { extrairTextoPdfComPaginas } from "@/lib/extrairTextoPdf";
import { lerPropostaPdf, tipoDoArquivo } from "@/lib/erp/leituraPropostaPdf";
import { guardarAnexo } from "@/lib/erp/anexosEmail";

const sb = createServiceClient();
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const SO = arg("so") ? arg("so")!.split(",").map(Number) : [1042, 1046, 1048, 1050];
const LIMITE = Number(arg("limite") ?? 1e9);
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", csv: "text/csv", txt: "text/plain", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg", ogg: "audio/ogg" };
const seguro = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);

type Arq = { id: number; name: string | null; size: number | null; date: string | null; autor: string | null };

// pagina sempre com ordem por chave única (sem ordem, range() pula linhas)
async function todas<T>(tabela: string, cols: string, ordem: string[], filtro?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.from(tabela).select(cols);
    if (filtro) q = filtro(q);
    for (const o of ordem) q = q.order(o);
    q = q.range(de, de + 999);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

// --sincronizar: antes de baixar, relê os comentários SÓ dos cards alterados no Bitrix desde a última varredura (por SPA), para o agendamento de hora em hora.
const mascarar = (t: string) => t.replace(/(senha|password|pwd)(\s*[:=-]?\s*)\S+/gi, "$1$2***");
const tratativa = (t: string) => /(?:^|\n)\s*TRATATIVA\s*:\s*([^\n]+)/i.exec(t.replace(/\[IMG[^\]]*\][\s\S]*?\[\/IMG\]/gi, "").replace(/\[\/?[A-Z*]+[^\]]*\]/gi, ""))?.[1]?.trim().slice(0, 300) ?? null;
async function capturarAlterados(): Promise<void> {
  for (const entity of SO) {
    const inicio = new Date();
    const { data: est } = await sb.from("bitrix_arquivos_estado").select("ultima_varredura").eq("entity_type_id", entity).maybeSingle();
    // 15 min de folga sobre a última varredura; primeira vez: 7 dias
    const desde = new Date((est?.ultima_varredura ? Date.parse(est.ultima_varredura) : Date.now() - 7 * 864e5) - 15 * 60e3).toISOString();
    const ids: number[] = [];
    for (let ate = 0; ; ) {
      const r = await chamarBitrix<{ result: { items: { id: number }[] } }>("crm.item.list", { entityTypeId: entity, "filter[>=updatedTime]": desde, "filter[>id]": ate, "order[id]": "ASC", select: ["id"], start: -1 });
      const lote = r.result.items.map((x) => Number(x.id)); if (!lote.length) break;
      ids.push(...lote); ate = lote[lote.length - 1];
    }
    let novos = 0;
    for (let i = 0; i < ids.length; i += 20) {
      const bloco = ids.slice(i, i + 20);
      const params: Record<string, string> = { halt: "0" };
      bloco.forEach((id) => { params[`cmd[c${id}]`] = `crm.timeline.comment.list?filter[ENTITY_ID]=${id}&filter[ENTITY_TYPE]=dynamic_${entity}`; });
      const r = await chamarBitrix<{ result: { result: Record<string, { ID: string; ENTITY_ID: string; CREATED?: string; AUTHOR_ID?: string; COMMENT?: string; FILES?: Record<string, Arq & { authorName?: string }> | (Arq & { authorName?: string })[] }[]> } }>("batch", params);
      const linhas = Object.values(r.result?.result ?? {}).flat().map((c) => {
        const texto = mascarar(String(c.COMMENT ?? "")).replace(/\u0000/g, "");
        const lista = (Array.isArray(c.FILES) ? c.FILES : Object.values(c.FILES ?? {})) as (Arq & { authorName?: string })[];
        const arquivos = lista.length ? lista.map((f) => ({ id: Number(f.id), name: f.name ?? null, size: f.size ?? null, date: f.date ?? null, autor: f.authorName ?? null })) : null;
        novos += arquivos?.length ?? 0;
        return { id: Number(c.ID), entity_type: `dynamic_${entity}`, entity_type_id: entity, item_id: Number(c.ENTITY_ID), criado: c.CREATED || null, autor_id: c.AUTHOR_ID ? Number(c.AUTHOR_ID) : null, comentario: texto, tratativa: tratativa(texto), arquivos };
      });
      if (linhas.length) { const { error } = await sb.from("bitrix_card_comentarios").upsert(linhas); if (error) throw new Error(error.message); }
    }
    await sb.from("bitrix_arquivos_estado").upsert({ entity_type_id: entity, ultima_varredura: inicio.toISOString(), cards_alterados: ids.length, arquivos_novos: novos, atualizado_em: new Date().toISOString() });
    console.log(new Date().toISOString(), `SPA ${entity}: ${ids.length} cards alterados desde ${desde.slice(0, 16)}, ${novos} anexos nos comentários`);
  }
}

(async () => {
  if (process.argv.includes("--sincronizar")) await capturarAlterados();
  const coms = await todas<{ id: number; entity_type_id: number; item_id: number; comentario: string; arquivos: Arq[] }>("bitrix_card_comentarios", "id, entity_type_id, item_id, comentario, arquivos", ["id"], (q) => q.not("arquivos", "is", null).in("entity_type_id", SO));
  const origens = await todas<{ item_id: number; entity_type_id: number; documento_id: string | null }>("erp_origens", "item_id, entity_type_id, documento_id", ["entity_type_id", "item_id"], (q) => q.in("entity_type_id", SO));
  const docDoCard = new Map(origens.filter((o) => o.documento_id).map((o) => [`${o.entity_type_id}:${o.item_id}`, o.documento_id as string]));
  const feitos = new Set((await todas<{ file_id: number }>("bitrix_card_arquivos", "file_id", ["file_id"])).map((x) => Number(x.file_id)));
  const fila: { c: (typeof coms)[number]; a: Arq }[] = [];
  for (const c of coms) for (const a of c.arquivos ?? []) if (!feitos.has(Number(a.id)) && !fila.some((f) => f.a.id === a.id)) fila.push({ c, a });
  console.log(new Date().toISOString(), "arquivos nos comentários:", coms.reduce((s, c) => s + (c.arquivos?.length ?? 0), 0), "| a baixar:", fila.length);
  const r = { baixados: 0, erro: 0, pdfLidos: 0, anexosFicha: 0, comDocumento: 0 };
  let n = 0;
  for (const { c, a } of fila) {
    if (n++ >= LIMITE) break;
    const nome = a.name ?? `arquivo-${a.id}`;
    const ext = (nome.split(".").pop() ?? "").toLowerCase();
    const tipo = tipoDoArquivo(nome, c.comentario ?? "");
    const documento_id = docDoCard.get(`${c.entity_type_id}:${c.item_id}`) ?? null;
    const base = { file_id: a.id, entity_type_id: c.entity_type_id, item_id: c.item_id, comentario_id: c.id, nome, tamanho: a.size, tipo, anexado_no_bitrix_em: a.date, autor: a.autor, documento_id, vinculo: documento_id ? "card (erp_origens)" : null };
    try {
      const g = await bx("disk.file.get", { id: a.id });
      const url = String(g.result?.DOWNLOAD_URL ?? "");
      if (!url) throw new Error("sem link de download");
      const resp = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const sha = createHash("sha256").update(buf).digest("hex");
      const caminho = `${c.entity_type_id}/${c.item_id}/${a.id}-${seguro(nome)}`;
      const mime = MIME[ext] ?? "application/octet-stream";
      const { error: eu } = await sb.storage.from("bitrix-cards-arquivos").upload(caminho, buf, { contentType: mime, upsert: true });
      if (eu) throw new Error(`upload: ${eu.message}`);
      let anexo = false;
      if (ext === "pdf" && buf.subarray(0, 4).toString() === "%PDF") {
        let texto = "";
        try {
          const { texto: t, numPaginas } = await extrairTextoPdfComPaginas(buf);
          texto = t;
          const dado = t.length >= 80 ? lerPropostaPdf(t) : null;
          await sb.from("bitrix_comentario_pdf_leitura").upsert({ file_id: a.id, entity_type_id: c.entity_type_id, item_id: c.item_id, comentario_id: c.id, nome, tamanho: a.size, situacao: dado ? "lido" : "sem_texto", seguradora: dado?.seg ?? null, numeros: dado?.numeros ?? null, documentos: dado?.docs ?? null, premios: dado?.premios ?? null, paginas: numPaginas });
          if (dado) r.pdfLidos++;
        } catch { /* PDF protegido ou ilegível: o arquivo segue guardado */ }
        if (documento_id && ["proposta", "apolice", "endosso"].includes(tipo)) {
          try {
            await guardarAnexo(sb, { doc: { id: documento_id }, pdf: buf, nome, messageId: `card:${c.entity_type_id}:${c.item_id}:arquivo:${a.id}`, tipo: tipo === "apolice" ? "apolice" : tipo, origem: "bitrix", av: { situacao: "provavel", cpf: false, num: false, vig: false }, extra: { fonte: "comentário do card (Bitrix)", card: `${c.entity_type_id}:${c.item_id}`, ligado_por: "card" }, texto });
            anexo = true; r.anexosFicha++;
          } catch (e) { console.log("anexo da ficha:", a.id, (e as Error).message.slice(0, 80)); }
        }
      }
      const { error: e2 } = await sb.from("bitrix_card_arquivos").upsert({ ...base, mime, sha256: sha, storage_path: caminho, situacao: "baixado", anexo_documento: anexo });
      if (e2) throw new Error(`tabela: ${e2.message}`);
      r.baixados++; if (documento_id) r.comDocumento++;
    } catch (e) {
      r.erro++;
      await sb.from("bitrix_card_arquivos").upsert({ ...base, situacao: `erro: ${(e as Error).message.slice(0, 120)}` });
    }
    if (n % 50 === 0) console.log(new Date().toISOString(), `${n}/${fila.length}`, JSON.stringify(r));
  }
  console.log("FIM", JSON.stringify(r));
})();
