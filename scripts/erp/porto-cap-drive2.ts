// Ensaio (SÓ LEITURA): varre TODOS os PDFs de apólice no Drive cujo nome contém o cliente das apólices Porto Cap ainda não achadas, lê o nº da
// apólice (ramo sucursal número), vigência e prêmio, e diz quais nºs alvo apareceram. Cache em %TEMP%\porto\cap2.
process.loadEnvFile(".env.local");
import { createRequire } from "node:module";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
const require = createRequire(import.meta.url); const { cliente } = require("../base-unica/_google.cjs");
const ALVOS: Record<string, string[]> = { "4107594": ["JOLI"], "4110311": ["ALMICE"], "4292712": ["NICOLAU"], "4315346": ["BILHERI"], "11010495": ["FRANCISCO XAVIER"], "10894893": ["GANIMI", "NATHALIA RANGEL"], "10985231": ["GUARINO"], "10982887": ["SERGIO DE SOUZA"], "10817997": ["PORTO PARTICIPA"] };
(async () => {
  const { drive } = cliente("GERAL"); const dir = path.join(os.tmpdir(), "porto", "cap2"); fs.mkdirSync(dir, { recursive: true });
  const achados: Record<string, string[]> = {}; const vistos = new Set<string>(); let lidos = 0, falhas = 0;
  for (const [alvo, termos] of Object.entries(ALVOS)) for (const termo of termos) {
    let pageToken: string | undefined; let n = 0;
    do {
      const r = await drive.files.list({ q: `name contains '${termo}' and trashed=false and mimeType='application/pdf'`, fields: "nextPageToken,files(id,name,size,modifiedTime)", pageSize: 100, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives" });
      for (const f of r.data.files ?? []) {
        n++; if (vistos.has(f.id!) || Number(f.size) < 150_000) continue; vistos.add(f.id!);
        try {
          const arq = path.join(dir, `${f.id}.pdf`); let buf: Buffer;
          if (fs.existsSync(arq)) buf = fs.readFileSync(arq); else { const resp = await drive.files.get({ fileId: f.id!, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }); buf = Buffer.from(resp.data as ArrayBuffer); fs.writeFileSync(arq, buf); }
          const { t } = await textoDoPdf(buf, []); if (!t) { falhas++; continue; } lidos++;
          const s = t.replace(/\s+/g, " ");
          const m = /N[úu]mero da Ap[óo]lice:\s*(?:\D*?)(\d{2,4}) (\d{2}) (\d{3,8})/i.exec(s) ?? /\b(\d{3}) (86) (\d{6,8})\b/.exec(s);
          const vig = /a partir das 24h do dia (\d{2}\/\d{2}\/\d{4}) at[ée] as 24h do dia (\d{2}\/\d{2}\/\d{4})/i.exec(s); const prem = /TOTAL PR[ÊE]MIO COBERTURAS R\$\s*([\d.,]+)/i.exec(s) ?? /Pr[êe]mio total[^R]*R\$\s*([\d.,]+)/i.exec(s);
          const cod = m ? m[3] : ""; const todos = Object.keys(ALVOS);
          const hit = todos.find((a) => cod === a) ?? todos.find((a) => s.replace(/\D/g, "").includes(a) && s.includes(a));
          if (hit) (achados[hit] ??= []).push(`${m ? `${m[1]}-${m[2]}-${m[3]}` : "?"} | ${vig ? vig[1] + "→" + vig[2] : "?"} | R$ ${prem?.[1] ?? "?"} | ${f.name} | ${f.id}`);
        } catch { falhas++; }
      }
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken && n < 600);
  }
  console.log(`PDFs lidos ${lidos}, falhas ${falhas}`); for (const a of Object.keys(ALVOS)) console.log(`${a}: ${achados[a] ? "\n   " + achados[a].join("\n   ") : "NÃO achada"}`);
})();
