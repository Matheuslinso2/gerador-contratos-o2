process.loadEnvFile(".env.local");
// Lê o texto dos PDFs de COTAÇÃO de e-mail (desde 06/05/2026) que ainda não têm linha em erp_apolice_pdf_texto (leitura rasa em erp_email_anexos).
// Mesma leitura do ler-acervo-pdf-texto.ts (uma vez só, texto nativo), mas só para estas cotações e sem rodar o erp_pdf_pipeline.
// Uso: tsx scripts/erp/ler-cotacoes-email-faltantes.ts [--limite N]
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha } from "@/lib/pdfComSenha";

const sb = createServiceClient();
const CORTE = "2026-05-06";
const LIMITE = process.argv.includes("--limite") ? +process.argv[process.argv.indexOf("--limite") + 1] : Infinity;

async function paginar<T>(f: (de: number, ate: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) { const { data } = await f(off, off + 999); if (!data?.length) break; out.push(...data); if (data.length < 1000) break; }
  return out;
}

type Anexo = { id: string; storage_bucket: string; storage_path: string; seguradora: string | null; documento_id: string | null; message_id: string };

async function main() {
  const lidos = new Set((await paginar<{ email_anexo_id: string }>((a, b) => sb.from("erp_apolice_pdf_texto").select("email_anexo_id").not("email_anexo_id", "is", null).order("id").range(a, b))).map((x) => x.email_anexo_id));
  const datas = new Map<string, string>();
  for (const e of await paginar<{ message_id: string; data: string }>((a, b) => sb.from("erp_emails").select("message_id,data").gte("data", CORTE).order("message_id").range(a, b))) datas.set(e.message_id, e.data);
  const ax = await paginar<Anexo>((a, b) => sb.from("erp_email_anexos").select("id,storage_bucket,storage_path,seguradora,documento_id,message_id").eq("classe", "cotacao").not("storage_path", "is", null).order("id").range(a, b));
  let fila = ax.filter((x) => datas.has(x.message_id) && !lidos.has(x.id));
  if (isFinite(LIMITE)) fila = fila.slice(0, LIMITE);
  console.log("a ler:", fila.length);
  const st = { lido: 0, sem_texto: 0, erro_download: 0, erro: 0 };
  let i = 0;
  const worker = async () => {
    while (i < fila.length) {
      const it = fila[i++];
      try {
        const { data } = await sb.storage.from(it.storage_bucket).download(it.storage_path);
        if (!data) { st.erro_download++; continue; }
        let t = ((await abrirTextoPdfComSenha(Buffer.from(await data.arrayBuffer()), []))?.texto ?? "").replace(/\s+/g, " ");
        t = t.replace(/\u0000/g, "").replace(/[\uD800-\uDFFF]/g, "");
        const ok = t.length >= 200;
        const linha = { documento_id: it.documento_id, seguradora_chave: it.seguradora, texto: ok ? t : null, metodo: ok ? "texto_nativo" : "sem_texto", fonte_pdf: `email:${it.storage_path}`, tipo_anexo: "cotacao", nosso_numero_corp: null, leitor_versao: "cotacoes-email-v1-2026-11-06", email_anexo_id: it.id };
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
