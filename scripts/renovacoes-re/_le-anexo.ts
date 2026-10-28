process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { getDocumentProxy } from "unpdf";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from("corp_anexos").select("nome,rotulo_id,storage_path").eq("nosso_numero", "119408");
  console.log(data?.map((a) => a.nome));
  for (const a of data ?? []) {
    const { data: f, error } = await sb.storage.from("corp-anexos").download(a.storage_path);
    if (error) { console.log("bucket?", error.message); continue; }
    const pdf = await getDocumentProxy(new Uint8Array(await f.arrayBuffer()));
    let t = ""; for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) t += (await (await pdf.getPage(p)).getTextContent()).items.map((i: any) => i.str).join(" ") + "\n";
    const m = t.match(/(pr[eê]mio|iof|total|parcela|vig[eê]ncia)[^\n]{0,90}/gi) ?? [];
    console.log(a.nome, "→", m.slice(0, 14));
  }
})();
