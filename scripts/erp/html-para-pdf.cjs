// Converte um HTML local em PDF (A4) com o Chromium do Playwright já instalado para os robôs. Uso: node scripts/erp/html-para-pdf.cjs <entrada.html> <saida.pdf>
const { chromium } = require("playwright");
const path = require("path");
const { pathToFileURL } = require("url");
(async () => {
  const [entrada, saida] = process.argv.slice(2);
  if (!entrada || !saida) throw new Error("uso: html-para-pdf.cjs <entrada.html> <saida.pdf>");
  // usa o Chrome já instalado no computador (o Chromium do Playwright pode não estar baixado); cai para o Edge se não houver Chrome
  let b; try { b = await chromium.launch({ channel: "chrome" }); } catch { b = await chromium.launch({ channel: "msedge" }); }
  const p = await b.newPage();
  await p.goto(pathToFileURL(path.resolve(entrada)).href);
  await p.pdf({ path: path.resolve(saida), format: "A4", margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" }, printBackground: true });
  await b.close(); console.log("pdf ok:", path.resolve(saida));
})().catch((e) => { console.error("erro:", e.message); process.exit(1); });
