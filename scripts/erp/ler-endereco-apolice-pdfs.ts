process.loadEnvFile(".env.local");
// ERP O2 — 02/11/2026 (Matheus: cruzar o ENDEREÇO dos registros): lê, SEM IA, os CEPs e o texto de endereço que vem antes de cada CEP no PDF da apólice (documento oficial, nível 1)
// e grava em erp_apolice_endereco_pdf (já normalizado, sem acento). Alvos: view erp_endereco_alvos. Não imprime endereço. Desfazer: delete por lote.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ler-endereco-apolice-pdfs.ts <lote> [paralelo=3] [limite]
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha, candidatosSenhaO2 } from "@/lib/pdfComSenha";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
(async () => {
  const sb = createServiceClient();
  const lote = process.argv[2]; const paralelo = Number(process.argv[3] ?? 3); const limite = Number(process.argv[4] ?? 100000);
  if (!lote) throw new Error("uso: <lote> [paralelo] [limite]");
  const alvos: string[] = [];
  for (let de = 0; ; de += 1000) { const { data } = await sb.from("erp_endereco_alvos").select("documento_id").range(de, de + 999); for (const r of data ?? []) alvos.push(r.documento_id); if (!data || data.length < 1000) break; }
  const lista = alvos.slice(0, limite); console.log("alvos:", lista.length);
  const res = { lidos: 0, sem_pdf: 0, sem_texto: 0, sem_cep: 0, com_cep: 0, erro: 0 }; let i = 0;
  async function um(doc: string) {
    try {
      const { data: ax } = await sb.from("erp_documento_anexos").select("storage_path").eq("documento_id", doc).eq("tipo", "apolice").not("storage_path", "is", null).limit(1);
      if (!ax?.length) { res.sem_pdf++; return; }
      const { data } = await sb.storage.from("anexos-documentos").download(ax[0].storage_path);
      if (!data) { res.erro++; return; }
      const t0 = ((await abrirTextoPdfComSenha(Buffer.from(await data.arrayBuffer()), candidatosSenhaO2()))?.texto ?? "").replace(/\s+/g, " ");
      if (t0.length < 200) { res.sem_texto++; return; }
      res.lidos++;
      const t = semAcento(t0); const regs: Record<string, unknown>[] = []; const vistos = new Set<string>();
      for (const m of t.matchAll(/\b(\d{5})-?(\d{3})\b/g)) {
        const cep = m[1] + m[2]; if (vistos.has(cep) || regs.length >= 6) continue; vistos.add(cep);
        const antes = t.slice(Math.max(0, (m.index ?? 0) - 150), m.index ?? 0).replace(/[^A-Z0-9 ,.\-/ºª]/g, " ").replace(/\s+/g, " ").trim();
        const num = [...antes.matchAll(/(?:,|\s)(\d{1,5})(?=\s|,|$)/g)].map((x) => x[1]).filter((x) => Number(x) > 0);
        regs.push({ documento_id: doc, ordem: regs.length, cep, trecho: antes.slice(-150), numero_provavel: num.length ? num[num.length - 1] : null, lote });
      }
      if (!regs.length) { res.sem_cep++; return; }
      res.com_cep++;
      await sb.from("erp_apolice_endereco_pdf").delete().eq("documento_id", doc);
      const { error } = await sb.from("erp_apolice_endereco_pdf").insert(regs); if (error) throw new Error(error.message);
    } catch { res.erro++; }
    if ((res.lidos + res.sem_pdf + res.erro) % 100 === 0) console.log(JSON.stringify(res));
  }
  await Promise.all(Array.from({ length: paralelo }, async () => { while (i < lista.length) await um(lista[i++]); }));
  console.log("FIM", JSON.stringify(res));
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
