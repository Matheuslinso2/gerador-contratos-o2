// Base Única — consulta pública de CNPJ (dados abertos da Receita via
// BrasilAPI) para cada ficha com CNPJ de empresa (14 dígitos). CPF não é
// consultado. Grava:
//   - registro de fonte `receita_cnpj` (dados como vieram, incl. sócios — o
//     sócio PF ajuda a juntar PF+PJ do mesmo dono na revisão);
//   - colunas NOVAS receita_* da ficha (nunca as colunas antigas).
// Retoma de onde parou: pula CNPJ consultado nos últimos 30 dias.
// uso: node scripts/base-unica/receita.mjs
import { supabase, somenteDigitos, buscarTudo, gravarRegistros } from "./_comum.mjs";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const limite = Date.now() - 30 * 86400e3;

async function consultar(cnpj) {
  for (let t = 0; t < 4; t++) {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { "User-Agent": "workspace-o2-base-unica" } });
    if (r.status === 404) return { naoEncontrado: true };
    if (r.status === 429 || r.status >= 500) { await espera(3000 * (t + 1)); continue; }
    if (!r.ok) return { erro: `HTTP ${r.status}` };
    return await r.json();
  }
  return { erro: "sem resposta após 4 tentativas" };
}

const imobs = (await buscarTudo("imobiliarias", "id, cnpj, receita_consultada_em"))
  .filter((i) => somenteDigitos(i.cnpj).length === 14)
  .filter((i) => !i.receita_consultada_em || new Date(i.receita_consultada_em).getTime() < limite);
console.log("a consultar:", imobs.length);

const vistos = new Set();
let ok = 0, nao = 0, erro = 0;
for (const i of imobs) {
  const cnpj = somenteDigitos(i.cnpj);
  if (vistos.has(cnpj)) continue;
  vistos.add(cnpj);
  const d = await consultar(cnpj);
  const agora = new Date().toISOString();
  if (d.erro) { erro++; console.log("erro", cnpj, d.erro); await espera(800); continue; }
  if (d.naoEncontrado) {
    nao++;
    await supabase.from("imobiliarias").update({ receita_situacao: "NÃO ENCONTRADO", receita_consultada_em: agora }).eq("id", i.id);
  } else {
    ok++;
    await gravarRegistros([{
      fonte: "receita_cnpj", chave_externa: cnpj, nome_original: d.razao_social,
      dados: {
        razao_social: d.razao_social, nome_fantasia: d.nome_fantasia || null, situacao: d.descricao_situacao_cadastral,
        data_situacao: d.data_situacao_cadastral, abertura: d.data_inicio_atividade, cnae: d.cnae_fiscal_descricao,
        email: d.email ? String(d.email).toLowerCase() : null,
        telefones: [d.ddd_telefone_1, d.ddd_telefone_2].filter(Boolean),
        endereco: [d.descricao_tipo_de_logradouro, d.logradouro, d.numero, d.complemento].filter(Boolean).join(" "),
        bairro: d.bairro, cep: d.cep, cidade: d.municipio, uf: d.uf,
        socios: (d.qsa || []).map((s) => ({ nome: s.nome_socio, qualificacao: s.qualificacao_socio })),
      },
    }]);
    await supabase.from("imobiliarias").update({
      receita_razao_social: d.razao_social, receita_nome_fantasia: d.nome_fantasia || null,
      receita_situacao: d.descricao_situacao_cadastral, receita_consultada_em: agora,
    }).in("cnpj", [i.cnpj]);
  }
  if ((ok + nao + erro) % 25 === 0) console.log(`... ${ok + nao + erro}/${imobs.length}`);
  await espera(700);
}
console.log({ ok, naoEncontrado: nao, erro });
