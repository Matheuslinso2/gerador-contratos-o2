// Teste rápido do leitor em arquivos conhecidos (saída mascarada, sem dado pessoal).
// uso: npx tsx scripts/apolices/_testar-amostra.ts <id do Drive> [<id> ...]
process.loadEnvFile(".env.local");
import { createRequire } from "node:module";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { lerApolice } from "./leitores";
const { cliente } = createRequire(import.meta.url)("../base-unica/_google.cjs");
const mask = (s: string | null | undefined) => (s ? s.slice(0, 3) + "***" : s ?? null);
(async () => {
  const { drive } = cliente("GERAL");
  for (const id of process.argv.slice(2)) try {
    const r0 = await drive.files.get({ fileId: id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    const texto = await extrairTextoPdf(Buffer.from(r0.data as ArrayBuffer));
    const r = lerApolice(texto);
    console.log(JSON.stringify({ id: id.slice(0, 6), seg: r.seguradora, fianca: r.fianca, numero: r.numero, ini: r.vigencia_inicio, fim: r.vigencia_fim,
      segurado: mask(r.segurado?.documento), gar: r.garantidos.map((g) => `${mask(g.nome)}/${mask(g.documento)}`), local: r.local_risco?.slice(0, 25) ?? null,
      lmg: r.limite_maximo_garantia, cob: r.coberturas.length, est: mask(r.estipulante_documento), problemas: r.problemas }));
    if (process.env.MOSTRAR_TEXTO) console.log(texto.slice(0, Number(process.env.MOSTRAR_TEXTO)).replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, "***"));
  } catch (e) { console.log(JSON.stringify({ id: id.slice(0, 6), erro: (e as Error).message })); }
})().catch((e) => { console.error(e); process.exit(1); });
