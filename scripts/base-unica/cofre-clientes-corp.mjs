// Base Única — leva para o COFRE (tabela `locatarios`, só armazenamento) o
// NOME do cliente de cada proposta do Corp, lido das cópias congeladas dos
// PDFs "Relatório de Propostas" (que não trazem documento do cliente).
// Carrega em base_unica_tmp_clientes_corp; o cruzamento é feito em SQL:
//   - nome igual a UM único cliente com CPF/CNPJ já no cofre → liga ('nome_unico');
//   - senão → cliente "identificado só pelo nome" ('so_nome').
// Clientes com documento (grade do Corp) já foram ligados pelo nº da proposta.
// uso: node scripts/base-unica/cofre-clientes-corp.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { supabase, buscarTudo } from "./_comum.mjs";
import { lerRelatorio } from "./ler-relatorio-propostas-corp.mjs";

const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const normNome = (s) => semAcento(s).toUpperCase().replace(/\s+/g, " ").trim();
function produtoDoRamo(ramo) {
  const r = semAcento(ramo).toUpperCase();
  if (/CAPITALIZ/.test(r)) return "capitalizacao";
  if (/FIANC/.test(r)) return "fianca";
  if (/AUTOMOVEL/.test(r)) return "automovel";
  return "re";
}

const pdfs = (await buscarTudo("base_unica_planilhas_congeladas", "arquivo_id, nome, copia_storage_path")).filter((c) => c.arquivo_id.startsWith("corp-pdf:"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "corp-cli-"));
const linhas = new Map();
for (const c of pdfs) {
  const { data, error } = await supabase.storage.from("planilhas-congeladas").download(c.copia_storage_path);
  if (error) throw new Error(`${c.nome}: ${error.message}`);
  const arq = path.join(tmp, "r.pdf");
  fs.writeFileSync(arq, Buffer.from(await data.arrayBuffer()));
  for (const p of lerRelatorio(arq)) {
    const nome = (p.cliente_nome || "").trim();
    if (!nome || /PREMIA/i.test(nome)) continue; // lançamentos de premiação não são cliente
    const k = `${produtoDoRamo(p.ramo)}|${p.numero}`;
    if (!linhas.has(k)) linhas.set(k, { produto: produtoDoRamo(p.ramo), numero: p.numero, nome, nome_normalizado: normNome(nome) });
  }
  console.log("lido:", c.nome);
}
fs.rmSync(tmp, { recursive: true, force: true });

const todas = [...linhas.values()];
await supabase.from("base_unica_tmp_clientes_corp").delete().neq("numero", "");
for (let i = 0; i < todas.length; i += 2000) {
  const { error } = await supabase.from("base_unica_tmp_clientes_corp").insert(todas.slice(i, i + 2000));
  if (error) throw new Error(error.message);
}
console.log("carregados na tabela temporária:", todas.length);
