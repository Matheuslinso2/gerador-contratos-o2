// Base Única de Imobiliárias — Fase 1: carrega os registros de fonte.
// Só LÊ as fontes (Bitrix, planilha do Corp, planilhas do Drive já varridas,
// imobiliarias_conhecidas) e grava em `imobiliaria_registros_fonte` /
// `imobiliaria_grupos`. Não toca em nenhuma coluna antiga de `imobiliarias`.
//
// uso:
//   node scripts/base-unica/carregar-fontes.mjs grupos
//   node scripts/base-unica/carregar-fontes.mjs bitrix
//   node scripts/base-unica/carregar-fontes.mjs corp "<caminho Produtores.xlsx>"
//   node scripts/base-unica/carregar-fontes.mjs conhecidas
//   node scripts/base-unica/carregar-fontes.mjs planilhas "<nomes_planilhas.json da varredura>"
import fs from "node:fs";
import XLSX from "xlsx";
import { supabase, somenteDigitos, extrairEmails, buscarTudo, gravarRegistros, bitrixTodos } from "./_comum.mjs";

// Cópia de src/lib/gruposVisuaisImobiliarias.ts (que continua intacto e
// servindo Faturas/Configurações). Aqui é só o ponto de partida dos grupos
// da base única — daqui pra frente eles são editados pela tela.
const GRUPOS_INICIAIS = {
  ACESSE_RJ: { nome: "Acesse Imóvel RJ", cnpjs: ["37460218000139", "02038854000192"] },
  MAX_BROKERS: { nome: "Max Brokers", cnpjs: ["56106738000192", "34595830000120"] },
  MARCUS_DREHER: { nome: "Marcus Dreher", cnpjs: ["41364706000110", "00908412711"] },
  RAMIRO_SA: { nome: "Ramiro Sá", cnpjs: ["48328384000100", "40444309772"] },
  TERUSZKIN: { nome: "Grupo Teruszkin", cnpjs: ["92786854000163", "08984167000146", "09008875000104", "28822660000177"] },
  RIBAS_HP: { nome: "Ribas-HP / Pintas / HC Consultoria", cnpjs: ["07930322000189", "49915542000183"] },
  SINDMASTER: { nome: "SindMaster", cnpjs: ["09519990000143", "31892996000110"] },
  RENATO_ACRJ: { nome: "Renato de Sousa Lopes (ACRJ)", cnpjs: ["07828286716", "33611617000100"] },
};

async function grupos() {
  const imobs = await buscarTudo("imobiliarias", "id, cnpj, grupo_id");
  for (const [chave, g] of Object.entries(GRUPOS_INICIAIS)) {
    const { data, error } = await supabase.from("imobiliaria_grupos")
      .upsert({ chave, nome: g.nome, observacao: "Copiado de gruposVisuaisImobiliarias.ts (2026-10-16)", criado_por_email: "carga-automatica" }, { onConflict: "chave" })
      .select("id").single();
    if (error) throw error;
    const alvo = imobs.filter((i) => g.cnpjs.includes(somenteDigitos(i.cnpj)) && !i.grupo_id);
    if (alvo.length) {
      const { error: e2 } = await supabase.from("imobiliarias").update({ grupo_id: data.id }).in("id", alvo.map((i) => i.id));
      if (e2) throw e2;
    }
    console.log(`grupo ${g.nome}: ${alvo.length} imobiliária(s) ligada(s) de ${g.cnpjs.length} CNPJs`);
  }
}

async function bitrix() {
  // Empresas usadas em Fiança (1042) e RE (1046) + texto livre da Capitalização (1048)
  const uso = new Map(); // companyId -> {fianca, re, anos:Set}
  for (const [prod, et] of [["fianca", 1042], ["re", 1046]]) {
    const itens = await bitrixTodos("crm.item.list", { entityTypeId: et, select: ["id", "companyId", "createdTime"] }, "items");
    for (const it of itens) {
      if (!it.companyId) continue;
      const u = uso.get(it.companyId) || { fianca: 0, re: 0, anos: new Set() };
      u[prod]++;
      u.anos.add(Number(String(it.createdTime).slice(0, 4)));
      uso.set(it.companyId, u);
    }
  }
  const ids = [...uso.keys()];
  const empresas = [];
  for (let i = 0; i < ids.length; i += 50) {
    empresas.push(...(await bitrixTodos("crm.company.list", {
      filter: { "@ID": ids.slice(i, i + 50) },
      select: ["ID", "TITLE", "PHONE", "EMAIL", "WEB", "ADDRESS", "ADDRESS_CITY", "ADDRESS_REGION", "ADDRESS_PROVINCE", "DATE_CREATE"],
    })));
  }
  const registros = empresas.map((e) => {
    const u = uso.get(Number(e.ID));
    return {
      fonte: "bitrix_empresa", chave_externa: String(e.ID), nome_original: e.TITLE,
      dados: {
        emails: [...new Set((e.EMAIL || []).flatMap((x) => extrairEmails(x.VALUE)))],
        telefones: [...new Set((e.PHONE || []).map((x) => String(x.VALUE).trim()).filter(Boolean))],
        site: (e.WEB || []).map((x) => x.VALUE)[0] ?? null,
        endereco: e.ADDRESS ?? null, cidade: e.ADDRESS_CITY ?? null, uf: e.ADDRESS_PROVINCE || e.ADDRESS_REGION || null,
        itens_fianca: u.fianca, itens_re: u.re, criado_no_bitrix: e.DATE_CREATE,
      },
      volume: u.fianca + u.re, anos: [...u.anos].sort(),
    };
  });
  console.log("bitrix_empresa:", await gravarRegistros(registros), "registros");

  const cap = await bitrixTodos("crm.item.list", { entityTypeId: 1048, select: ["id", "ufCrm14CapImobAdmin", "createdTime"] }, "items");
  const porTexto = new Map();
  for (const it of cap) {
    const t = String(it.ufCrm14CapImobAdmin ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const p = porTexto.get(t) || { n: 0, anos: new Set() };
    p.n++; p.anos.add(Number(String(it.createdTime).slice(0, 4)));
    porTexto.set(t, p);
  }
  const regCap = [...porTexto].map(([t, p]) => ({ fonte: "bitrix_cap_texto", chave_externa: t, nome_original: t, volume: p.n, anos: [...p.anos].sort() }));
  console.log("bitrix_cap_texto:", await gravarRegistros(regCap), "registros");
}

async function corp(arquivo) {
  const wb = XLSX.readFile(arquivo);
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: null });
  // Dados bancários do produtor (Banco/Agência/Conta) ficam de fora de propósito.
  const registros = linhas.filter((l) => l["Código"]).map((l) => ({
    fonte: "corp_produtor", chave_externa: String(l["Código"]).trim(), nome_original: l["Nome do Produtor"],
    dados: {
      cpf_cnpj: somenteDigitos(l["CPF/CNPJ"]) || null, pessoa: l["Pessoa"], agente: l["Agente"], ativo: l["Ativo"], filial: l["Filial"],
      emails: extrairEmails(`${l["E-mail"] ?? ""} ${l["EMAIL_ENVIO_APO"] ?? ""}`),
      telefones: [l["Fone 1"], l["Fone 2"]].map((x) => String(x ?? "").trim()).filter((x) => x && x !== "0"),
      endereco: [l["Logradouro"], l["Número"], l["Complemento"]].filter(Boolean).join(", ") || null,
      bairro: l["Bairro"], cep: l["CEP"], cidade: l["Cidade"], uf: l["UF"],
      cadastrado_em: l["Dt. Cadastro"], modificado_em: l["Última Modificação"], arquivo: arquivo.split(/[\\/]/).pop(),
    },
  }));
  // O Corp repete código em raros casos (ex.: código 1 = "MARCOS OTÁVIO" e
  // "O2 CORRETORA" na exportação de 15/09/2026) — mantém os dois, numerando.
  const vistos = new Map();
  for (const r of registros) {
    const n = (vistos.get(r.chave_externa) || 0) + 1;
    vistos.set(r.chave_externa, n);
    if (n > 1) { r.dados.codigo_corp_repetido = r.chave_externa; r.chave_externa = `${r.chave_externa}#${n}`; }
  }
  console.log("corp_produtor:", await gravarRegistros(registros), "registros");
}

async function conhecidas() {
  const linhas = await buscarTudo("imobiliarias_conhecidas", "id, nome, cnpj, cidade, uf, bairro");
  const registros = linhas.map((l) => ({
    fonte: "imobiliarias_conhecidas", chave_externa: somenteDigitos(l.cnpj) || `id:${l.id}`, nome_original: l.nome,
    dados: { cnpj: somenteDigitos(l.cnpj) || null, cidade: l.cidade, uf: l.uf, bairro: l.bairro },
  }));
  console.log("imobiliarias_conhecidas:", await gravarRegistros(registros), "registros");
}

async function planilhas(arquivo) {
  const abas = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  const agg = new Map(); // fonte|texto -> {n, anos, arquivos}
  for (const a of abas) {
    if (!a.nomes) continue;
    const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
    if (/^IMOBILI/.test(semAcento(a.aba))) continue; // lista de apoio (dropdown), não é produção
    if (/^COPIA DE|^TESTE|PADRAO/.test(semAcento(a.arquivo))) continue; // cópias e modelos
    const ehRE = /COTACAO DIARIA RE|COTACAO DIARIA/.test(semAcento(`${a.arquivo} ${a.pasta}`));
    const fonte = ehRE ? "planilha_re" : "planilha_fianca";
    const m = a.arquivo.match(/20\d\d/) || a.pasta.match(/20\d\d/) || a.arquivo.match(/^\d{1,2}\.(\d{2})\b/);
    const ano = m ? Number(m[0].length === 4 ? m[0] : "20" + m[1]) : null;
    for (const [texto, q] of Object.entries(a.nomes)) {
      const t = texto.replace(/\s+/g, " ").trim();
      if (!t || /^(TOTAL|#N\/A|#REF!|0|-|—)$/i.test(t)) continue;
      const k = `${fonte}|${t}`;
      const p = agg.get(k) || { fonte, t, n: 0, anos: new Set(), arquivos: new Set() };
      p.n += q; if (ano) p.anos.add(ano); p.arquivos.add(a.arquivoId);
      agg.set(k, p);
    }
  }
  const registros = [...agg.values()].map((p) => ({
    fonte: p.fonte, chave_externa: p.t, nome_original: p.t, volume: p.n, anos: [...p.anos].sort(),
    dados: { qtd_arquivos: p.arquivos.size },
  }));
  console.log("planilhas:", await gravarRegistros(registros), "registros");
}

const [passo, arg] = process.argv.slice(2);
const passos = { grupos, bitrix, corp: () => corp(arg), conhecidas, planilhas: () => planilhas(arg) };
if (!passos[passo]) { console.error("passo desconhecido. Use:", Object.keys(passos).join(", ")); process.exit(1); }
await passos[passo]();
