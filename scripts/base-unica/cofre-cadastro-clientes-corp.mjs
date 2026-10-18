// Base Única — carrega o CADASTRO DE CLIENTES do Corp (xlsx enviado pelo
// Matheus em 18/10/2026, cópia congelada "corp-xlsx:clientes-2026-10-18") numa
// tabela temporária trancada; o cruzamento com o cofre `locatarios` é feito em
// SQL logo depois (e a tabela temporária é apagada). Dados pessoais: só cofre.
// uso: node scripts/base-unica/cofre-cadastro-clientes-corp.mjs
import XLSX from "xlsx";
import { supabase } from "./_comum.mjs";

const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const normNome = (s) => semAcento(s).toUpperCase().replace(/\s+/g, " ").trim();
const txt = (v) => (v == null ? null : String(v).replace(/\s+/g, " ").trim() || null);
const dataBr = (v) => {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const m = String(v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let a = m[3]; if (a.length === 2) a = (Number(a) > 40 ? "19" : "20") + a;
  return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

const { data, error } = await supabase.storage.from("planilhas-congeladas").download("corp-xlsx/clientes-2026-10-18.xlsx");
if (error) throw new Error(error.message);
// cellDates + raw: datas viram Date de verdade (o texto formatado sai em m/d/aa).
const wb = XLSX.read(Buffer.from(await data.arrayBuffer()), { type: "buffer", cellDates: true });
const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });

const registros = linhas.map((l, i) => {
  const pessoa = txt(l["Pessoa"])?.toUpperCase() ?? null;
  let doc = String(l["CPF/CNPJ"] ?? "").replace(/\D/g, "");
  // O Excel come zero à esquerda: completa pelo tipo de pessoa.
  if (doc) doc = pessoa === "J" ? doc.padStart(14, "0") : doc.length <= 11 ? doc.padStart(11, "0") : doc;
  if (doc && ![11, 14].includes(doc.length)) doc = null;
  const ddd = String(l["Fone (DDD)"] ?? "").replace(/\D/g, "");
  const num = String(l["Fone (Número)"] ?? "").replace(/\D/g, "");
  const email = (txt(l["E-mail"]) || "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/)?.[0] ?? null;
  const dados = Object.fromEntries(Object.entries({
    endereco: [txt(l["Endereço"]), txt(l["Número"]), txt(l["Complemento"])].filter(Boolean).join(", ") || null,
    bairro: txt(l["Bairro"]), cidade: txt(l["Cidade"]), uf: txt(l["Estado"]), cep: txt(l["CEP"]) !== "0" ? txt(l["CEP"]) : null,
    nascimento: dataBr(l["Dt. Nascimento"]), sexo: txt(l["Sexo"]), estado_civil: txt(l["Estado Civil"]), profissao: txt(l["Profissão"]),
    rg: txt(l["RG"]), rg_orgao: txt(l["RG (Órgão Emissor)"]), cnh: txt(l["CNH"]),
    corp_produtor_codigo: txt(l["CodPro"]), corp_produtor: txt(l["Produtor"]), corp_agente: txt(l["Agente"]), corp_ativo: txt(l["Ativo"]),
  }).filter(([, v]) => v != null && v !== ""));
  return {
    linha: i + 2, codigo: txt(l["Código"]), doc: doc || null, pessoa, nome: txt(l["Nome"]), nome_normalizado: normNome(l["Nome"]),
    email, telefone: num ? (ddd && ddd !== "0" ? `(${ddd}) ${num}` : num) : null, dados, cadastro: dataBr(l["Dt. Cadastro"]),
  };
}).filter((r) => r.nome);

await supabase.from("base_unica_tmp_cadastro_clientes").delete().gte("linha", 0);
for (let i = 0; i < registros.length; i += 2000) {
  const { error: e } = await supabase.from("base_unica_tmp_cadastro_clientes").insert(registros.slice(i, i + 2000));
  if (e) throw new Error(e.message);
}
console.log({ linhas: registros.length, comDocumento: registros.filter((r) => r.doc).length, comEmail: registros.filter((r) => r.email).length, comTelefone: registros.filter((r) => r.telefone).length });
