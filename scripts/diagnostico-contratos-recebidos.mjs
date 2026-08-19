// Diagnóstico pontual: por que "Contratos recebidos por dia" (evento =
// primeira entrada na etapa Contrato Recebido) não bate com a soma manual
// de Contrato Recebido + Contrato com Pendências + Efetivados (estado
// ATUAL dos cards). Roda direto contra o Bitrix, sem depender do Next.
//
// Uso: node scripts/diagnostico-contratos-recebidos.mjs [YYYY-MM]
// (competência default = mês atual)

import { readFileSync } from "node:fs";

const envFile = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const linha of envFile.split(/\r?\n/)) {
  const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

if (!process.env.BITRIX_WEBHOOK_URL) throw new Error("BITRIX_WEBHOOK_URL não encontrada em .env.local");
const WEBHOOK = process.env.BITRIX_WEBHOOK_URL.replace(/\/$/, "");
const ENTITY_TYPE_ID = 1042;
const ETAPA_CONTRATO_RECEBIDO = "DT1042_20:UC_RD3MTL";
const NOME_ETAPA = {
  "DT1042_20:NEW": "Liberado para Negociar",
  "DT1042_20:UC_XWVPIX": "Contato Pendente",
  "DT1042_20:PREPARATION": "Em Negociação",
  "DT1042_20:CLIENT": "Tratativa de Desconto",
  "DT1042_20:UC_ALTIBE": "Aguardando Contrato",
  "DT1042_20:UC_RD3MTL": "Contrato Recebido",
  "DT1042_20:UC_AHCJI2": "Contrato com Pendências",
  "DT1042_20:SUCCESS": "SUCESSO (Convertido)",
  "DT1042_20:FAIL": "PERDIDO",
};

async function chamar(metodo, params = {}) {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (Array.isArray(valor)) for (const v of valor) busca.append(`${chave}[]`, String(v));
    else busca.append(chave, String(valor));
  }
  const url = `${WEBHOOK}/${metodo}${busca.toString() ? `?${busca}` : ""}`;
  const resposta = await fetch(url);
  const dados = await resposta.json();
  if (dados.error) throw new Error(`${metodo}: ${dados.error_description || dados.error}`);
  return dados;
}

async function buscarTudo(metodo, paramsBase) {
  const itens = [];
  let start = 0;
  for (;;) {
    const pagina = await chamar(metodo, { ...paramsBase, start });
    itens.push(...pagina.result.items);
    if (pagina.next === undefined) break;
    start = pagina.next;
  }
  return itens;
}

const competencia = process.argv[2] || new Date().toISOString().slice(0, 7);
console.log(`Competência: ${competencia}\n`);

const [items, historico] = await Promise.all([
  buscarTudo("crm.item.list", { entityTypeId: ENTITY_TYPE_ID, select: ["id", "stageId", "categoryId", "createdTime", "title"] }),
  buscarTudo("crm.stagehistory.list", { entityTypeId: ENTITY_TYPE_ID, "order[id]": "asc" }),
]);

const itemPorId = new Map(items.map((it) => [String(it.id), it]));

const historicoPorCard = new Map();
for (const h of historico) {
  const lista = historicoPorCard.get(h.OWNER_ID) ?? [];
  lista.push(h);
  historicoPorCard.set(h.OWNER_ID, lista);
}

// Primeira entrada em "Contrato Recebido" por card, igual à lógica do
// painel (montarAnaliseGerencial).
const primeiraEntrada = new Map();
const historicoOrdenado = [...historico].sort((a, b) => new Date(a.CREATED_TIME) - new Date(b.CREATED_TIME));
for (const h of historicoOrdenado) {
  if (h.STAGE_ID !== ETAPA_CONTRATO_RECEBIDO) continue;
  if (primeiraEntrada.has(h.OWNER_ID)) continue;
  primeiraEntrada.set(h.OWNER_ID, h.CREATED_TIME.slice(0, 10));
}

const idsEsteMes = [...primeiraEntrada.entries()].filter(([, dia]) => dia.startsWith(competencia)).map(([id]) => id);
console.log(`Cards que entraram em "Contrato Recebido" nesta competência: ${idsEsteMes.length}\n`);

const porEstadoAtual = {};
const detalhes = [];
for (const id of idsEsteMes) {
  const item = itemPorId.get(String(id));
  if (!item) {
    porEstadoAtual["(card não encontrado / excluído)"] = (porEstadoAtual["(card não encontrado / excluído)"] ?? 0) + 1;
    detalhes.push({ id, titulo: "?", estadoAtual: "(card não encontrado / excluído)" });
    continue;
  }
  const nomeEtapa = NOME_ETAPA[item.stageId] ?? item.stageId;
  porEstadoAtual[nomeEtapa] = (porEstadoAtual[nomeEtapa] ?? 0) + 1;
  detalhes.push({ id, titulo: item.title, estadoAtual: nomeEtapa });
}

console.log("Distribuição do estado ATUAL desses cards:");
for (const [estado, n] of Object.entries(porEstadoAtual).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${estado}`);
}

console.log("\nDetalhe card a card:");
for (const d of detalhes) console.log(`  #${d.id}  ${d.titulo}  →  ${d.estadoAtual}`);
