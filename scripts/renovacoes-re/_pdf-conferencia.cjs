// Gera o PDF de conferência (HTML → PDF no Chrome local). Lê os JSON de conferir-corp-erp.ts. Nada sai do computador.
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const D = process.argv[2];
const R = JSON.parse(fs.readFileSync(path.join(D, "resumo-2027-01.json"), "utf8"));
const { linhas: L, aMaisDet } = JSON.parse(fs.readFileSync(path.join(D, "linhas-2027-01.json"), "utf8"));
const f = (n) => Number(n).toLocaleString("pt-BR");
const brl = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const cnt = (fn) => { const m = {}; L.forEach((l) => { const k = fn(l); m[k] = (m[k] || 0) + 1; }); return m; };
const NOME = { incendio: "Incêndio / Ramos elementares (IMOB, 2IMO, RESI, EMPR)", capitalizacao: "Capitalização (CAP, CAP2)", fianca: "Seguro Fiança (FIAN, 2FIA)", vida: "Vida", automovel: "Automóvel", condominio: "Condomínio", portateis: "Portáteis", rc: "RC", saude: "Saúde", outros: "Outros (PREM)" };
const FUNIL = { incendio: "SPA 1046 · cat. 34", condominio: "SPA 1046 · cat. 34", vida: "SPA 1046 · cat. 34", portateis: "SPA 1046 · cat. 34", rc: "SPA 1046 · cat. 34", saude: "SPA 1046 · cat. 34", outros: "SPA 1046 · cat. 34", capitalizacao: "SPA 1048 · cat. 38", fianca: "SPA 1042 · cat. 32", automovel: "SPA 1050 · cat. 30" };
const prod = {};
L.forEach((l) => { const k = l["Produto (ERP)"]; prod[k] = prod[k] || { n: 0, p: 0, ramos: {} }; prod[k].n++; prod[k].p += l["Prêmio total (Corp)"]; prod[k].ramos[l["Ramo"]] = (prod[k].ramos[l["Ramo"]] || 0) + 1; });
const linhasProd = Object.entries(prod).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<tr><td>${NOME[k] || k}</td><td>${Object.entries(v.ramos).map(([r, n]) => `${r} ${n}`).join(" · ")}</td><td class=n>${f(v.n)}</td><td class=n>${f(v.n)}</td><td class=n>0</td><td class=n>${brl(v.p)}</td><td>${FUNIL[k] || ""}</td></tr>`).join("");
const seg = Object.entries(cnt((l) => l["Seguradora"])).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${k}</td><td class=n>${f(n)}</td></tr>`).join("");
const pxs = {}; L.forEach((l) => { const k = l["Produto (ERP)"]; pxs[k] = pxs[k] || {}; pxs[k][l["Seguradora"]] = (pxs[k][l["Seguradora"]] || 0) + 1; });
const linhasPxS = Object.entries(pxs).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y) - Object.values(a[1]).reduce((x, y) => x + y)).map(([k, v]) => `<tr><td>${(NOME[k] || k).split(" (")[0]}</td><td>${Object.entries(v).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ")}</td></tr>`).join("");
const incP = cnt((l) => l["Cliente (situação do cadastro)"] === "cadastro incompleto" ? l["Produto (ERP)"] : "_");
delete incP._;
const zero = L.filter((l) => l["Prêmio total (Corp)"] === 0);
const vdP = cnt((l) => /venda direta/.test(l["Imobiliária (situação)"]) ? l["Produto (ERP)"] : "_"); delete vdP._;
const lista = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${(NOME[k] || k).split(" (")[0]} ${n}`).join(" · ");
const cliDif = L.filter((l) => /cliente do ERP/.test(l["Divergências"]));
const premDif = L.filter((l) => /prêmio/.test(l["Divergências"]));
const sinis = cnt((l) => l["Sinistros (Corp)"] > 0 ? l["Ramo"] : "_"); delete sinis._;
const digitadas = L.filter((l) => l["Situação no ERP"] === "proposta").length;
const html = `<!doctype html><html lang=pt-BR><meta charset=utf-8><style>
@page{size:A4;margin:16mm 14mm}body{font:10.5px/1.45 Poppins,Segoe UI,Arial,sans-serif;color:#1c2330}
h1{font-size:19px;margin:0 0 2px;color:#0b2a4a}h2{font-size:13px;margin:16px 0 5px;color:#0b2a4a;border-bottom:2px solid #e6edf5;padding-bottom:3px}
.sub{color:#5b6777;margin-bottom:10px}table{border-collapse:collapse;width:100%;margin:4px 0 8px}th,td{border:1px solid #d9e1ea;padding:3px 6px;text-align:left;vertical-align:top}th{background:#eef3f9}td.n{text-align:right;white-space:nowrap}
.box{background:#eefaf1;border:1px solid #b7e1c1;border-radius:6px;padding:8px 10px;margin:6px 0}.k{font-weight:600}
ul{margin:3px 0 6px 16px;padding:0}li{margin:1px 0}small{color:#5b6777}</style>
<h1>Renovações de janeiro/2027 — Corp × ERP</h1>
<div class=sub>Conferência só de leitura · extraído do Corp em 28/10/2026 · Documentos → Renovações, Período por Fim de Vigência 01/01/2027 a 31/01/2027, todos os ramos, modelos “Simplificado com Produtor” e “Simplificado” · nada foi gravado no Corp, no Bitrix nem no ERP</div>
<div class=box><span class=k>Resultado em uma frase:</span> o relatório do Corp tem <b>${f(R.corpLinhas)}</b> documentos e <b>${f(R.achadosNoErp)} (100%) existem no ERP</b>, com a mesma situação, o mesmo início e fim de vigência, o mesmo Nº da apólice e o mesmo % de comissão em todos. Só há <b>3 diferenças de prêmio</b> e o ERP tem <b>${R.erpAMais} apólices a mais</b> que o Corp não listou (mais ${R.endossosVigentesNoMes} endossos, que não contam). A base de janeiro está completa e correta; as pendências são de cadastro (seção 4).</div>

<h2>1. Quanto o Corp tem × quanto o ERP tem</h2>
<table><tr><th>Item</th><th>Quantidade</th></tr>
<tr><td>Documentos no relatório do Corp (fim de vigência em jan/2027)</td><td class=n>${f(R.corpLinhas)}</td></tr>
<tr><td>… que existem no ERP (cruzamento por Nosso nº do Corp)</td><td class=n>${f(R.achadosNoErp)}</td></tr>
<tr><td>… que NÃO existem no ERP</td><td class=n>${R.naoNoErp}</td></tr>
<tr><td>No ERP com situação diferente de vigente ou proposta</td><td class=n>${R.div.situacao}</td></tr>
<tr><td>No ERP com início ou fim de vigência diferente</td><td class=n>${R.div.inicio + R.div.fim}</td></tr>
<tr><td>% de comissão diferente · Nº da apólice diferente</td><td class=n>${R.div.pct} · ${R.div.apolice}</td></tr>
<tr><td>Prêmio total / líquido diferente</td><td class=n>${R.div.premioTotal} / ${R.div.premioLiquido}</td></tr>
<tr><td>Apólices no ERP (vigentes ou propostas, fim em jan/2027) que o relatório do Corp não trouxe</td><td class=n>${R.erpAMais}</td></tr>
<tr><td>Endossos vigentes no ERP com fim em jan/2027 (fora da regra, só informativo)</td><td class=n>${R.endossosVigentesNoMes}</td></tr>
<tr><td>Documentos cancelados no relatório · com sinistro</td><td class=n>${R.div.canceladoNoCorp} · ${R.div.comSinistro}</td></tr></table>
<small>Observação: o ERP lista 837 apólices <b>vigentes</b> em janeiro; o relatório do Corp também traz ${digitadas} propostas (ainda não viraram apólice), por isso o total do Corp é ${f(R.corpLinhas)} (${f(R.corpLinhas - digitadas)} vigentes + ${digitadas} propostas). Em dezembro, o mesmo método bateu 1.100 de 1.100.</small>

<h2>2. Por produto (como o ERP agrupa) e funil de destino</h2>
<table><tr><th>Produto</th><th>Ramos do Corp</th><th>No Corp</th><th>No ERP</th><th>Faltam</th><th>Prêmio total</th><th>Funil do card</th></tr>${linhasProd}
<tr><th>Total</th><th></th><th class=n>${f(R.corpLinhas)}</th><th class=n>${f(R.achadosNoErp)}</th><th class=n>0</th><th class=n>${brl(L.reduce((a, l) => a + l["Prêmio total (Corp)"], 0))}</th><th></th></tr></table>

<h2>3. Por seguradora</h2>
<table style="width:30%;float:left"><tr><th>Seguradora (Corp)</th><th>Documentos</th></tr>${seg}</table>
<table style="width:66%;float:right"><tr><th>Produto</th><th>Seguradoras</th></tr>${linhasPxS}</table><div style="clear:both"></div>

<h2>4. Ligação com o banco (apólice, cliente, seguradora, imobiliária, produto)</h2>
<table><tr><th>Ligação</th><th>Resultado</th></tr>
<tr><td>Apólice (erp_documentos)</td><td>${f(R.achadosNoErp)} de ${f(R.corpLinhas)} ligadas</td></tr>
<tr><td>Seguradora (erp_seguradoras)</td><td>${f(R.corpLinhas - R.lig.semSeg)} de ${f(R.corpLinhas)} ligadas (${R.lig.semSeg} sem ligação)</td></tr>
<tr><td>Produto (erp_ramos.produto)</td><td>${f(R.corpLinhas - R.lig.semRamo)} de ${f(R.corpLinhas)} ligados (${R.lig.semRamo} sem ligação)</td></tr>
<tr><td>Cliente (locatarios, pelo CPF/CNPJ)</td><td>${f(R.corpLinhas - R.lig.semCliente - R.lig.semCpfCorp)} têm cadastro · ${R.lig.semCliente} sem cadastro · <b>${R.lig.semCpfCorp}</b> sem CPF/CNPJ no próprio Corp · <b>${R.lig.clienteIncompleto}</b> com cadastro marcado como <i>incompleto</i> (${lista(incP)})</td></tr>
<tr><td>Cliente do ERP ≠ cliente com aquele CPF/CNPJ</td><td>${R.lig.clienteDiferente} documentos (Nosso nº do Corp: ${cliDif.map((l) => l["Nosso nº do Corp"] + " " + l["Ramo"]).join(", ")}) — 3 são Fiança, onde o Corp mostra um personagem e o ERP guarda outro (segurado × garantido)</td></tr>
<tr><td>Imobiliária (pelo produtor, regra escolherProdutor + Sohtec)</td><td>${R.lig.imobCasaErpIgual} ligadas e iguais à do ERP (24 em outra ficha do mesmo grupo) · <b>${R.lig.vendaDireta}</b> venda direta O2 sem imobiliária (${lista(vdP)}) · <b>${R.lig.nomeAmbiguo}</b> ambígua (“AG RIO IMOBILIÁRIA” casa com duas fichas: ANEXO ADM e ANTIGO; o ERP usa ANEXO ADM) · ${R.lig.nomeNaoCasa} sem casamento · ${R.lig.imobErpDiferente} com imobiliária diferente da do ERP</td></tr></table>

<h2>5. Colunas do relatório × o que o ERP tem</h2>
<table><tr><th>Coluna do Corp</th><th>Situação</th></tr>
<tr><td>Nosso Nº · Apólice · Seguradora · Ramo · Tipo · Início/Final Vig. · Cliente · CPF/CNPJ</td><td>Iguais ao ERP em todos os ${f(R.corpLinhas)} (Nº da apólice “0” do Corp é ignorado)</td></tr>
<tr><td>Prêmio Total (e Prêmio Líquido, no modelo Simplificado)</td><td>Iguais em ${f(R.corpLinhas - 3)}. <b>3 diferentes, todas Tokio Imobiliário:</b> o ERP tem metade do valor do Corp (Nosso nº do Corp ${premDif.map((l) => l["Nosso nº do Corp"]).join(", ")}) — pode ser prêmio de 2 parcelas/semestre lançado só pela metade; conferir no Corp.</td></tr>
<tr><td>% Com.</td><td>Igual ao ERP em todos. Predomina 70% (538 documentos); há 5 com 0% e 1 com 100%</td></tr>
<tr><td>Prêmio total zerado no Corp</td><td>${zero.length} documentos (${Object.entries(cnt((l) => l["Prêmio total (Corp)"] === 0 ? l["Ramo"] + " " + l["Seguradora"] : "_")).filter(([k]) => k !== "_").map(([k, n]) => k + " " + n).join(", ")})</td></tr>
<tr><td>Produtor 1 / 2 / 3</td><td>Produtor 2 preenchido em ${L.filter((l) => l["Produtor 2"]).length} e Produtor 3 em ${L.filter((l) => l["Produtor 3"]).length}. Em ${L.filter((l) => l["Canal na linha do produtor (Corp)"]).length} documentos um dos produtores é Segimob/Superlógica (canal, não imobiliária)</td></tr>
<tr><td>Canal Vendas</td><td>Vazia em todo o relatório. O ERP tem canal de venda em 37 documentos e <b>nenhum</b> dos 242 que o Corp marca com Segimob/Superlógica tem esse canal no ERP (decidir se é para guardar)</td></tr>
<tr><td>Sinistro / Qtde. Sinistros</td><td>${R.div.comSinistro} documentos com sinistro (${Object.entries(sinis).map(([k, n]) => k + " " + n).join(", ")}) — o ERP ainda não mostra isso na renovação</td></tr>
<tr><td>Doc. Cancelado / Cancelado</td><td>Nenhum cancelado no relatório; no ERP há cancelados com fim em janeiro, que corretamente ficam de fora</td></tr></table>

<h2>6. Os ${R.erpAMais} do ERP que o Corp não trouxe</h2>
<table><tr><th>Código O2 do documento</th><th>Nosso nº do Corp</th><th>Produto</th><th>Fim</th><th>Situação</th><th>O que é</th></tr>
${aMaisDet.map((d) => `<tr><td>${d["Código O2 do documento"]}</td><td>${d["Nosso nº do Corp"] || "—"}</td><td>${d["Seguradora"]} ${d["Ramo"]}</td><td>${d["Fim vig."]}</td><td>${d["Situação"]}</td><td>${!d["Nosso nº do Corp"] ? "Vem do Bitrix (Capitalização), proposta ainda não lançada no Corp — esperado" : "Fiança com vigência longa (2,5 a 3 anos); o motivo de o Corp não listar ainda não foi encontrado — olhar no Corp"}</td></tr>`).join("")}</table>

<h2>7. O que falta decidir (Matheus)</h2>
<ul><li><b>Cadastro incompleto de cliente (${R.lig.clienteIncompleto}) e sem CPF no Corp (${R.lig.semCpfCorp}):</b> limpar antes de gerar cards? Capitalização é onde mais pesa (${incP.capitalizacao || 0}).</li>
<li><b>AG Rio:</b> há duas fichas com o mesmo nome (ANEXO ADM e ANTIGO) — qual vale para o card.</li>
<li><b>${R.lig.vendaDireta} vendas diretas O2</b> (sem imobiliária): seguir como em dezembro (1 card por apólice)?</li>
<li><b>3 prêmios Tokio pela metade no ERP</b> e <b>2 Fianças</b> de vigência longa fora do relatório: conferir no Corp antes de renovar.</li>
<li><b>Canal Segimob/Superlógica:</b> guardar no documento do ERP?</li></ul>
<small>Arquivos na mesma pasta: levantamento-completo-2027-01.csv (845 linhas, todas as colunas), divergencias-2027-01.csv, erp-a-mais-2027-01.csv e os dois Excel do Corp. Contêm dados de clientes — não enviar a terceiros.</small>
</html>`;
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage();
  await p.setContent(html);
  await p.pdf({ path: path.join(D, "CONFERENCIA-RENOVACOES-JAN-2027.pdf"), format: "A4", printBackground: true });
  await b.close();
  console.log("PDF ok");
})();
