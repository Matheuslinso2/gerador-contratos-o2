process.loadEnvFile(".env.local");
// Lê o texto dos PDFs de COTAÇÃO anexados aos cards do Bitrix (desde 06/05/2026; bitrix_card_arquivos.tipo='cotacao') e guarda em
// erp_apolice_pdf_texto com fonte_pdf = "card:<storage_path>". Uma vez só; sem rodar o erp_pdf_pipeline. Planilhas/imagens ficam de fora.
// Uso: tsx scripts/erp/ler-cotacoes-cards.ts [--limite N]
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha } from "@/lib/pdfComSenha";

const sb = createServiceClient();
const CORTE = "2026-05-06";
const BUCKET = "bitrix-cards-arquivos";
const LIMITE = process.argv.includes("--limite") ? +process.argv[process.argv.indexOf("--limite") + 1] : Infinity;

async function paginar<T>(f: (de: number, ate: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) { const { data } = await f(off, off + 999); if (!data?.length) break; out.push(...data); if (data.length < 1000) break; }
  return out;
}

type Arq = { file_id: number; storage_path: string; mime: string | null };

async function main() {
  const feitos = new Set((await paginar<{ fonte_pdf: string }>((a, b) => sb.from("erp_apolice_pdf_texto").select("fonte_pdf").like("fonte_pdf", "card:%").order("id").range(a, b))).map((x) => x.fonte_pdf));
  const arqs = await paginar<Arq>((a, b) => sb.from("bitrix_card_arquivos").select("file_id,storage_path,mime").eq("tipo", "cotacao").gte("anexado_no_bitrix_em", CORTE).not("storage_path", "is", null).order("file_id").range(a, b));
  const vistos = new Set<string>();
  let fila = arqs.filter((x) => /pdf/i.test(`${x.mime ?? ""} ${x.storage_path}`) && !feitos.has(`card:${x.storage_path}`) && !vistos.has(x.storage_path) && (vistos.add(x.storage_path), true));
  if (isFinite(LIMITE)) fila = fila.slice(0, LIMITE);
  console.log("a ler:", fila.length);
  const st = { lido: 0, sem_texto: 0, erro_download: 0, erro: 0 };
  let i = 0;
  const worker = async () => {
    while (i < fila.length) {
      const it = fila[i++];
      try {
        const { data } = await sb.storage.from(BUCKET).download(it.storage_path);
        if (!data) { st.erro_download++; continue; }
        let t = ((await abrirTextoPdfComSenha(Buffer.from(await data.arrayBuffer()), []))?.texto ?? "").replace(/\s+/g, " ");
        t = t.replace(/\u0000/g, "").replace(/[\uD800-\uDFFF]/g, "");
        const ok = t.length >= 200;
        const linha = { documento_id: null, seguradora_chave: null, texto: ok ? t : null, metodo: ok ? "texto_nativo" : "sem_texto", fonte_pdf: `card:${it.storage_path}`, tipo_anexo: "cotacao", nosso_numero_corp: null, leitor_versao: "cotacoes-cards-v1-2026-11-06", email_anexo_id: null };
        const { error } = await sb.from("erp_apolice_pdf_texto").insert(linha);
        if (error) { st.erro++; console.log("erro ao gravar", it.storage_path, error.message.slice(0, 120)); continue; }
        st[ok ? "lido" : "sem_texto"]++;
      } catch (e) { st.erro++; console.log("erro", it.storage_path, String(e).slice(0, 80)); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.log("concluído", JSON.stringify(st));
}
main();
