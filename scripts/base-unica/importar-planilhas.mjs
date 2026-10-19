// Base Única — Fase 3: importa a produção das CÓPIAS CONGELADAS das planilhas
// para `producao_unificada` (dados pessoais do locatário só no cofre
// `locatarios`). Cada linha da planilha vira uma linha; a herança (análise em
// andamento no último dia do mês, copiada para a planilha do mês seguinte)
// fica ligada pela chave_caso.
//
// uso:
//   node scripts/base-unica/importar-planilhas.mjs "<nome exato do arquivo>" [--gravar]
// Sem --gravar só mostra o que faria (nada é gravado).
import crypto from "node:crypto";
import { supabase } from "./_comum.mjs";
import { listarCopias, abrirCopia, acharCabecalho, norm } from "./_copias.mjs";

const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

// ---------- utilidades ----------
const dig = (v) => String(v ?? "").replace(/\D/g, "");
const txt = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 20);

// Ano vem do nome; se não estiver lá (ex.: "NOVA PLANILHA AGOSTO.xlsm" na pasta 2020), da pasta.
function competenciaDoArquivo(nome, pasta = "") {
  const n = norm(nome);
  const mes = MESES.findIndex((m) => n.includes(m));
  const ano = (n.match(/20\d\d/) || [])[0] || (n.match(/^\d{1,2}\.(\d{2})\b/) ? "20" + n.match(/^\d{1,2}\.(\d{2})\b/)[1] : null)
    || (norm(pasta).match(/20\d\d/) || [])[0];
  return mes >= 0 && ano ? `${ano}-${String(mes + 1).padStart(2, "0")}` : null;
}
function mesAnterior(comp) {
  const [a, m] = comp.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

// Data da planilha: Date (célula de data), número serial do Excel, ou texto
// "d/m/aaaa" / "d/m" (sem ano → ano da competência da linha).
function data(v, compRef) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400e3)).toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  let [, d, mes, a] = m;
  if (!a) a = compRef?.slice(0, 4);
  if (a && a.length === 2) a = "20" + a;
  if (!a || +mes > 12 || +d > 31) return null;
  const iso = `${a}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
  // data que não existe no calendário (ex.: 29/02/2026) → vazia
  const dt = new Date(`${iso}T00:00:00Z`);
  if (isNaN(dt) || dt.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}
function valor(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v).replace(/R\$|\s/g, "");
  if (!/\d/.test(s) || /#/.test(s)) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// ---------- tradução de status (sugestão; o Matheus valida) ----------
// Categorias = as do funil da Fiança no Bitrix (Em análise, Aprovado,
// Recusado, Perdido, Convertido) para o histórico bater com o painel atual.
const SUGESTAO_STATUS_FIANCA = {
  // ainda sem resposta da seguradora / faltando informação
  "ANALISE": "Em análise", "EM ANALISE": "Em análise", "PENDENTE": "Em análise", "PENDENTE INF": "Em análise",
  "AG COTACAO": "Em análise", "AG SEGURADORA": "Em análise", "COTADO COM PENDENCIA": "Em análise",
  // aprovado e em negociação com a imobiliária/locatário
  "PRE-APROVADO": "Aprovado", "PRE APROVADO": "Aprovado", "APROVADO": "Aprovado",
  "LIBERADO P/ NEGOCIAR": "Aprovado", "EM NEGOCIACAO": "Aprovado", "AG CONTRATO": "Aprovado",
  "CONTRATO PENDENCIA": "Aprovado", "CONTRATO COM PENDENCIA": "Aprovado", "CONTRATO RECEBIDO": "Aprovado",
  "DESCONTO SOLICITADO": "Aprovado", "DESCONTO LIBERADO": "Aprovado", "PRE - APROVADO": "Aprovado",
  "CONTATO PENDENTE": "Aprovado", "AG CADASTRO": "Aprovado", // validados pelo Matheus 19/10
  // seguradora recusou
  "RECUSADO": "Recusado", "RECUSA ENVIADA": "Recusado", "COTADO COM RECUSA": "Recusado",
  // aprovado mas não fechou
  "NEGATIVADO": "Perdido", "DESISTENCIA": "Perdido",
  // fechou
  "CONVERTIDO": "Convertido", "CONTRATADO": "Convertido", "EFETIVADO": "Convertido",
  // fases da contratação (validado 19/10): continuam sendo UMA análise convertida;
  // a fase vai em extras.fase_contratacao, nunca soma como análise nova.
  "EMITIDO": "Convertido", "EM EMISSAO": "Convertido",
  "CANCELADO": "Cancelado",
};

// ---------- layout Fiança 2023-2026 (aba ANALISES + aba herdada) ----------
function mapearColunas(colunas) {
  const primeira = (re) => colunas.findIndex((c) => re.test(c));
  const ultima = (re) => colunas.map((c, i) => (re.test(c) ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  return {
    // STATUS (2024→) ou STATUS ANALISE (2020–2024)
    status: primeira(/^STATUS$/) >= 0 ? primeira(/^STATUS$/) : primeira(/^STATUS ANALISE$/), statusConvertido: primeira(/^STATUS CONVERTIDO$/), subStatus: primeira(/^SUB STATUS$/), imob: primeira(/^IMOBILI/), motivo: primeira(/^MOTIVO$/),
    dataReceb: primeira(/^DATA RECEB/), cotador: primeira(/^COTADOR$/), tipoLocacao: primeira(/^TIPO DE LOCACAO$/),
    tipoAnalise: primeira(/^TIPO DE ANALISE$/), locatario: primeira(/^LOCATARIO$/), cpf: primeira(/^CPF/), cidade: primeira(/^CIDADE$/),
    uf: primeira(/^UF$/), origem: primeira(/^ORIGEM$/), plano: primeira(/^PLANO$/), aluguel: primeira(/^ALUGUEL$/),
    pacote: primeira(/^PACOTE LOCACAO$/), statusNegociacao: primeira(/^STATUS DE NEGOCIACAO$/), negociador: primeira(/^NEGOCIADOR$/),
    dataEfetivacao: primeira(/^DATA DE EFETIVACAO$/) >= 0 ? primeira(/^DATA DE EFETIVACAO$/) : primeira(/^DATA EMISSAO$/), proposta: primeira(/^PROPOSTA$/), comissao: ultima(/^COMISSAO$/),
    premioLiquido: ultima(/^PREMIO LIQUIDO$/), responsavel: primeira(/^RESPONSAVEL$/),
  };
}

function lerAbaAnalises(linhas, comp, aba, herdada) {
  // Âncora IMOBILIÁRIA; em JUL/2025 a coluna da imobiliária ficou SEM título,
  // logo depois de "INICIANTE" — aceita esse caso também.
  const cab = acharCabecalho(linhas.map((l) => (l || []).map((x) => (x instanceof Date ? "" : x))), /^(IMOBILI|INICIANTE$)/);
  if (!cab) return { registros: [], descartes: { "aba sem cabeçalho IMOBILIÁRIA": 1 } };
  const k = mapearColunas(cab.colunas);
  if (k.imob < 0) {
    const iIni = cab.colunas.indexOf("INICIANTE");
    if (iIni >= 0 && cab.colunas[iIni + 1] === "") k.imob = iIni + 1;
  }
  const registros = [];
  const descartes = {};
  const desc = (m) => (descartes[m] = (descartes[m] || 0) + 1);
  linhas.slice(cab.indice + 1).forEach((l, i) => {
    const g = (c) => (c >= 0 ? l?.[c] : null);
    const vazia = !(l || []).some((x) => x != null && String(x).trim() !== "");
    if (vazia) return;
    const statusOriginal = norm(g(k.status));
    const cpf = dig(g(k.cpf));
    const imob = txt(g(k.imob));
    if (!statusOriginal && !cpf && !imob) return desc("linha sem status, CPF e imobiliária");
    if (!statusOriginal) return desc("linha sem status");
    if (/^#/.test(imob) || /^#/.test(statusOriginal)) return desc("fórmula quebrada (#REF!/#N/A)");
    const dataReceb = data(g(k.dataReceb), comp);
    const sub = norm(g(k.subStatus));
    const statusPadrao = SUGESTAO_STATUS_FIANCA[statusOriginal] ?? null;
    // A partir de 2026 a herança deixou de ter aba própria: as análises em
    // andamento do mês anterior foram copiadas DENTRO da aba ANALISES do mês.
    // Linha recebida em mês anterior ao do arquivo = herdada (origem = mês do
    // recebimento). Antes de 2026 a herança tinha aba própria e o total da
    // planilha incluía as linhas de virada de mês — não se aplica.
    const herdadaNaAba = !herdada && comp >= "2026-01" && dataReceb && dataReceb.slice(0, 7) < comp;
    registros.push({
      linhaPlanilha: cab.indice + 2 + i,
      cpf, nome: txt(g(k.locatario)),
      linha: {
        produto: "fianca", tipo: "novo", fonte: "planilha", origem_aba: aba, origem_linha: cab.indice + 2 + i,
        competencia_arquivo: herdadaNaAba ? dataReceb.slice(0, 7) : comp, herdada: herdada || !!herdadaNaAba,
        chave_caso: cpf ? hash(`fianca|${cpf}|${dataReceb ?? ""}`) : hash(`fianca|${norm(imob)}|${dataReceb ?? ""}|${norm(g(k.locatario))}`),
        data_recebimento: dataReceb, data_efetivacao: data(g(k.dataEfetivacao), comp),
        status_original: statusOriginal, status_padrao: statusPadrao,
        seguradora: statusPadrao === "Convertido" && sub && !/^AG /.test(sub) ? sub : null,
        plano: txt(g(k.plano)) || null,
        imobiliaria_texto: imob || null, fonte_vinculo: "planilha_fianca",
        responsavel: txt(g(k.cotador)) || null,
        // Nesta época a coluna COMISSAO é o PERCENTUAL (ex.: 10, 30), não R$ — fica em
        // extras.comissao_percentual; comissão em R$ só quando a fonte trouxer o valor.
        aluguel: valor(g(k.aluguel)), premio: valor(g(k.premioLiquido)), comissao: null,
        extras: Object.fromEntries(Object.entries({
          sub_status: sub, status_convertido: norm(g(k.statusConvertido)),
          fase_contratacao: statusPadrao !== "Convertido" ? null
            : norm(g(k.statusConvertido)) === "EMITIDO" || statusOriginal === "EMITIDO" ? "emitido"
            : norm(g(k.statusConvertido)) === "EM EMISSAO" || statusOriginal === "EM EMISSAO" ? "em emissão"
            : ["CONTRATADO", "EFETIVADO"].includes(statusOriginal) ? "contratado" : "convertido",
          motivo: norm(g(k.motivo)), tipo_locacao: norm(g(k.tipoLocacao)), tipo_analise: norm(g(k.tipoAnalise)),
          pacote_locacao: valor(g(k.pacote)), comissao_percentual: valor(g(k.comissao)), status_negociacao: txt(g(k.statusNegociacao)), negociador: txt(g(k.negociador)),
          proposta: txt(g(k.proposta)), origem: txt(g(k.origem)), cidade: txt(g(k.cidade)), uf: txt(g(k.uf)),
        }).filter(([, v]) => v != null && v !== "")),
      },
    });
  });
  return { registros, descartes };
}

// Totais da aba CONTAGEM (bloco da esquerda = mês; coluna "PEND" = herdadas).
// Em 2026 a aba começa com uma "CONSULTA POR IMOBILIÁRIA" (filtrada) e o total
// geral fica no bloco "TOTALIZADOR" mais abaixo — lê só esse bloco.
function lerContagem(linhas) {
  const mes = {}, pend = {};
  const iTot = linhas.findIndex((l, i) => i > 0 && norm(l?.[0]) === "TOTALIZADOR");
  if (iTot > 0) {
    for (const l of linhas.slice(iTot + 1, iTot + 15)) {
      const r0 = norm(l?.[0]), v1 = l?.[1];
      if (r0 && typeof v1 === "number" && !(r0 in mes)) mes[r0] = v1;
    }
    mes["TOTAL GERAL"] = ["ANALISE", "PENDENTE", "PRE-APROVADO", "APROVADO", "RECUSADO", "NEGATIVADO", "CONVERTIDO"].reduce((s, k) => s + (mes[k] || 0), 0);
    return { mes, pend };
  }
  for (const l of linhas.slice(0, 20)) {
    const r0 = norm(l?.[0]), v1 = l?.[1];
    if (r0 && typeof v1 === "number") mes[r0] = v1;
    const r6 = norm(l?.[6]), v7 = l?.[7];
    if (r6 && typeof v7 === "number") pend[r6] = v7;
  }
  return { mes, pend };
}

// 2020–2023: aba RELATÓRIOS — linha de títulos (TOTAL | NOVA | EM ANÁLISE | … |
// CONVERTIDO | RECUSADO | NEGATIVADO) com os números na linha de baixo.
function lerRelatorios(linhas) {
  for (let i = 0; i < Math.min(linhas.length - 1, 40); i++) {
    const t = (linhas[i] || []).map(norm);
    if (t[0] !== "TOTAL" || !t.includes("NEGATIVADO")) continue;
    const mes = {};
    t.forEach((h, j) => { const v = linhas[i + 1]?.[j]; if (h && typeof v === "number") mes[h === "TOTAL" ? "TOTAL GERAL" : h] = v; });
    return { mes, pend: {} };
  }
  return null;
}

// ---------- execução ----------
const [nomeArquivo, flag] = process.argv.slice(2);
const gravar = flag === "--gravar";
const copia = (await listarCopias()).find((c) => c.nome === nomeArquivo);
if (!copia) throw new Error(`arquivo não encontrado entre as cópias congeladas: ${nomeArquivo}`);
const comp = competenciaDoArquivo(copia.nome, copia.pasta);
if (!comp) throw new Error("não consegui identificar o mês do arquivo: " + copia.nome);
const abas = await abrirCopia(copia, { bruto: true });

const resultado = [];
for (const [aba, linhas] of abas) {
  const a = norm(aba);
  let herdada = null, compAba = null;
  // aba principal: ANALISES (set/2023→) ou PROCESSO (2020–jul/2023)
  if (a === "ANALISES" || a === "PROCESSO") { herdada = false; compAba = comp; }
  else if (MESES.includes(a) && MESES.indexOf(a) + 1 !== Number(comp.slice(5))) { herdada = true; compAba = mesAnterior(comp); }
  else continue;
  const { registros, descartes } = lerAbaAnalises(linhas, compAba, aba, herdada);
  resultado.push({ aba, herdada, compAba, registros, descartes });
}
const contagem = (() => {
  const c = abas.find(([n]) => norm(n) === "CONTAGEM");
  if (c) return lerContagem(c[1]);
  const r = abas.find(([n]) => norm(n) === "RELATORIOS");
  return r ? lerRelatorios(r[1]) : null;
})();

// Relatório
for (const r of resultado) {
  const porStatus = {};
  for (const x of r.registros) porStatus[x.linha.status_original] = (porStatus[x.linha.status_original] || 0) + 1;
  console.log(`\n== aba "${r.aba}" (${r.herdada ? "herdada de " + r.compAba : "mês " + r.compAba}): ${r.registros.length} linhas importáveis`);
  console.log("   por status:", JSON.stringify(porStatus));
  console.log("   descartadas:", JSON.stringify(r.descartes));
  const herdNaAba = r.registros.filter((x) => x.linha.herdada && !r.herdada).length;
  if (herdNaAba) console.log(`   herdadas dentro da aba: ${herdNaAba} | do mês: ${r.registros.length - herdNaAba}`);
}
if (contagem) console.log("\nCONTAGEM da planilha — mês:", JSON.stringify(contagem.mes), "\nCONTAGEM — herdadas (PEND):", JSON.stringify(contagem.pend));

// Herança: casos da aba herdada que existem na planilha do mês anterior?
const principal = resultado.find((r) => !r.herdada), herd = resultado.find((r) => r.herdada);
if (herd) {
  const anterior = (await listarCopias()).find((c) => competenciaDoArquivo(c.nome, c.pasta) === herd.compAba && /PLANILHA/.test(norm(c.nome)) && !/^COPIA/.test(norm(c.nome)));
  if (anterior) {
    const abasAnt = await abrirCopia(anterior, { bruto: true });
    const ab = abasAnt.find(([n]) => norm(n) === "ANALISES");
    const regsAnt = ab ? lerAbaAnalises(ab[1], herd.compAba, ab[0], false).registros : [];
    const chavesAnt = new Set(regsAnt.map((x) => x.linha.chave_caso));
    const achados = herd.registros.filter((x) => chavesAnt.has(x.linha.chave_caso)).length;
    const naoAchados = herd.registros.filter((x) => !chavesAnt.has(x.linha.chave_caso));
    console.log(`\nHerança: ${achados}/${herd.registros.length} casos herdados encontrados na planilha de ${herd.compAba} ("${anterior.nome}")`);
    for (const x of naoAchados.slice(0, 10)) console.log("   não achado: linha", x.linhaPlanilha, "| receb", x.linha.data_recebimento, "| imob", x.linha.imobiliaria_texto, "| cpf?", x.cpf ? "sim" : "não");
    const chavesHerd = new Set(herd.registros.map((x) => x.linha.chave_caso));
    const repetidosNoMes = principal ? principal.registros.filter((x) => chavesHerd.has(x.linha.chave_caso)).length : 0;
    console.log(`   casos que aparecem ao mesmo tempo na aba do mês e na herdada: ${repetidosNoMes}`);
  }
}

if (!gravar) { console.log("\n(simulação — nada gravado; use --gravar)"); process.exit(0); }

// ---------- gravação ----------
// 1) cofre de locatários (CPF, nome) → id
const porCpf = new Map();
for (const r of resultado) for (const x of r.registros) if (x.cpf) porCpf.set(x.cpf, x.nome || porCpf.get(x.cpf) || null);
const cpfs = [...porCpf.keys()];
const idPorCpf = new Map();
for (let i = 0; i < cpfs.length; i += 500) {
  const lote = cpfs.slice(i, i + 500);
  const { data: existentes } = await supabase.from("locatarios").select("id, cpf, nome").in("cpf", lote);
  for (const e of existentes ?? []) idPorCpf.set(e.cpf, e.id);
  const novos = lote.filter((c) => !idPorCpf.has(c)).map((c) => ({ cpf: c, nome: porCpf.get(c), primeira_fonte: `planilha_fianca:${copia.arquivo_id}` }));
  if (novos.length) {
    const { data: ins, error } = await supabase.from("locatarios").insert(novos).select("id, cpf");
    if (error) throw new Error("locatarios: " + error.message);
    for (const e of ins) idPorCpf.set(e.cpf, e.id);
  }
}
// 2) importação + linhas (re-rodável: apaga e regrava a mesma aba)
for (const r of resultado) {
  const totaisImportados = {};
  for (const x of r.registros) totaisImportados[x.linha.status_original] = (totaisImportados[x.linha.status_original] || 0) + 1;
  const totaisPlanilha = contagem ? (r.herdada ? contagem.pend : contagem.mes) : {};
  const { data: imp, error } = await supabase.from("base_unica_importacoes").upsert({
    arquivo_id: copia.arquivo_id, arquivo_nome: copia.nome, aba: r.aba, produto: "fianca", layout: "fianca_2023",
    competencia: r.compAba, linhas_lidas: r.registros.length + Object.values(r.descartes).reduce((a, b) => a + b, 0),
    linhas_importadas: r.registros.length, descartes: r.descartes, totais_planilha: totaisPlanilha, totais_importados: totaisImportados,
    importado_em: new Date().toISOString(),
  }, { onConflict: "arquivo_id,aba" }).select("id").single();
  if (error) throw new Error("importacoes: " + error.message);
  await supabase.from("producao_unificada").delete().eq("importacao_id", imp.id);
  const linhas = r.registros.map((x) => ({ ...x.linha, importacao_id: imp.id, origem_arquivo_id: copia.arquivo_id, locatario_id: x.cpf ? idPorCpf.get(x.cpf) : null }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error: e2 } = await supabase.from("producao_unificada").insert(linhas.slice(i, i + 500));
    if (e2) throw new Error("producao_unificada: " + e2.message);
  }
  console.log(`gravado: aba ${r.aba} → ${linhas.length} linhas`);
}
// 3) tabela de tradução de status (só acrescenta; nunca mexe no que já foi validado)
const vistos = {};
for (const r of resultado) for (const x of r.registros) vistos[x.linha.status_original] = (vistos[x.linha.status_original] || 0) + 1;
for (const [v, n] of Object.entries(vistos)) {
  const { data: ex } = await supabase.from("base_unica_traducao_status").select("ocorrencias, validado").eq("produto", "fianca").eq("tipo", "novo").eq("valor_original", v).maybeSingle();
  if (ex) await supabase.from("base_unica_traducao_status").update({ ocorrencias: ex.ocorrencias + n }).eq("produto", "fianca").eq("tipo", "novo").eq("valor_original", v);
  else await supabase.from("base_unica_traducao_status").insert({ produto: "fianca", tipo: "novo", valor_original: v, status_padrao: SUGESTAO_STATUS_FIANCA[v] ?? null, regra_origem: "sugestao", ocorrencias: n });
}
console.log("tradução de status atualizada.");
