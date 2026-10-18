// Varre TODAS as planilhas visíveis às 2 contas de serviço (só leitura) e
// junta, por arquivo/aba, os valores da coluna "IMOBILIÁRIA".
// Saída: nomes_planilhas.json  -> [{conta, arquivoId, arquivo, pasta, aba, cabecalhoLinha, coluna, linhas, nomes:{nome:qtd}}]
// Não guarda nenhum outro dado das linhas (CPF, locatário etc. ficam de fora).
const fs = require("fs");
const path = require("path");
const { cliente } = require("./_google.cjs");
const XLSX = require("xlsx");
// uso: node scripts/base-unica/varrer-planilhas.cjs <saida.json>  (retoma de onde parou se o arquivo já existir)
const SAIDA = path.resolve(process.argv[2] || "nomes_planilhas.json");

const norm = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

function extrairDeLinhas(linhas) {
  // acha cabeçalho nas 6 primeiras linhas com célula começando por IMOBILI
  for (let i = 0; i < Math.min(6, linhas.length); i++) {
    const l = linhas[i] || [];
    const col = l.findIndex((c) => /^IMOBILI/.test(norm(c)));
    if (col >= 0) {
      const nomes = {};
      let n = 0;
      for (const row of linhas.slice(i + 1)) {
        const v = String((row || [])[col] ?? "").replace(/\s+/g, " ").trim();
        if (!v) continue;
        n++;
        nomes[v] = (nomes[v] || 0) + 1;
      }
      return { cabecalhoLinha: i + 1, coluna: col, linhas: n, nomes };
    }
  }
  return null;
}

async function listar(c) {
  const arr = [];
  let pt;
  do {
    const r = await c.drive.files.list({
      q: "trashed=false", pageSize: 1000, pageToken: pt,
      fields: "nextPageToken,files(id,name,mimeType,parents)", supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    arr.push(...r.data.files);
    pt = r.data.nextPageToken;
  } while (pt);
  return arr;
}

(async () => {
  const saida = fs.existsSync(SAIDA) ? JSON.parse(fs.readFileSync(SAIDA, "utf8")) : [];
  const feitos = new Set(saida.map((x) => x.arquivoId));
  const vistos = new Set();
  for (const conta of ["RE", "GERAL"]) {
    const c = cliente(conta);
    const arquivos = await listar(c);
    const pastas = Object.fromEntries(arquivos.filter((f) => f.mimeType.endsWith("folder")).map((f) => [f.id, f.name]));
    for (const f of arquivos) {
      if (vistos.has(f.id) || feitos.has(f.id)) continue;
      const ehGoogle = f.mimeType === "application/vnd.google-apps.spreadsheet";
      const ehExcel = /spreadsheetml|ms-excel/.test(f.mimeType);
      if (!ehGoogle && !ehExcel) continue;
      vistos.add(f.id);
      const pasta = (f.parents || []).map((p) => pastas[p] || p).join(",");
      console.log("baixando", f.name);
      try {
        let abas = [];
        {
          // Google Sheets: exporta como xlsx (1 requisição por arquivo, evita cota por aba)
          const r = ehGoogle
            ? await c.drive.files.export({ fileId: f.id, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { responseType: "arraybuffer", timeout: 120000 })
            : await c.drive.files.get({ fileId: f.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer", timeout: 120000 });
          const wb = XLSX.read(Buffer.from(r.data), { type: "buffer", bookVBA: false, cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, sheetRows: 20000, dense: true });
          for (const nome of wb.SheetNames) abas.push([nome, XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, blankrows: false })]);
        }
        for (const [aba, linhas] of abas) {
          const ext = extrairDeLinhas(linhas);
          saida.push({ conta, arquivoId: f.id, arquivo: f.name, pasta, aba, totalLinhas: linhas.length, ...(ext || { semColunaImobiliaria: true }) });
        }
        console.log("ok", conta, pasta, "|", f.name, "|", abas.length, "abas");
      } catch (e) {
        console.log("ERRO", f.name, e.message);
        saida.push({ conta, arquivoId: f.id, arquivo: f.name, pasta, erro: e.message });
      }
      fs.writeFileSync(SAIDA, JSON.stringify(saida, null, 1));
    }
  }
  console.log("FIM", saida.length, "abas registradas");
})();
