// Lê (SÓ LEITURA) os PDFs de apólices da Tokio baixados do portal (%TEMP%\tokio\pdfs) e confere com as propostas do ERP:
// número da apólice, vigência, CPFs/CNPJs no texto; liga proposta↔apólice por CPF + ramo e classifica a confiança.
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { documentosNoTexto, textoDoPdf } from "@/lib/erp/anexosEmail";
const T = path.join(os.tmpdir(), "tokio");
(async () => {
  const cruz = JSON.parse(fs.readFileSync(path.join(T, "cruzamento.json"), "utf8")) as { id: string; codigo_o2: number; ramo: string; proposta: string | null; via: string; ap: { n: string; ramo: string; prod: string; ini: string; fim: string; emi: string; pt: string; cpf: string }[] }[];
  const erp = new Set<string>(JSON.parse(fs.readFileSync(path.join(T, "erp-numeros.json"), "utf8")));
  const info = new Map<string, { texto: string; cpfs: Set<string>; temNumero: boolean; temIni: boolean }>();
  const pdfs = fs.readdirSync(path.join(T, "pdfs")).filter((f) => f.endsWith(".pdf"));
  let semTexto = 0;
  for (const f of pdfs) {
    const { t } = await textoDoPdf(fs.readFileSync(path.join(T, "pdfs", f)), []);
    if (!t || t.length < 100) { semTexto++; continue; }
    info.set(f.replace(".pdf", ""), { texto: t, cpfs: documentosNoTexto(t), temNumero: false, temIni: false });
  }
  console.log("PDFs lidos", info.size, "sem texto", semTexto);
  const r = { propostas: 0, confirmaCpfNoPdf: 0, umParUm: 0, varias: 0 };
  const porAp = new Map<string, string[]>(); // apólice -> propostas candidatas
  const linhas: string[] = ["codigo_o2;ramo_erp;apolice_portal;ramo_portal;ini;fim;emissao;premio_total;cpf_no_pdf;n_propostas_do_cpf;n_apolices_novas_do_cpf"];
  for (const o of cruz) {
    const novas = o.ap.filter((a) => !erp.has(a.n));
    if (!novas.length) continue;
    r.propostas++;
    for (const a of novas) {
      const i = info.get(`${a.ramo}_${a.n}`);
      const cpfNoPdf = !!i && i.cpfs.has(a.cpf);
      if (cpfNoPdf) r.confirmaCpfNoPdf++;
      (porAp.get(`${a.ramo}_${a.n}`) ?? porAp.set(`${a.ramo}_${a.n}`, []).get(`${a.ramo}_${a.n}`)!).push(String(o.codigo_o2));
      linhas.push([o.codigo_o2, o.ramo, a.n, a.prod, a.ini, a.fim, a.emi, a.pt, cpfNoPdf ? "sim" : "não", "", novas.length].join(";"));
    }
  }
  const dist: Record<string, number> = {}; for (const [, v] of porAp) dist[String(v.length)] = (dist[String(v.length)] ?? 0) + 1;
  console.log(JSON.stringify(r), "apólices por nº de propostas candidatas:", JSON.stringify(dist));
  fs.writeFileSync(path.join(T, "ligacoes-candidatas.csv"), "﻿" + linhas.join("\n"));
  // amostra de texto de um PDF
  const k = [...info.keys()][0]; console.log(k, info.get(k)!.texto.slice(0, 700).replace(/\s+/g, " "));
})();
