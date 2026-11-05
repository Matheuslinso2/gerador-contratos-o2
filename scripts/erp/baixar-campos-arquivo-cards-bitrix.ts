process.loadEnvFile(".env.local");
// Baixa (SÓ LEITURA no Bitrix) os arquivos que ficam em CAMPOS dos cards das SPAs: RE 1046 (planilha de itens) e Auto 1050 (CRLV, CNH, apólice anterior).
// Guarda no bucket bitrix-cards-arquivos e em bitrix_card_arquivos (origem 'campo', file_id negativo = -fileId do campo), ligado ao documento pelo card (erp_origens).
// Retomável. Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/baixar-campos-arquivo-cards-bitrix.ts
import { createHash } from "node:crypto";
import { chamarBitrix } from "@/lib/bitrix/client";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const CAMPOS: Record<number, { campo: string; tipo: string }[]> = {
  1046: [{ campo: "ufCrm12PlanilhaItens", tipo: "planilha_itens" }],
  1050: [{ campo: "ufCrm16_1787057133486", tipo: "crlv" }, { campo: "ufCrm16_1787057362552", tipo: "cnh" }, { campo: "ufCrm16_1787058926395", tipo: "apolice_anterior" }],
};
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const seguro = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
type Valor = { id: number; urlMachine?: string; url?: string };

(async () => {
  const r = { vistos: 0, baixados: 0, jaTinha: 0, erro: 0, comDocumento: 0 };
  for (const [idStr, campos] of Object.entries(CAMPOS)) {
    const entity = Number(idStr);
    const docs = new Map<number, string>();
    for (let de = 0; ; de += 1000) {
      const { data } = await sb.from("erp_origens").select("item_id, documento_id").eq("entity_type_id", entity).not("documento_id", "is", null).order("item_id").range(de, de + 999);
      (data ?? []).forEach((o) => docs.set(Number(o.item_id), o.documento_id as string));
      if (!data || data.length < 1000) break;
    }
    let desde = 0;
    for (;;) {
      const resp = await chamarBitrix<{ result: { items: Record<string, unknown>[] } }>("crm.item.list", { entityTypeId: entity, "filter[>id]": desde, "order[id]": "ASC", select: ["id", ...campos.map((c) => c.campo)], start: -1 });
      const itens = resp.result.items; if (!itens.length) break;
      for (const it of itens) {
        desde = Number(it.id);
        for (const { campo, tipo } of campos) {
          const v = it[campo]; const lista = (Array.isArray(v) ? v : v ? [v] : []) as Valor[];
          for (const f of lista) {
            r.vistos++;
            const fileId = -Number(f.id);
            const { data: ja } = await sb.from("bitrix_card_arquivos").select("file_id").eq("file_id", fileId).maybeSingle();
            if (ja) { r.jaTinha++; continue; }
            const documento_id = docs.get(Number(it.id)) ?? null;
            const base = { file_id: fileId, entity_type_id: entity, item_id: Number(it.id), tipo, origem: "campo", campo, documento_id, vinculo: documento_id ? "card (erp_origens)" : null };
            try {
              const url = f.urlMachine ?? "";
              if (!url) throw new Error("sem link");
              const rs = await fetch(url, { signal: AbortSignal.timeout(180_000) });
              if (!rs.ok) throw new Error(`HTTP ${rs.status}`);
              const buf = Buffer.from(await rs.arrayBuffer());
              const cd = rs.headers.get("content-disposition") ?? "";
              const nm = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1];
              const nome = nm ? decodeURIComponent(nm) : `${tipo}-${f.id}`;
              const ext = (nome.split(".").pop() ?? "").toLowerCase();
              const mime = MIME[ext] ?? rs.headers.get("content-type") ?? "application/octet-stream";
              const caminho = `${entity}/${it.id}/campo-${f.id}-${seguro(nome)}`;
              const { error: eu } = await sb.storage.from("bitrix-cards-arquivos").upload(caminho, buf, { contentType: mime, upsert: true });
              if (eu) throw new Error(`upload: ${eu.message}`);
              const { error: e2 } = await sb.from("bitrix_card_arquivos").upsert({ ...base, nome, tamanho: buf.length, mime, sha256: createHash("sha256").update(buf).digest("hex"), storage_path: caminho, situacao: "baixado" });
              if (e2) throw new Error(e2.message);
              r.baixados++; if (documento_id) r.comDocumento++;
            } catch (e) { r.erro++; await sb.from("bitrix_card_arquivos").upsert({ ...base, situacao: `erro: ${(e as Error).message.slice(0, 120)}` }); }
          }
        }
      }
    }
  }
  console.log("FIM", JSON.stringify(r));
})();
