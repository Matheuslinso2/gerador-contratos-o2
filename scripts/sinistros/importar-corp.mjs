// Importa o histórico de sinistros de Seguro Fiança das exportações do Corp
// para a tabela `sinistros_corp` (ver supabase/schema_sinistros_corp.sql).
//
// Aceita os dois formatos que o Corp exporta:
//   - "Consulta de sinistros" (Consulta_sinistros_encerrados/pendentes.xlsx):
//     situação por extenso, responsável, último histórico, produtor;
//   - "Grade" (sinistros_grade.xlsx): situação em letra (I/E/P/A) e despesas.
// O mesmo sinistro costuma vir nos dois -- junta pela chave
// Nosso Nº | nº do sinistro (sem o "F" final que às vezes aparece) |
// ocorrência | item, com a Consulta prevalecendo e a Grade completando.
// Reexecutável: o que já existe é atualizado (situação, valores, histórico).
//
// uso: node scripts/sinistros/importar-corp.mjs <arquivos .xlsx ou pastas...>
//      (sem argumento: lê Consulta_sinistros_* e sinistros_grade* de ~/Downloads)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { supabase } from "../base-unica/_comum.mjs";

function listarArquivos(args) {
  const alvos = args.length ? args : [path.join(os.homedir(), "Downloads")];
  const arquivos = [];
  for (const alvo of alvos) {
    if (fs.statSync(alvo).isDirectory()) {
      for (const f of fs.readdirSync(alvo))
        if (/^(Consulta_sinistros_|sinistros_grade).*\.xlsx$/i.test(f)) arquivos.push(path.join(alvo, f));
    } else arquivos.push(alvo);
  }
  return arquivos.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
}

// O Corp exporta datas como "M/D/AA" (ex.: 1/28/26).
function data(v) {
  const m = String(v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let ano = Number(m[3]);
  if (ano < 100) ano += ano > 50 ? 1900 : 2000;
  const [mes, dia] = [Number(m[1]), Number(m[2])];
  // Digitação errada no Corp (ex.: ano "203") vira data vazia, não trava a carga.
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
const valor = (v) => (v == null || v === "" ? null : Number(String(v).replace(/,/g, "")) || 0);
const texto = (v) => (v == null ? null : String(v).replace(/\r/g, "").trim() || null);

const SITUACAO_GRADE = { I: "INDENIZADO", E: "ENCERRADO SEM INDENIZAÇÃO", P: "PENDENTE", A: "EM ANDAMENTO" };
function situacao(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (SITUACAO_GRADE[s]) return SITUACAO_GRADE[s];
  if (s.startsWith("ENCERRADO SEM")) return "ENCERRADO SEM INDENIZAÇÃO";
  return s;
}

// Descrição livre da equipe: "INADIMPLENCIA / ...", "ENTREGA DAS CHAVES EM ...".
function tipoSinistro(descricao) {
  const d = String(descricao ?? "").toUpperCase();
  if (/CHAVE/.test(d)) return "chaves";
  if (/INADIMPL/.test(d)) return "ocupado";
  return null;
}

function lerArquivo(arquivo) {
  const wb = XLSX.readFile(arquivo);
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: false });
  const cab = linhas[0] ?? [];
  const consulta = cab.includes("Segurado / Terceiro");
  const col = (nome) => cab.indexOf(nome);
  const out = [];
  for (const r of linhas.slice(1)) {
    if (!r?.some((v) => v != null)) continue;
    const g = (nome) => (col(nome) < 0 ? null : r[col(nome)]);
    const base = consulta
      ? {
          nosso_numero: texto(g("Nosso Nº")),
          situacao: situacao(g("Situação")),
          tipo_linha: g("Tipo"),
          segurado: texto(g("Segurado / Terceiro")),
          email: texto(g("E-mail")),
          seguradora: texto(g("Seg.")),
          ramo: texto(g("Ramo")),
          apolice: texto(g("Apólice")),
          numero_sinistro: texto(g("Nº Sinistro")),
          dt_ocorrencia: data(g("Dt. Ocorrência")),
          item: texto(g("Item")),
          dt_aviso: data(g("Dt. Aviso")),
          franquia: valor(g("Franquia")),
          vl_avisado: valor(g("Vl. Avisado")),
          dt_vistoria: data(g("Dt. Vistoria")),
          dt_liberacao: data(g("Dt. Liberação")),
          dt_encerramento: data(g("Dt. Encerramento")),
          vl_indenizado: valor(g("Vl. Indenizado")),
          // Há duas colunas "Descrição": a 1ª (logo após "Oficina") é a do sinistro.
          descricao: texto(r[col("Oficina") + 1]),
          observacoes: texto(g("Observações")),
          agendamento: texto(g("Agendamento")),
          responsavel: texto(g("Responsável")),
          ultimo_historico: texto(g("Últ. Histórico")),
          produtor: texto(g("Produtor")),
          produtor_indireto: texto(g("Prod. Indireto")),
          cobertura: texto(g("Cobertura")),
          fonte: "consulta",
        }
      : {
          nosso_numero: texto(g("Nosso Nº")),
          situacao: situacao(g("Situação")),
          tipo_linha: g("Tipo"),
          segurado: texto(g("Cliente")),
          email: texto(g("Email")),
          seguradora: texto(g("Seg.")),
          ramo: texto(g("Ramo")),
          apolice: texto(g("Apólice")),
          numero_sinistro: texto(g("Nº Sinistro")),
          dt_ocorrencia: data(g("Dt. Ocor.")),
          item: texto(g("Item")),
          dt_aviso: data(g("Dt. Aviso")),
          vl_avisado: valor(g("Vl. Avisado")),
          dt_vistoria: data(g("Dt. Vist.")),
          dt_liberacao: data(g("Dt. Liber.")),
          dt_encerramento: data(g("Dt. Encer.")),
          vl_indenizado: valor(g("Vl. Inden.")),
          observacoes: texto(g("Observações")),
          vl_despesas: valor(g("Vl. Despesas")),
          responsavel: texto(g("Responsável")),
          produtor: texto(g("Produtor")),
          cobertura: texto(g("Cobertura")),
          fonte: "grade",
        };
    out.push(base);
  }
  return out;
}

const terceiro = (t) => /^TER|Terceiro/i.test(String(t ?? ""));
const chaveDe = (s) =>
  [s.nosso_numero, (s.numero_sinistro ?? "").replace(/\s/g, "").toUpperCase().replace(/[A-Z]+$/, ""), s.dt_ocorrencia, s.item ?? ""].join("|");

const arquivos = listarArquivos(process.argv.slice(2));
if (!arquivos.length) throw new Error("Nenhuma exportação do Corp encontrada.");

const porChave = new Map();
let lidas = 0;
for (const arquivo of arquivos) {
  const linhas = lerArquivo(arquivo);
  lidas += linhas.length;
  for (const s of linhas) {
    // Só sinistro de Fiança do próprio segurado (FIAN, 2FIA...).
    if (!/FIA/.test(s.ramo ?? "") || terceiro(s.tipo_linha) || !s.nosso_numero) continue;
    const k = chaveDe(s);
    const atual = porChave.get(k);
    if (!atual) {
      porChave.set(k, { ...s, fontes: [s.fonte] });
      continue;
    }
    // Mesmo formato em duas exportações: vale a mais recente (arquivos vêm
    // em ordem de data). Formatos diferentes: a Consulta prevalece.
    const novaVence = s.fonte === atual.fonte || s.fonte === "consulta";
    const [principal, outro] = novaVence ? [{ ...s, fontes: atual.fontes }, atual] : [atual, s];
    for (const [c, v] of Object.entries(outro)) if (principal[c] == null && v != null) principal[c] = v;
    principal.fontes = [...new Set([...(atual.fontes ?? []), s.fonte])];
    porChave.set(k, principal);
  }
  console.log(`lido: ${path.basename(arquivo)} (${linhas.length} linhas)`);
}

const agora = new Date().toISOString();
const registros = [...porChave.entries()].map(([chave, s]) => {
  // eslint-disable-next-line no-unused-vars -- campos só de leitura
  const { fonte, tipo_linha, ...resto } = s;
  return { ...resto, chave, tipo_sinistro: tipoSinistro(s.descricao), atualizado_em: agora };
});

const invalidos = registros.filter((r) => !["INDENIZADO", "ENCERRADO SEM INDENIZAÇÃO", "PENDENTE", "EM ANDAMENTO"].includes(r.situacao));
if (invalidos.length) throw new Error(`Situação desconhecida em ${invalidos.length} linha(s): ${[...new Set(invalidos.map((r) => r.situacao))].join(", ")}`);

for (let i = 0; i < registros.length; i += 500) {
  const { error } = await supabase.from("sinistros_corp").upsert(registros.slice(i, i + 500), { onConflict: "chave" });
  if (error) throw new Error(`gravação: ${error.message}`);
}

const cont = {};
for (const r of registros) cont[r.situacao] = (cont[r.situacao] ?? 0) + 1;
console.log(`\n${arquivos.length} arquivo(s), ${lidas} linhas lidas → ${registros.length} sinistros de fiança gravados.`);
console.log(cont);
