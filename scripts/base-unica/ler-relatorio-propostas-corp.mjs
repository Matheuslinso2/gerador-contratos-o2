// Lê o "Relatório de Propostas" do Corp (SGCS Corp, PDF) — qualquer ramo (Capitalização, Automóvel…).
// Obs.: o Corp corta casas decimais em valores grandes ("24.657.899,") — por isso os valores aceitam vírgula sem decimais.
// Usa `pdftotext -raw` (Git for Windows / poppler), que devolve cada proposta
// como um bloco coerente:
//   [CPF/código] NOME DO CLIENTE
//   NNº DD/MM/AA COMISSÃO_CORRETORA
//   PARCELAS PERCENTUAL
//   DD/MM/AA-DD/MM/AA            (vigência)
//   PRODUTO PRÊMIO_LÍQUIDO
//   Agente Produtor Com(%) / Partic. (%) Com($)
//   IMOBILIÁRIA <produtor> <com%>   +   <partic%> <com$>   (1 ou mais)
// uso: node scripts/base-unica/ler-relatorio-propostas-corp.mjs <pdf> [<pdf>...] [--json saida.json]
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const num = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));
const dataBr = (s) => { const [d, m, a] = s.split("/"); return `20${a}-${m}-${d}`; };

export function lerRelatorio(caminho) {
  const texto = execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", caminho, "-"], { maxBuffer: 1 << 28 }).toString("utf8");
  const L = texto.split(/\r?\n/).map((l) => l.trim());
  const propostas = [];
  let seguradora = null, ramo = null;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    let m;
    if ((m = l.match(/^Seg\.:\s*(.+)$/))) { seguradora = m[1].trim(); continue; }
    if ((m = l.match(/^Ramo:\s*(.+)$/))) { ramo = m[1].trim(); continue; }
    // linha "NNº DD/MM/AA COMISSÃO"
    if (!(m = l.match(/^(\d{1,7}) (\d{2}\/\d{2}\/\d{2}) (-?[\d.]+,\d{2})$/))) continue;
    const cliente = L[i - 1];
    const p2 = (L[i + 1] || "").match(/^(\d+) (-?[\d.]+,\d{2})$/);
    const vig = (L[i + 2] || "").match(/^(\d{2}\/\d{2}\/\d{2})-(\d{2}\/\d{2}\/\d{2})$/);
    const p4 = (L[i + 3] || "").match(/^(\S+) (-?[\d.]+,\d*)$/);
    const cm = (cliente || "").match(/^([\d.\-\/]+)\s+(.*)$/);
    const prop = {
      numero: m[1], data_proposta: dataBr(m[2]), comissao_corretora: num(m[3]),
      cliente_documento: cm ? cm[1] : null, cliente_nome: cm ? cm[2] : cliente,
      parcelas: p2 ? Number(p2[1]) : null, percentual_comissao: p2 ? num(p2[2]) : null,
      vigencia_inicio: vig ? dataBr(vig[1]) : null, vigencia_fim: vig ? dataBr(vig[2]) : null,
      produto: p4 ? p4[1] : null, premio_liquido: p4 ? num(p4[2]) : null,
      seguradora, ramo, produtores: [], aviso: null,
    };
    if (!p2 || !vig || !p4) prop.aviso = "bloco fora do padrão";
    // produtores até a próxima proposta
    for (let j = i + 4; j < L.length; j++) {
      if (/^(\d{1,7}) \d{2}\/\d{2}\/\d{2} -?[\d.]+,\d{2}$/.test(L[j]) || /^Seg\.:|^Ramo:/.test(L[j])) break;
      const pm = L[j].match(/^(\S+)\s+(.+?)\s+(-?[\d.]*,\d{2})$/);
      const pv = (L[j + 1] || "").match(/^(-?[\d.]*,\d{2}) (-?[\d.]*,\d{2})$/);
      if (pm && pv && !/^Agente|^Partic/.test(L[j])) {
        prop.produtores.push({ agente: pm[1], produtor: pm[2], com_percentual: num(pm[3]), participacao: num(pv[1]), com_valor: num(pv[2]) });
        j++;
      }
    }
    propostas.push(prop);
  }
  return propostas;
}

if (process.argv[1] && process.argv[1].endsWith("ler-relatorio-propostas-corp.mjs")) {
  const args = process.argv.slice(2);
  const iJson = args.indexOf("--json");
  const saida = iJson >= 0 ? args.splice(iJson, 2)[1] : null;
  const todas = [];
  for (const pdf of args) {
    const ps = lerRelatorio(pdf);
    todas.push(...ps.map((p) => ({ ...p, arquivo: pdf.split(/[\\/]/).pop() })));
    console.log(pdf.split(/[\\/]/).pop(), "→", ps.length, "propostas | fora do padrão:", ps.filter((p) => p.aviso).length, "| sem produtor:", ps.filter((p) => !p.produtores.length).length);
  }
  if (saida) fs.writeFileSync(saida, JSON.stringify(todas));
}
