// Base Única — aplica vínculos automáticos nos registros de fonte.
//
// LIGA SOZINHO (situacao = confirmado, confirmado_por_email = "automatico")
// só com prova forte:
//   - corp_produtor: código Corp = codigo_produtor_corp da ficha; senão CPF/CNPJ igual
//   - receita_cnpj / imobiliarias_conhecidas: CNPJ igual
//   - bitrix_empresa: e-mail exato igual a UM único destino (ficha, ou
//     produtor do Corp já ligado) — e-mails @o2seguros não contam
// SUGERE (situacao = sugerido) quando só o nome bate:
//   - nome_exato: nome normalizado idêntico ao de uma ficha / registro já ligado
//   - nome_parecido: palavras em comum (até 3 candidatos)
// Nunca mexe em vínculo decidido por pessoa (confirmado manual, rejeitado, ignorar).
// Re-rodável: recalcula só o que é automático.
// uso: node scripts/base-unica/vincular.mjs
import { supabase, somenteDigitos, chaveNome, tokens, extrairEmails, buscarTudo } from "./_comum.mjs";

const fichas = await buscarTudo("imobiliarias",
  "id, nome, apelido, cnpj, codigo_produtor_corp, email, email_faturas, email_repasses, email_campanhas, receita_razao_social, receita_nome_fantasia, grupo_id");
const registros = await buscarTudo("imobiliaria_registros_fonte", "id, fonte, chave_externa, nome_original, dados, situacao, confirmado_por_email, imobiliaria_id");

const porCnpj = new Map(), porCodigo = new Map();
for (const f of fichas) {
  const c = somenteDigitos(f.cnpj);
  if (c) porCnpj.set(c, [...(porCnpj.get(c) || []), f.id]);
  if (f.codigo_produtor_corp) porCodigo.set(String(f.codigo_produtor_corp).trim(), [...(porCodigo.get(String(f.codigo_produtor_corp).trim()) || []), f.id]);
}
const ehO2 = (e) => /@o2(seguros|grupo)\.com\.br$/.test(e);
const porEmail = new Map(); // email -> Set(ficha)
const addEmail = (e, id) => { if (!ehO2(e)) porEmail.set(e, new Set([...(porEmail.get(e) || []), id])); };
for (const f of fichas) {
  for (const e of extrairEmails([f.email, ...(f.email_faturas || []), ...(f.email_repasses || []), ...(f.email_campanhas || [])].join(" "))) addEmail(e, f.id);
}

const travado = (r) => ["rejeitado", "ignorar"].includes(r.situacao) || (r.situacao === "confirmado" && r.confirmado_por_email !== "automatico");
const decisao = new Map(); // registro id -> {imobiliaria_id, situacao, metodo, sugestoes}
const confirmar = (r, id, metodo) => decisao.set(r.id, { imobiliaria_id: id, situacao: "confirmado", metodo_vinculo: metodo, sugestoes: [] });

// 1) Prova forte por CNPJ / código
for (const r of registros) {
  if (travado(r)) continue;
  if (r.fonte === "corp_produtor") {
    const cod = r.chave_externa.split("#")[0];
    const porCod = porCodigo.get(cod) || [];
    const porDoc = porCnpj.get(r.dados?.cpf_cnpj || "") || [];
    if (porCod.length === 1 && !r.dados?.codigo_corp_repetido) confirmar(r, porCod[0], "codigo_corp");
    else if (porDoc.length === 1) confirmar(r, porDoc[0], "cnpj");
  } else if (r.fonte === "receita_cnpj" || r.fonte === "imobiliarias_conhecidas") {
    const ids = porCnpj.get(r.fonte === "receita_cnpj" ? r.chave_externa : r.dados?.cnpj || "") || [];
    if (ids.length === 1) confirmar(r, ids[0], "cnpj");
  }
}
// Registros do Corp ligados também emprestam os e-mails deles
const vinculoAtual = (r) => decisao.get(r.id)?.situacao === "confirmado" ? decisao.get(r.id).imobiliaria_id : (r.situacao === "confirmado" ? r.imobiliaria_id : null);
for (const r of registros) {
  if (r.fonte !== "corp_produtor") continue;
  const id = vinculoAtual(r);
  if (id) for (const e of r.dados?.emails || []) addEmail(e, id);
}

// 2) Bitrix por e-mail exato
for (const r of registros) {
  if (travado(r) || r.fonte !== "bitrix_empresa") continue;
  const alvos = new Set();
  for (const e of r.dados?.emails || []) for (const id of porEmail.get(e) || []) alvos.add(id);
  if (alvos.size === 1) confirmar(r, [...alvos][0], "email_exato");
  else if (alvos.size > 1) decisao.set(r.id, { imobiliaria_id: null, situacao: "sugerido", metodo_vinculo: "email_varios",
    sugestoes: [...alvos].map((id) => ({ imobiliaria_id: id, motivo: "mesmo e-mail", score: 1 })) });
}

// 3) Nomes: índice com nome/apelido/Receita da ficha + nomes de registros já ligados
const indiceNome = new Map(); // chave -> Set(ficha)
const addNome = (n, id) => { const k = chaveNome(n); if (k) indiceNome.set(k, new Set([...(indiceNome.get(k) || []), id])); };
for (const f of fichas) [f.nome, f.apelido, f.receita_razao_social, f.receita_nome_fantasia].forEach((n) => addNome(n, f.id));
for (const r of registros) { const id = vinculoAtual(r); if (id) addNome(r.nome_original, id); }
const tokensFicha = fichas.map((f) => ({ id: f.id, t: new Set([f.nome, f.apelido, f.receita_nome_fantasia].flatMap(tokens)) }));

for (const r of registros) {
  if (travado(r) || decisao.has(r.id)) continue;
  const exatos = indiceNome.get(chaveNome(r.nome_original)) || new Set();
  if (exatos.size) {
    decisao.set(r.id, { imobiliaria_id: null, situacao: "sugerido", metodo_vinculo: "nome_exato",
      sugestoes: [...exatos].map((id) => ({ imobiliaria_id: id, motivo: "nome igual", score: 1 })) });
    continue;
  }
  const t = new Set(tokens(r.nome_original));
  const cands = [];
  if (t.size) for (const f of tokensFicha) {
    const inter = [...t].filter((x) => f.t.has(x)).length;
    const score = inter / Math.max(t.size, Math.min(f.t.size, 4));
    if (inter && score >= 0.5) cands.push({ imobiliaria_id: f.id, motivo: "nome parecido", score: Math.round(score * 100) / 100 });
  }
  cands.sort((a, b) => b.score - a.score);
  decisao.set(r.id, cands.length
    ? { imobiliaria_id: null, situacao: "sugerido", metodo_vinculo: "nome_parecido", sugestoes: cands.slice(0, 3) }
    : { imobiliaria_id: null, situacao: "a_identificar", metodo_vinculo: null, sugestoes: [] });
}

// 4) Grava
const agora = new Date().toISOString();
const linhas = [...decisao].map(([id, d]) => ({ id, ...d,
  confirmado_por_email: d.situacao === "confirmado" ? "automatico" : null,
  confirmado_em: d.situacao === "confirmado" ? agora : null, updated_at: agora }));
for (const l of linhas) {
  const { id, ...campos } = l;
  const { error } = await supabase.from("imobiliaria_registros_fonte").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}
const resumo = {};
for (const l of linhas) { const k = `${l.situacao}${l.metodo_vinculo ? ":" + l.metodo_vinculo : ""}`; resumo[k] = (resumo[k] || 0) + 1; }
console.log("registros avaliados:", linhas.length, resumo);
