// Baixa (endereço público do docstore da Tokio) os PDFs de apólice listados em um arquivo "apólice:ramo:uuid" (separado por espaço/linha) e
// lê o texto: nº da apólice, vigência, segurado, CPF/CNPJ, prêmio. SÓ LEITURA. uso: ... tokio-baixar-lista.ts <arquivo.txt> <pasta>
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
const T = path.join(os.tmpdir(), "tokio"); const arq = path.join(T, process.argv[2]); const pasta = path.join(T, process.argv[3]); fs.mkdirSync(pasta, { recursive: true });
(async () => {
  const itens = fs.readFileSync(arq, "utf8").split(/\s+/).filter(Boolean).map((x) => x.split(":"));
  const r = { ok: 0, pula: 0, erro: 0 }; const fila = [...itens];
  async function w() { for (let x = fila.shift(); x; x = fila.shift()) { const f = path.join(pasta, `${x[0]}.pdf`); if (fs.existsSync(f) && fs.statSync(f).size > 1000) { r.pula++; continue; }
    try { const res = await fetch("https://portal.tokiomarine.com.br/docstore-services/rest/download/" + x[2], { signal: AbortSignal.timeout(90000) }); const b = Buffer.from(await res.arrayBuffer()); if (res.status !== 200 || b.subarray(0, 4).toString() !== "%PDF") { r.erro++; console.log("falha", x[0], res.status); continue; } fs.writeFileSync(f, b); r.ok++; } catch (e) { r.erro++; console.log("erro", x[0], (e as Error).message); } } }
  await Promise.all([w(), w(), w()]); console.log(JSON.stringify(r), "tamanho MB:", (fs.readdirSync(pasta).reduce((s, f) => s + fs.statSync(path.join(pasta, f)).size, 0) / 1e6).toFixed(0));
  const amostra = fs.readdirSync(pasta)[0]; const { t } = await textoDoPdf(fs.readFileSync(path.join(pasta, amostra)), []); console.log(amostra, String(t).replace(/\s+/g, " ").slice(0, 1800));
})();
