// ERP O2 — levantamento: baixa os e-mails de inadimplência das seguradoras (anexos + texto) para uma pasta local.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/baixar-inadimplencia-emails.ts [--dias 15] [--saida pasta]
process.loadEnvFile(".env.local");

import fs from "node:fs";
import path from "node:path";
import { listarMensagensComAnexos, baixarAnexo } from "@/lib/gestaoEmails/gmail";

function arg(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] ?? "" : null;
}

const FONTES: { seguradora: string; query: string }[] = [
  { seguradora: "Pottencial", query: "from:cobranca@pottencial.com.br" },
  { seguradora: "Allianz", query: "subject:(Allianz Conectividade Inadimplencia)" },
  { seguradora: "Alfa", query: "from:financeiro@alfaseg.com.br subject:(Parcelas Pendentes)" },
  { seguradora: "Too", query: 'subject:("Comunicado de Parcelas em Atraso")' },
  { seguradora: "Tokio", query: "from:cartacobranca@tokiomarine.com.br" },
  { seguradora: "Suhai", query: 'from:suhaiseguradora.com (subject:("PARCELA EM ABERTO") OR subject:CANCELAMENTO)' },
];

const limpa = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 90);

async function main() {
  const dias = Number(arg("--dias") ?? 15);
  const saida = arg("--saida") ?? "erp-o2/inadimplencia-seguradoras";
  fs.mkdirSync(saida, { recursive: true });
  const linhas: string[] = [];
  for (const f of FONTES) {
    const pasta = path.join(saida, f.seguradora);
    fs.mkdirSync(pasta, { recursive: true });
    let msgs: Awaited<ReturnType<typeof listarMensagensComAnexos>> = [];
    try {
      msgs = await listarMensagensComAnexos(`newer_than:${dias}d ${f.query}`, 100);
    } catch (e) {
      linhas.push(`${f.seguradora}: ERRO ${(e as Error).message}`);
      continue;
    }
    let anexos = 0;
    for (const m of msgs) {
      const dia = new Date(m.data).toISOString().slice(0, 10);
      const base = `${dia}_${limpa(m.assunto)}_${m.id.slice(-6)}`;
      fs.writeFileSync(path.join(pasta, `${base}.txt`), `${m.assunto}\n${m.de ?? ""}\n${m.data}\n\n${m.corpoTexto}`);
      for (const a of m.anexos) {
        try {
          const buf = await baixarAnexo(m.id, a.attachmentId);
          fs.writeFileSync(path.join(pasta, `${dia}_${m.id.slice(-6)}_${limpa(a.nome)}`), buf);
          anexos++;
        } catch (e) {
          linhas.push(`  ${f.seguradora}: anexo ${a.nome} falhou: ${(e as Error).message}`);
        }
      }
    }
    linhas.push(`${f.seguradora}: ${msgs.length} e-mails, ${anexos} anexos`);
  }
  console.log(linhas.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
