// Base Única — Fase 3: importa a PRODUÇÃO REAL (efetivada) do Corp a partir
// das cópias congeladas dos PDFs "Relatório de Propostas" (bucket privado
// planilhas-congeladas, arquivo_id "corp-pdf:*"). Regra do Matheus
// (2026-10-18): planilhas/CRM = funil; Corp = o que foi efetivado.
//
// - Produto vem do RAMO de cada proposta (o PDF de Fiança trouxe Automóvel
//   junto pelo filtro "2FIA, AUTO, FIAN" — cada proposta entra uma vez só,
//   pela chave produto + nº da proposta).
// - TODOS os produtores ficam em extras.produtores; imobiliaria_texto recebe o
//   produtor "principal" pela regra padrão (ignora "O2 CORRETORA" quando há
//   outro; maior Com($); empate = o primeiro). A regra final (rede/unidade)
//   pode ser aplicada na consulta sem reimportar.
// - Competência = mês da DATA DA PROPOSTA (mesmo eixo do painel Produção atual,
//   ver schema_producao_erp.sql).
// - Cliente (nome/documento parcial) NÃO é gravado: aguardando decisão do
//   Matheus sobre o cofre.
// uso: node scripts/base-unica/importar-corp-propostas.mjs [--gravar] [--somente-novos]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { supabase, buscarTudo } from "./_comum.mjs";
import { lerRelatorio } from "./ler-relatorio-propostas-corp.mjs";

const gravar = process.argv.includes("--gravar");
const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

function produtoDoRamo(ramo) {
  const r = sem(ramo);
  if (/CAPITALIZ/.test(r)) return ["capitalizacao", "Capitalização"];
  if (/FIANC/.test(r)) return ["fianca", "Fiança locatícia"];
  if (/AUTOMOVEL/.test(r)) return ["automovel", "Automóvel"];
  // "demais ramos" de RE (relatórios 2POR, COND, CCOM…) — antes de RESIDENCIAL
  // para "CONTEÚDO RESIDENCIAL" não cair em Residencial.
  if (/CONTEUDO/.test(r)) return ["re", "Conteúdo residencial/comercial"];
  if (/CONDOMINIO/.test(r)) return ["re", "Condomínio"];
  if (/VIDA/.test(r)) return ["re", "Vida"];
  if (/VIAGEM/.test(r)) return ["re", "Viagem"];
  if (/RC PROFISSIONAL|RESPONSABILIDADE CIV/.test(r)) return ["re", "RC"];
  if (/PORTAT/.test(r)) return ["re", "Equipamentos portáteis"];
  if (/IMOBILIARIO/.test(r)) return ["re", "Incêndio Imobiliário"];
  if (/RESIDENCIAL/.test(r)) return ["re", "Residencial"];
  if (/EMPRESARIAL/.test(r)) return ["re", "Empresarial"];
  return [null, null];
}
function produtorPrincipal(produtores) {
  const semO2 = produtores.filter((p) => !/^O2 CORRETORA/i.test(p.produtor));
  const lista = semO2.length ? semO2 : produtores;
  return lista.reduce((melhor, p) => (p.com_valor > melhor.com_valor ? p : melhor), lista[0]);
}
const totaisDoPdf = (arquivo) => {
  const t = execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", arquivo, "-"], { maxBuffer: 1 << 29 }).toString("utf8");
  const num = (s) => Number(s.replace(/\./g, "").replace(",", "."));
  let n = 0, premio = 0, comissao = 0;
  for (const m of t.matchAll(/^Total do Ramo [^:]*: (\d+) (-?[\d.]+,\d*) (-?[\d.]+,\d*)/gm)) { n += +m[1]; premio += num(m[2]); comissao += num(m[3]); }
  return { propostas: n, premio_liquido: Math.round(premio * 100) / 100, comissao_corretora: Math.round(comissao * 100) / 100 };
};

const pdfs = (await buscarTudo("base_unica_planilhas_congeladas", "arquivo_id, nome, copia_storage_path"))
  .filter((c) => c.arquivo_id.startsWith("corp-pdf:"))
  // Automóvel primeiro: as propostas de auto que vieram dentro do PDF de Fiança ficam como repetidas.
  .sort((a, b) => (a.arquivo_id.includes("auto") ? -1 : 0) - (b.arquivo_id.includes("auto") ? -1 : 0) || a.arquivo_id.localeCompare(b.arquivo_id));

const vistas = new Set();
// --somente-novos: só importa relatórios ainda sem importação; as propostas já
// gravadas entram em `vistas` para não duplicar.
const somenteNovos = process.argv.includes("--somente-novos");
if (somenteNovos) {
  const feitos = new Set((await buscarTudo("base_unica_importacoes", "arquivo_id", (q) => q.eq("layout", "corp_relatorio_propostas"))).map((r) => r.arquivo_id));
  for (let i = pdfs.length - 1; i >= 0; i--) if (feitos.has(pdfs[i].arquivo_id)) pdfs.splice(i, 1);
  for (const r of await buscarTudo("producao_unificada", "produto, origem_corp_numero", (q) => q.eq("fonte", "corp"))) vistas.add(`${r.produto}|${r.origem_corp_numero}`);
  console.log(`somente novos: ${pdfs.length} relatório(s) | ${vistas.size} propostas já no banco`);
}
const resumo = {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "corp-pdf-"));
for (const c of pdfs) {
  const { data, error } = await supabase.storage.from("planilhas-congeladas").download(c.copia_storage_path);
  if (error) throw new Error(`${c.nome}: ${error.message}`);
  const arq = path.join(tmp, "relatorio.pdf");
  fs.writeFileSync(arq, Buffer.from(await data.arrayBuffer()));
  const propostas = lerRelatorio(arq);
  const totais = totaisDoPdf(arq);

  const linhas = [];
  const descartes = {};
  const desc = (m) => (descartes[m] = (descartes[m] || 0) + 1);
  for (const p of propostas) {
    const [produto, ramoPadrao] = produtoDoRamo(p.ramo);
    if (!produto) { desc(`ramo não mapeado: ${p.ramo}`); continue; }
    const chave = `${produto}|${p.numero}`;
    if (vistas.has(chave)) { desc(`proposta já importada por outro relatório (${produto})`); continue; }
    vistas.add(chave);
    const principal = p.produtores.length ? produtorPrincipal(p.produtores) : null;
    linhas.push({
      produto, tipo: "emissao", fonte: "corp",
      origem_arquivo_id: c.arquivo_id, origem_aba: "PROPOSTAS", origem_linha: null, origem_corp_numero: p.numero,
      competencia_arquivo: p.data_proposta?.slice(0, 7) ?? null,
      chave_caso: `corp|${produto}|${p.numero}`,
      data_recebimento: null, data_efetivacao: p.data_proposta,
      status_original: "EFETIVADO NO CORP", status_padrao: "Efetivado",
      ramo_original: p.ramo, ramo_padrao: ramoPadrao,
      seguradora: p.seguradora, plano: p.produto,
      imobiliaria_texto: principal?.produtor ?? null, fonte_vinculo: "corp_produtor",
      premio: p.premio_liquido, comissao: p.comissao_corretora,
      extras: {
        vigencia_inicio: p.vigencia_inicio, vigencia_fim: p.vigencia_fim, parcelas: p.parcelas,
        percentual_comissao: p.percentual_comissao, produtores: p.produtores,
        ...(p.aviso ? { aviso_leitura: p.aviso } : {}),
        ...(/PREMIA/i.test(p.cliente_nome ?? "") ? { premiacao: true } : {}),
      },
    });
  }
  const importado = {
    propostas: linhas.length + (descartes[Object.keys(descartes).find((k) => k.startsWith("proposta já")) ?? ""] ?? 0),
    premio_liquido: Math.round(propostas.reduce((s, p) => s + (p.premio_liquido || 0), 0) * 100) / 100,
    comissao_corretora: Math.round(propostas.reduce((s, p) => s + (p.comissao_corretora || 0), 0) * 100) / 100,
  };
  const confere = totais.propostas === propostas.length && Math.abs(totais.premio_liquido - importado.premio_liquido) < 40 && Math.abs(totais.comissao_corretora - importado.comissao_corretora) < 40;
  console.log(`${c.nome}: ${propostas.length} lidas | ${linhas.length} novas | descartes ${JSON.stringify(descartes)} | confere com o Corp: ${confere ? "sim" : "NÃO"}`);
  for (const l of linhas) {
    const r = (resumo[`${l.produto}|${l.competencia_arquivo?.slice(0, 4)}`] ||= { n: 0, premio: 0, comissao: 0 });
    r.n++; r.premio += l.premio || 0; r.comissao += l.comissao || 0;
  }
  if (!gravar) continue;

  const { data: imp, error: e1 } = await supabase.from("base_unica_importacoes").upsert({
    arquivo_id: c.arquivo_id, arquivo_nome: c.nome, aba: "PROPOSTAS", produto: [...new Set(linhas.map((l) => l.produto))].join(",") || "—",
    layout: "corp_relatorio_propostas", competencia: null, linhas_lidas: propostas.length, linhas_importadas: linhas.length,
    descartes, totais_planilha: totais, totais_importados: { ...importado, propostas: propostas.length }, confere,
    importado_em: new Date().toISOString(),
  }, { onConflict: "arquivo_id,aba" }).select("id").single();
  if (e1) throw new Error("importacoes: " + e1.message);
  // Regravação: apaga o que esta importação gravou antes. Falha aqui PARA tudo
  // (antes um timeout passava em silêncio e a regravação batia em duplicidade).
  const { error: eDel } = await supabase.from("producao_unificada").delete().eq("importacao_id", imp.id);
  if (eDel) throw new Error("apagar importação anterior: " + eDel.message);
  for (let i = 0; i < linhas.length; i += 1000) {
    const { error: e2 } = await supabase.from("producao_unificada").insert(linhas.slice(i, i + 1000).map((l) => ({ ...l, importacao_id: imp.id })));
    if (e2) throw new Error(`producao_unificada (${c.nome}): ${e2.message}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log("\nproduto | ano | propostas | prêmio líquido | comissão");
for (const [k, r] of Object.entries(resumo).sort()) {
  const [p, a] = k.split("|");
  console.log(`${p} | ${a} | ${r.n} | ${Math.round(r.premio).toLocaleString("pt-BR")} | ${Math.round(r.comissao).toLocaleString("pt-BR")}`);
}
if (!gravar) console.log("\n(simulação — nada gravado; use --gravar)");
