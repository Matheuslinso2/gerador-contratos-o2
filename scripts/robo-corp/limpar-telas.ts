// Libera disco: apaga do computador as fotos das telas (e os PNGs do OCR) SÓ dos documentos cujas telas já estão no bucket privado "corp-telas"
// E já foram lidas (status 'lida' em erp_corp_telas_documento). Confere cada arquivo no bucket antes de apagar; nada é apagado no bucket nem no banco.
// Ensaio por padrão; --gravar apaga.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/limpar-telas.ts [--gravar]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const TELAS = path.join(PASTA, "telas");
const OCR = path.join(PASTA, "ocr");
const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();

(async () => {
  if (!fs.existsSync(TELAS)) { console.log("sem pasta de telas"); return; }
  let docs = 0, apagados = 0, mantidos = 0, bytes = 0;
  for (const nn of fs.readdirSync(TELAS).filter((x) => /^\d+$/.test(x))) {
    const dir = path.join(TELAS, nn);
    const arqs = fs.readdirSync(dir).filter((f) => f.endsWith(".webp"));
    if (!arqs.length) continue;
    docs++;
    // 1) toda tela do documento está no bucket? 2) toda tela lida (OCR + campos gravados)?
    const { data: noBucket } = await sb.storage.from("corp-telas").list(nn, { limit: 100 });
    const nomes = new Set((noBucket ?? []).map((o) => o.name));
    const { data: linhas } = await sb.from("erp_corp_telas_documento").select("tela,status,imagem_path").eq("nosso_numero_corp", Number(nn));
    const lida = new Map((linhas ?? []).map((l) => [l.tela, l.status]));
    const ok = arqs.every((f) => nomes.has(f) && (f === "busca.webp" || lida.get(f.replace(/\.webp$/, "")) === "lida"));
    if (!ok) { mantidos++; continue; }
    for (const f of arqs) bytes += fs.statSync(path.join(dir, f)).size;
    if (GRAVAR) {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const sub of ["png", "png-b"]) for (const f of arqs) { const t = path.join(OCR, sub, `${nn}_${f.replace(/\.webp$/, ".png")}`); if (fs.existsSync(t)) fs.unlinkSync(t); }
    }
    apagados++;
  }
  console.log(`${GRAVAR ? "APAGADO" : "ENSAIO"}: ${docs} documentos com fotos no disco; ${apagados} já no bucket e lidos (${Math.round(bytes / 1e6)} MB das telas); ${mantidos} mantidos no disco (falta enviar ou ler)`);
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
