// Lê (SÓ LEITURA) os PDFs de apólice Tokio de uma pasta (%TEMP%\tokio\<pasta>) e extrai: nº da apólice, proposta, vigência, emissão, imobiliária,
// CNPJ da imobiliária, segurado CPF/CNPJ, prêmio. Imprime resumo por imobiliária e grava CSV <pasta>.csv.
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
const T = path.join(os.tmpdir(), "tokio"); const pasta = path.join(T, process.argv[2]);
(async () => {
  const linhas = ["apolice;proposta;vig_ini;vig_fim;emissao;imobiliaria;cnpj_imob;segurado_doc;premio_total;ramo"]; const porImob: Record<string, number> = {}; let semLer = 0;
  for (const f of fs.readdirSync(pasta).filter((x) => x.endsWith(".pdf")).sort()) {
    const { t } = await textoDoPdf(fs.readFileSync(path.join(pasta, f)), []); if (!t) { semLer++; continue; } const s = t.replace(/\s+/g, " ");
    const ap = /Ap[óo]lice:\s*(\d+)/.exec(s)?.[1]; const prop = /Proposta:\s*(\d+)/.exec(s)?.[1];
    const vig = /Vig[êe]ncia:.*?dia (\d{2}\/\d{2}\/\d{4}) at[ée].*?dia (\d{2}\/\d{2}\/\d{4})/.exec(s); const emi = /Data da Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/.exec(s)?.[1];
    const imob = /Nome da Imobili[áa]ria:\s*(.+?)\s+CNPJ\/CPF:\s*([\d.\-/ ]+)/.exec(s); const seg = /Segurado:\s*(?:CPF|CNPJ):\s*([\d.\-/]+)/.exec(s)?.[1];
    const prem = /Pr[êe]mio Total[^R\d]*R?\$?\s*([\d.]+,\d{2})/i.exec(s) ?? /Total do Pr[êe]mio[^\d]*([\d.]+,\d{2})/i.exec(s) ?? /Pr[êe]mio a pagar[^\d]*([\d.]+,\d{2})/i.exec(s); const ramo = /Ramo:\s*([\d.]+)/.exec(s)?.[1];
    const nomeImob = imob?.[1]?.trim() ?? "(sem imobiliária)"; porImob[nomeImob] = (porImob[nomeImob] ?? 0) + 1;
    linhas.push([ap, prop, vig?.[1], vig?.[2], emi, nomeImob, imob?.[2]?.replace(/\s/g, ""), seg, prem?.[1], ramo].join(";"));
  }
  fs.writeFileSync(path.join(T, `${process.argv[2]}.csv`), "﻿" + linhas.join("\n"));
  console.log("lidos", linhas.length - 1, "sem texto", semLer); console.log("POR IMOBILIÁRIA:", JSON.stringify(Object.entries(porImob).sort((a, b) => b[1] - a[1])));
  console.log(linhas.slice(0, 4).join("\n"));
})();
