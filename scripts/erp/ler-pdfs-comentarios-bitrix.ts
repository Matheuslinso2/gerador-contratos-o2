process.loadEnvFile(".env.local");
// Lê (SÓ LEITURA no Bitrix) os PDFs anexados aos comentários "PROPOSTA" dos cards da Fiança (SPA 1042) e grava em
// bitrix_comentario_pdf_leitura só o dado estruturado: seguradora, números de proposta/apólice, CPF/CNPJ e prêmios (nunca o texto bruto).
// O PDF é baixado para a memória pelo disco do Bitrix (webhook de tarefas, com disk) e descartado. Arquivos já lidos não são relidos.
// Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/ler-pdfs-comentarios-bitrix.ts [--todos]   (--todos = todo PDF anexado, não só "PROPOSTA")
import { createServiceClient } from "@/lib/supabase/service";
import { chamadorBitrix } from "@/lib/erp/tarefaCadastro";
import { extrairTextoPdfComPaginas } from "@/lib/extrairTextoPdf";

const sb = createServiceClient();
const bx = chamadorBitrix(process.env.BITRIX_WEBHOOK_URL_TAREFAS!);
const TODOS = process.argv.includes("--todos");

type Arq = { id: number; name: string | null; size: number | null };
const so = (s: string) => s.replace(/\D/g, "");
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

function ler(texto: string) {
  const t = texto.replace(/\s+/g, " ");
  const seg = /tokio/i.test(t) ? "TOKIO" : /porto/i.test(t) ? "PORTO" : /pottencial/i.test(t) ? "POTTENCIAL" : /too seguros|\btoo\b/i.test(t) ? "TOO" : /pessoal|essor/i.test(t) ? "OUTRA" : null;
  const numeros: Record<string, string[]> = {};
  const add = (k: string, re: RegExp) => { const v = [...t.matchAll(re)].map((m) => m[1]).filter(Boolean); if (v.length) numeros[k] = [...new Set(v)].slice(0, 6); };
  add("proposta", /proposta\s*(?:n[º°o.]*|n[úu]mero)?\s*[:\-]?\s*(\d[\d.\-/]{5,19}\d)/gi);
  add("apolice", /ap[óo]lice\s*(?:n[º°o.]*|n[úu]mero)?\s*[:\-]?\s*(\d[\d.\-/ ]{5,19}\d)/gi);
  add("negocio", /neg[óo]cio\s*[:\-]?\s*(\d{8,10})/gi);
  add("cotacao", /cota[çc][ãa]o\s*(?:n[º°o.]*)?\s*[:\-]?\s*(\d{6,12})/gi);
  const docs = [...new Set([...t.matchAll(/\b(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g)].map((m) => so(m[1])))].slice(0, 8);
  const premios = [...t.matchAll(/(?:pr[êe]mio\s*(?:l[ií]quido|total)?|valor)\s*[:\-]?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi)].map((m) => num(m[1])).filter((n) => n > 0).slice(0, 8);
  return { seg, numeros, docs, premios };
}

(async () => {
  const { data: coms, error } = await sb.from("bitrix_card_comentarios").select("id, item_id, comentario, arquivos").eq("entity_type_id", 1042).not("arquivos", "is", null).order("id");
  if (error) throw new Error(error.message);
  const alvo: { cid: number; item: number; arq: Arq }[] = [];
  for (const c of coms ?? []) {
    const proposta = /^\s*(-+\s*)?PROPOSTA/i.test(String(c.comentario ?? ""));
    for (const a of (c.arquivos ?? []) as Arq[]) {
      if (!/\.pdf$/i.test(a.name ?? "")) continue;
      if (TODOS || proposta || /propost/i.test(a.name ?? "")) alvo.push({ cid: Number(c.id), item: Number(c.item_id), arq: a });
    }
  }
  const { data: feitos } = await sb.from("bitrix_comentario_pdf_leitura").select("file_id");
  const ja = new Set((feitos ?? []).map((x) => Number(x.file_id)));
  const fila = alvo.filter((x) => !ja.has(x.arq.id));
  console.log("PDFs alvo:", alvo.length, "| a ler:", fila.length);
  const r: Record<string, number> = { lidos: 0, semTexto: 0, erro: 0 };
  for (const x of fila) {
    let situacao = "lido"; let dado: ReturnType<typeof ler> | null = null; let paginas: number | null = null;
    try {
      const g = await bx("disk.file.get", { id: x.arq.id });
      const url = String(g.result?.DOWNLOAD_URL ?? "");
      if (!url) throw new Error("sem link de download");
      const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
      if (buf.subarray(0, 4).toString() !== "%PDF") throw new Error("não é PDF");
      const { texto, numPaginas } = await extrairTextoPdfComPaginas(buf);
      paginas = numPaginas;
      if (texto.length < 80) situacao = "sem_texto"; else dado = ler(texto);
    } catch (e) { situacao = `erro: ${(e as Error).message.slice(0, 80)}`; }
    r[situacao === "lido" ? "lidos" : situacao === "sem_texto" ? "semTexto" : "erro"]++;
    const { error: e2 } = await sb.from("bitrix_comentario_pdf_leitura").upsert({
      file_id: x.arq.id, entity_type_id: 1042, item_id: x.item, comentario_id: x.cid, nome: x.arq.name, tamanho: x.arq.size, situacao,
      seguradora: dado?.seg ?? null, numeros: dado?.numeros ?? null, documentos: dado?.docs ?? null, premios: dado?.premios ?? null, paginas,
    });
    if (e2) console.log("erro gravando", x.arq.id, e2.message);
  }
  console.log(JSON.stringify(r));
})();
