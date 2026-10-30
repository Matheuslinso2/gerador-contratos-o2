// Lê (SÓ LEITURA) os 'Resumo de Fatura' de Vida em Grupo baixados do portal da Porto (%TEMP%\porto\<pasta>) e imprime, por competência, o cabeçalho
// (apólice V.G., apólice APC, números de cobrança), vigência, vidas, prêmio líquido/IOF/total. uso: ... porto-vida-faturas.ts <pasta>
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { getDocumentProxy, extractText } from "unpdf";
(async () => {
  const dir = path.join(os.tmpdir(), "porto", process.argv[2] ?? "penapolis");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".pdf")).sort()) {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(dir, f)))); const { text } = await extractText(pdf, { mergePages: true });
    const s = String(text).replace(/\s+/g, " ");
    const nums = [...s.matchAll(/(\d{3}\.\d{3}-\d)/g)].map((m) => m[1].replace(/\./g, "").replace("-", "")).slice(0, 6);
    const vig = /Vig[êe]ncia\.+:\s*(\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/.exec(s); const tot = /Total a Pagar[^\d]*([\d.,]+)/i.exec(s) ?? /\b(\d{1,3}(?:\.\d{3})*,\d{2})\s*Corretor/.exec(s);
    const m = /(\d{4}-\d{2})/.exec(f); const vidas = /Saldo Anterior\s+(\d+)/.exec(s);
    const valores = [...s.matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g)].map((x) => x[0]);
    console.log([m?.[1], "nums:" + nums.join(","), vig ? `${vig[1]}-${vig[2]}` : "?", "vidas:" + (vidas?.[1] ?? "?"), "últimos valores:" + valores.slice(-4).join(" ")].join(" | "));
  }
})();
