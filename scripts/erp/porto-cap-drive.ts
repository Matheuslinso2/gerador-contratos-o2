// Ensaio (SÓ LEITURA): procura no Drive os PDFs de apólice dos clientes das 11 apólices Porto Capitalização (ramos 746/118/114) e lê
// nº da apólice, vigência e prêmio do PDF (senha Porto = 4 primeiros dígitos do CPF/CNPJ; tenta pelo CPF/CNPJ achado no nome/texto).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/porto-cap-drive.ts
process.loadEnvFile(".env.local");
import { createRequire } from "node:module";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
const require = createRequire(import.meta.url); const { cliente } = require("../base-unica/_google.cjs");
const ALVOS: [string, string, string][] = [["4107594", "JOLI", "JOLI ADMINISTRADORA"], ["4110311", "ALMICE", "IMOBILIARIA ALMICE"], ["4115266", "TERRA CORREA", "GUSTAVO TERRA CORREA"], ["4291951", "ISABEL CRISTINA", "ISABEL CRISTINA SANTANA MEIRA"], ["4292712", "NICOLAU", "LEONARDO NICOLAU GONCALVES CABO"], ["4315346", "BILHERI", "LUIS SERGIO BILHERI NOGUEIRA"], ["10894893", "NATHALIA RANGEL", "NATHALIA RANGEL GANIMI"], ["10985231", "GUARINO", "ROBERTA CRISTINA GUARINO"], ["10982887", "SERGIO DE SOUZA", "SERGIO DE SOUZA"], ["11010495", "FRANCISCO XAVIER", "FRANCISCO XAVIER"], ["10817997", "PORTO PARTICIPA", "PORTO PARTICIPACOES"]];
(async () => {
  const { drive } = cliente("GERAL"); const pasta = path.join(os.tmpdir(), "porto", "cap"); fs.mkdirSync(pasta, { recursive: true });
  for (const [ap, termo, nome] of ALVOS) {
    const r = await drive.files.list({ q: `name contains '${termo.replace(/'/g, "")}' and trashed=false and mimeType='application/pdf'`, fields: "files(id,name,size,modifiedTime,parents)", pageSize: 30, supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives" });
    const fs_ = r.data.files ?? [];
    console.log(`\n== ${ap} ${nome}: ${fs_.length} PDFs com '${termo}'`);
    for (const f of fs_.slice(0, 8)) {
      let info = "";
      if (/APOLICE|APÓLICE/i.test(f.name!)) {
        try {
          const resp = await drive.files.get({ fileId: f.id!, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
          const buf = Buffer.from(resp.data as ArrayBuffer); fs.writeFileSync(path.join(pasta, `${ap}_${f.id}.pdf`), buf);
          const { t, protegido } = await textoDoPdf(buf, []);
          info = t ? ` | texto ${t.length} chars | tem nº ${ap}: ${t.includes(ap) || t.replace(/\D/g, "").includes(ap)}` : ` | ${protegido ? "protegido por senha" : "sem texto"}`;
        } catch (e) { info = " | erro " + (e as Error).message.slice(0, 60); }
      }
      console.log(`  ${f.name} | ${f.modifiedTime?.slice(0, 10)} | ${Math.round(Number(f.size) / 1024)} KB | ${f.id}${info}`);
    }
  }
})();
