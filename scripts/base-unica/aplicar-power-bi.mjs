// Base Única × Power BI — aplica o "Cadastro de Produtores" do Power BI
// (corp_regra_produtor) na base única de imobiliárias. Decisão do Matheus em
// 21/10/2026: "O POWER BI SEMPRE VALE" — quando o PBI discordar de vínculo ou
// grupo confirmado no Workspace, o PBI substitui; o anterior fica em
// imobiliaria_historico. Aprovado depois de ver o impacto (3 conflitos:
// Giullia → grupo Teruszkin; Ribas-HP/Pintas/HC separados; MARTINELLI (BASE)
// → produção própria da O2) e a criação das fichas que faltam.
//
// O que faz (re-rodável; sem --gravar só simula e lista):
//  1. Liga cada produtor do PBI ao registro do Corp (fonte corp_produtor), pelo
//     nome (sem espaços nas pontas) ou, se o nome mudou, pelo código Corp.
//  2. Produtor que entra na base (ENTRA / TRATAR N1 / TRATAR N2) sem ficha
//     confirmada: liga à ficha de mesmo nome (sugestão "nome igual") ou cria
//     uma ficha nova (cadastro incompleto), com os dados do cadastro do Corp.
//  3. Centralizador do PBI = grupo. Com 2+ fichas no mesmo centralizador, todas
//     entram no grupo (o existente, se as fichas já estavam nele; senão um
//     novo, tipo rede de filiais). Ficha cujo nome é o próprio centralizador =
//     matriz. Ficha que o PBI coloca sozinha sai do grupo em que estava.
//  4. Centralizador "O2 SEGUROS" = produção própria da O2 (Venda direta O2):
//     o produtor entra em base_unica_produtores_venda_direta e perde o vínculo
//     com ficha de imobiliária.
//  5. Origem, tipo de pessoa e centralizador do PBI vão para a ficha.
// uso: node scripts/base-unica/aplicar-power-bi.mjs [--gravar]
import { supabase, buscarTudo, textoBase } from "./_comum.mjs";

const gravar = process.argv.includes("--gravar");
const HOJE = "21/10/2026";
const ENTRA = new Set(["ENTRA", "TRATAR N1", "TRATAR N2"]);
const CENTRAL_O2 = "O2 SEGUROS";
// Grupos que o Matheus viu e aprovou desfazer (21/10). Outro grupo que o PBI
// separe fica como está e é listado como pendente de decisão.
const GRUPOS_DESFAZER_APROVADOS = new Set(["Ribas-HP / Pintas / HC Consultoria"]);
const t = (s) => String(s ?? "").trim();
const k = (s) => textoBase(t(s)).replace(/\s+/g, " ");

// Histórico gravado na hora de cada mudança (se a gravação parar no meio, o
// que já mudou está registrado).
let alteracoes = 0;
async function log(campo, ids, antes, depois, motivo) {
  if (!gravar) return;
  const { error } = await supabase.from("imobiliaria_historico").insert({ campo, ...ids, antes, depois, motivo, origem: "power_bi" });
  if (error) throw new Error("histórico: " + error.message);
  alteracoes++;
}

const [regras, registros, fichas, grupos, grade] = await Promise.all([
  buscarTudo("corp_regra_produtor", "produtor, centralizador, origem, tipo_pessoa, entra_base_com_corretora", (q) => q.order("produtor")),
  buscarTudo("imobiliaria_registros_fonte", "id, chave_externa, nome_original, situacao, imobiliaria_id, sugestoes, dados, volume", (q) => q.eq("fonte", "corp_produtor").order("id")),
  buscarTudo("imobiliarias", "id, nome, apelido, grupo_id, papel_no_grupo, origem_comercial, tipo_pessoa, centralizador_power_bi, observacao_interna", (q) => q.order("id")),
  buscarTudo("imobiliaria_grupos", "id, nome, tipo", (q) => q.order("id")),
  buscarTudo("corp_grade", "produtor, codigo_produtor", (q) => q.order("codigo_produtor").order("produtor")),
]);
const codigosDoProdutor = new Map();
for (const g of grade) {
  if (!g.produtor || g.codigo_produtor == null) continue;
  (codigosDoProdutor.get(g.produtor) ?? codigosDoProdutor.set(g.produtor, new Set()).get(g.produtor)).add(String(g.codigo_produtor));
}
const fichaPorId = new Map(fichas.map((f) => [f.id, f]));
const grupoPorId = new Map(grupos.map((g) => [g.id, g]));

// 1. produtor do PBI → registro do Corp
function acharRegistro(produtor) {
  const porNome = registros.filter((r) => t(r.nome_original) === t(produtor));
  const cods = codigosDoProdutor.get(produtor) ?? new Set();
  if (porNome.length === 1) return porNome[0];
  if (porNome.length > 1) return porNome.find((r) => cods.has(r.chave_externa.split("#")[0])) ?? porNome[0];
  const porCodigo = registros.filter((r) => cods.has(r.chave_externa.split("#")[0]));
  return porCodigo.length === 1 ? porCodigo[0] : null;
}
const itens = regras.map((r) => ({ ...r, central: t(r.centralizador) || t(r.produtor), registro: acharRegistro(r.produtor) }));

// 4. venda direta O2
const vendaDireta = itens.filter((i) => k(i.central) === k(CENTRAL_O2));
const desligarO2 = vendaDireta.filter((i) => i.registro?.situacao === "confirmado" && !/^O2 CORRETORA/i.test(i.produtor));

// 2. fichas: ligar a ficha de mesmo nome ou criar
const ligar = []; // { item, fichaId }
const criar = []; // { item, parecida }
const semRegistro = [];
const foraDaBase = [];
for (const i of itens) {
  if (vendaDireta.includes(i)) continue;
  if (!i.registro) {
    semRegistro.push(i);
    continue;
  }
  if (i.registro.situacao === "confirmado" && i.registro.imobiliaria_id) continue;
  // Canais/marcadores do Corp nunca são imobiliária (regra do Matheus, 18/10) e
  // "1 - REPASSE PADRÃO" é modelo do Corp — não viram ficha mesmo que o PBI liste.
  if (/^(O2 CORRETORA|SEGIMOB$|BASE SOFTWARE$|SUPERL[OÓ]GICA$|RETRANSMISS|TOMBAMENTO$|\d+ - )/i.test(t(i.produtor))) {
    foraDaBase.push(i);
    continue;
  }
  if (!ENTRA.has(t(i.entra_base_com_corretora))) {
    foraDaBase.push(i);
    continue;
  }
  const sug = Array.isArray(i.registro.sugestoes) ? i.registro.sugestoes : [];
  const iguais = [...new Set(sug.filter((s) => s.motivo === "nome igual").map((s) => s.imobiliaria_id))];
  if (iguais.length === 1 && fichaPorId.has(iguais[0])) ligar.push({ item: i, fichaId: iguais[0] });
  else criar.push({ item: i, parecida: sug.filter((s) => s.motivo === "nome parecido").map((s) => fichaPorId.get(s.imobiliaria_id)?.nome).filter(Boolean) });
}

// Ficha de cada item depois do passo 2 (novas recebem um id provisório).
const fichaDoItem = new Map();
for (const i of itens) if (i.registro?.situacao === "confirmado" && i.registro.imobiliaria_id && !vendaDireta.includes(i)) fichaDoItem.set(i, i.registro.imobiliaria_id);
for (const l of ligar) fichaDoItem.set(l.item, l.fichaId);
for (const c of criar) fichaDoItem.set(c.item, `novo:${c.item.produtor}`);

// 3. grupos pelo centralizador
const porCentral = new Map();
for (const [i, fichaId] of fichaDoItem) {
  const c = k(i.central);
  if (!porCentral.has(c)) porCentral.set(c, { rotulo: i.central, fichas: new Map() });
  const g = porCentral.get(c);
  if (!g.fichas.has(fichaId)) g.fichas.set(fichaId, []);
  g.fichas.get(fichaId).push(i);
}
const planoGrupos = []; // { rotulo, grupoExistente, fichas: [{fichaId, papel}] }
const fichaNoGrupoPbi = new Map(); // fichaId → central
for (const [c, g] of porCentral) {
  if (g.fichas.size < 2) continue;
  const atuais = [...g.fichas.keys()].map((id) => fichaPorId.get(id)?.grupo_id).filter(Boolean);
  const conta = {};
  for (const id of atuais) conta[id] = (conta[id] ?? 0) + 1;
  const grupoExistente = Object.entries(conta).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const membros = [...g.fichas.entries()].map(([fichaId, its]) => {
    const matriz = its.some((i) => k(i.produtor) === c);
    const fisica = its.every((i) => /F[IÍ]SICA/i.test(t(i.tipo_pessoa)));
    const atual = fichaPorId.get(fichaId);
    // O PBI só diz quem é a matriz (ficha com o nome do centralizador) e se o
    // produtor é pessoa física. Ficha que já estava neste grupo mantém o papel
    // definido pelo Matheus; ficha já existente que entra no grupo fica sem
    // papel (o PBI não informa); ficha nova = unidade, ou corretor se PF.
    const jaNoGrupo = !!atual && !!grupoExistente && atual.grupo_id === grupoExistente;
    const criadaPeloPbi = !atual || /a partir do Cadastro de Produtores do Power BI/.test(atual.observacao_interna ?? "");
    const papel = matriz ? "matriz" : jaNoGrupo ? (atual.papel_no_grupo ?? null) : criadaPeloPbi ? (fisica ? "corretor" : "unidade") : fisica ? "corretor" : null;
    fichaNoGrupoPbi.set(fichaId, c);
    return { fichaId, papel };
  });
  planoGrupos.push({ rotulo: g.rotulo, grupoExistente, membros });
}
// Ficha que o PBI coloca sozinha (sem outra ficha no mesmo centralizador), mas
// que hoje está num grupo junto de fichas que o PBI separa → sai do grupo.
const sairDoGrupo = [];
for (const f of fichas) {
  if (!f.grupo_id || fichaNoGrupoPbi.has(f.id)) continue;
  const itensDaFicha = [...fichaDoItem].filter(([, id]) => id === f.id).map(([i]) => i);
  if (!itensDaFicha.length) continue; // o PBI não fala desta ficha: fica como está
  const colegas = fichas.filter((o) => o.id !== f.id && o.grupo_id === f.grupo_id);
  const colegasComPbi = colegas.filter((o) => [...fichaDoItem.values()].includes(o.id));
  if (colegasComPbi.length) sairDoGrupo.push(f);
}
const pendentesDecisao = sairDoGrupo.filter((f) => !GRUPOS_DESFAZER_APROVADOS.has(grupoPorId.get(f.grupo_id)?.nome));
for (const f of pendentesDecisao) sairDoGrupo.splice(sairDoGrupo.indexOf(f), 1);

// 5. origem / tipo de pessoa / centralizador na ficha (produtor de maior volume)
function dadosPbiDaFicha(fichaId) {
  const its = [...fichaDoItem].filter(([, id]) => id === fichaId).map(([i]) => i);
  its.sort((a, b) => (b.registro?.volume ?? 0) - (a.registro?.volume ?? 0));
  const i = its[0];
  return i ? { origem_comercial: t(i.origem) || null, tipo_pessoa: t(i.tipo_pessoa) || null, centralizador_power_bi: i.central || null } : null;
}

// ---------- relatório ----------
const nomeFicha = (id) => (String(id).startsWith("novo:") ? `${id.slice(5)} (nova)` : fichaPorId.get(id)?.nome ?? id);
console.log(`produtores no PBI: ${itens.length} | ligados a registro do Corp: ${itens.filter((i) => i.registro).length}`);
console.log(`já com ficha confirmada: ${[...fichaDoItem.values()].filter((v) => !String(v).startsWith("novo:")).length - ligar.length}`);
console.log(`ligar à ficha de mesmo nome: ${ligar.length}`);
console.log(`criar ficha: ${criar.length} (${criar.filter((c) => c.parecida.length).length} com possível duplicata por nome parecido)`);
console.log(`sem registro no Corp (sem produção): ${semRegistro.length} | fora da base no PBI (NÃO ENTRA/EXCEÇÃO): ${foraDaBase.length}`);
console.log(`venda direta O2: ${vendaDireta.map((i) => i.produtor).join(" | ")} — desligar da ficha: ${desligarO2.map((i) => `${i.produtor} (era ${nomeFicha(i.registro.imobiliaria_id)})`).join(", ") || "nenhum"}`);
console.log(`\ngrupos (${planoGrupos.length}):`);
for (const g of planoGrupos) {
  const ex = g.grupoExistente ? grupoPorId.get(g.grupoExistente)?.nome : null;
  const mudam = g.membros.filter((m) => {
    const f = fichaPorId.get(m.fichaId);
    return !f || !g.grupoExistente || f.grupo_id !== g.grupoExistente || (f.papel_no_grupo ?? null) !== m.papel;
  });
  console.log(` ${g.rotulo} → ${ex ? `grupo existente "${ex}"` : "grupo NOVO"} | ${g.membros.length} fichas | mudam: ${mudam.map((m) => `${nomeFicha(m.fichaId)} [${m.papel}]`).join("; ") || "nada"}`);
}
console.log(`\nPENDENTE (o PBI separa, não aprovado — fica como está): ${pendentesDecisao.map((f) => `${f.nome} (grupo "${grupoPorId.get(f.grupo_id)?.nome}")`).join("; ") || "nenhum"}`);
console.log(`saem do grupo atual:${sairDoGrupo.map((f) => `${f.nome} (de "${grupoPorId.get(f.grupo_id)?.nome}")`).join("; ") || "nenhuma"}`);
if (!gravar) {
  console.log("\n(simulação — nada gravado; use --gravar)");
  process.exit(0);
}

// ---------- gravação ----------
const agora = new Date().toISOString();
const um = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

// venda direta O2
um(await supabase.from("base_unica_produtores_venda_direta").upsert(vendaDireta.map((i) => ({ produtor: i.produtor, atualizado_em: agora }))));
for (const i of desligarO2) {
  um(await supabase.from("imobiliaria_registros_fonte").update({ situacao: "ignorar", metodo_vinculo: "power_bi", confirmado_em: agora, confirmado_por_email: "power_bi" }).eq("id", i.registro.id));
  await log("vinculo", { registro_id: i.registro.id, imobiliaria_id: i.registro.imobiliaria_id }, { situacao: "confirmado", imobiliaria_id: i.registro.imobiliaria_id }, { situacao: "ignorar", canal: "venda_direta_o2" }, `Power BI centraliza "${i.produtor}" em O2 SEGUROS: produção própria da O2 (Venda direta O2)`);
}

// fichas novas
const idNovo = new Map();
for (const c of criar) {
  const d = c.item.registro.dados ?? {};
  const doc = String(d.cpf_cnpj ?? "").replace(/\D/g, "");
  const obs = `Criada em ${HOJE} pela Base Única a partir do Cadastro de Produtores do Power BI (produtor Corp "${t(c.item.produtor)}", código ${c.item.registro.chave_externa.split("#")[0]}).${
    c.parecida.length ? ` Possível duplicata de: ${c.parecida.join(", ")} (nome parecido) — revisar.` : ""
  }`;
  const nova = um(
    await supabase
      .from("imobiliarias")
      .insert({
        nome: t(c.item.produtor),
        cnpj: doc || "A definir",
        texto_base_contrato: "",
        indice_reajuste: "",
        percentual_multa_atraso: 0,
        percentual_juros_mora: 0,
        percentual_honorarios_advocaticios: 0,
        cadastro_incompleto: true,
        email: d.emails?.[0] ?? null,
        telefone: d.telefones?.[0] ?? null,
        endereco: t(d.endereco) || null,
        bairro: d.bairro ?? null,
        cidade: d.cidade ?? null,
        uf: d.uf ?? null,
        observacao_interna: obs,
      })
      .select("id")
      .single()
  );
  idNovo.set(`novo:${c.item.produtor}`, nova.id);
  fichaPorId.set(nova.id, { id: nova.id, nome: t(c.item.produtor), grupo_id: null, papel_no_grupo: null });
  await log("ficha_criada", { imobiliaria_id: nova.id, registro_id: c.item.registro.id }, null, { nome: t(c.item.produtor) }, "Produtor do Cadastro de Produtores do Power BI sem ficha no Workspace");
  ligar.push({ item: c.item, fichaId: nova.id, criada: true });
}
const real = (id) => idNovo.get(id) ?? id;

// vínculos produtor → ficha
for (const l of ligar) {
  const r = l.item.registro;
  um(await supabase.from("imobiliaria_registros_fonte").update({ situacao: "confirmado", imobiliaria_id: l.fichaId, metodo_vinculo: "power_bi", confirmado_em: agora, confirmado_por_email: "power_bi" }).eq("id", r.id));
  await log("vinculo", { registro_id: r.id, imobiliaria_id: l.fichaId }, { situacao: r.situacao, imobiliaria_id: r.imobiliaria_id }, { situacao: "confirmado", imobiliaria_id: l.fichaId }, l.criada ? "Ligado à ficha criada a partir do Power BI" : "Ligado à ficha de mesmo nome (produtor classificado no Power BI)");
}

// grupos
for (const g of planoGrupos) {
  let grupoId = g.grupoExistente;
  if (!grupoId) {
    grupoId = um(await supabase.from("imobiliaria_grupos").insert({ nome: g.rotulo, tipo: "rede_filiais", chave: textoBase(g.rotulo).replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""), criado_por_email: "power_bi", observacao: `Criado em ${HOJE} a partir do centralizador "${g.rotulo}" do Cadastro de Produtores do Power BI` }).select("id").single()).id;
    await log("grupo_criado", { grupo_id: grupoId }, null, { nome: g.rotulo, tipo: "rede_filiais" }, `Centralizador "${g.rotulo}" do Power BI`);
  }
  for (const m of g.membros) {
    const id = real(m.fichaId);
    const f = fichaPorId.get(id);
    if (f.grupo_id === grupoId && (f.papel_no_grupo ?? null) === m.papel) continue;
    um(await supabase.from("imobiliarias").update({ grupo_id: grupoId, papel_no_grupo: m.papel }).eq("id", id));
    await log("grupo", { imobiliaria_id: id, grupo_id: grupoId }, { grupo_id: f.grupo_id, papel_no_grupo: f.papel_no_grupo }, { grupo_id: grupoId, papel_no_grupo: m.papel }, `Centralizador "${g.rotulo}" do Power BI`);
  }
}
for (const f of sairDoGrupo) {
  um(await supabase.from("imobiliarias").update({ grupo_id: null, papel_no_grupo: null }).eq("id", f.id));
  await log("grupo", { imobiliaria_id: f.id, grupo_id: f.grupo_id }, { grupo_id: f.grupo_id, papel_no_grupo: f.papel_no_grupo }, { grupo_id: null, papel_no_grupo: null }, "O Power BI trata esta imobiliária separada das outras fichas do grupo");
}

// origem / tipo de pessoa / centralizador
const fichasComPbi = new Set([...fichaDoItem.values()].map(real));
for (const id of fichasComPbi) {
  const novo = dadosPbiDaFicha([...fichaDoItem].find(([, v]) => real(v) === id)?.[1]);
  const f = fichaPorId.get(id);
  if (!novo || !f) continue;
  const antes = { origem_comercial: f.origem_comercial ?? null, tipo_pessoa: f.tipo_pessoa ?? null, centralizador_power_bi: f.centralizador_power_bi ?? null };
  if (JSON.stringify(antes) === JSON.stringify(novo)) continue;
  um(await supabase.from("imobiliarias").update(novo).eq("id", id));
  if (antes.origem_comercial || antes.tipo_pessoa || antes.centralizador_power_bi) log("dados_power_bi", { imobiliaria_id: id }, antes, novo, "Origem/tipo de pessoa/centralizador do Power BI");
}

um(await supabase.rpc("atualizar_producao_painel", { p_forcar: true }));
console.log(`\ngravado: ${alteracoes} alterações no histórico.`);
