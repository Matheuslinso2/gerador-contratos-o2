// Base Única — confirma vínculos de nome que só podem ser de UMA imobiliária
// (pedido do Matheus em 21/10/2026: "vincular o cadastro de imobs do workspace e
// do power bi para unificar tudo e deixar consultável" — cotações e sinistros).
// Roda depois de vincular.mjs (que gera as sugestões a partir das fichas, dos
// nomes do Corp/Power BI já ligados e dos e-mails).
//
// Confirma sozinho quando as sugestões fortes ("nome igual" / "mesmo e-mail"):
//   - apontam para uma única ficha; ou
//   - apontam para várias fichas do MESMO grupo (ex.: "RAMIRO SÁ" → fichas PF e
//     PJ do grupo Ramiro Sá): liga na ficha principal do grupo (matriz; senão a
//     que tem mais fontes confirmadas). O painel soma pelo grupo.
// Fica para revisão: nome só parecido, ou nome igual a fichas de grupos diferentes.
// Toda confirmação vai para imobiliaria_historico. Sem --gravar só simula.
// uso: node scripts/base-unica/confirmar-por-nome.mjs [--gravar]
import { supabase, buscarTudo } from "./_comum.mjs";

const gravar = process.argv.includes("--gravar");
const FONTES = new Set(["planilha_fianca", "planilha_re", "bitrix_empresa", "bitrix_cap_texto", "corp_produtor"]);

const [registros, fichas] = await Promise.all([
  buscarTudo("imobiliaria_registros_fonte", "id, fonte, nome_original, situacao, imobiliaria_id, sugestoes, volume", (q) => q.eq("situacao", "sugerido").order("id")),
  buscarTudo("imobiliarias", "id, nome, grupo_id, papel_no_grupo", (q) => q.order("id")),
]);
const confirmados = await buscarTudo("imobiliaria_registros_fonte", "imobiliaria_id", (q) => q.eq("situacao", "confirmado").not("imobiliaria_id", "is", null).order("id"));
const fontesPorFicha = {};
for (const r of confirmados) fontesPorFicha[r.imobiliaria_id] = (fontesPorFicha[r.imobiliaria_id] ?? 0) + 1;
const fichaPorId = new Map(fichas.map((f) => [f.id, f]));
// Fichas cujo produtor o Power BI centraliza em O2 SEGUROS (Venda direta O2,
// ex.: MARTINELLI): nome igual a elas não liga sozinho.
const desligadasO2 = new Set(
  (await buscarTudo("imobiliaria_registros_fonte", "imobiliaria_id", (q) => q.eq("fonte", "corp_produtor").eq("situacao", "ignorar").eq("metodo_vinculo", "power_bi"))).map((r) => r.imobiliaria_id)
);

const confirmar = []; // { r, fichaId, como }
const revisar = { parecido: 0, grupos_diferentes: [] };
for (const r of registros) {
  if (!FONTES.has(r.fonte)) continue;
  const fortes = [...new Set((r.sugestoes ?? []).filter((s) => s.motivo === "nome igual" || s.motivo === "mesmo e-mail").map((s) => s.imobiliaria_id))]
    .map((id) => fichaPorId.get(id))
    .filter(Boolean);
  if (!fortes.length) {
    revisar.parecido++;
    continue;
  }
  if (fortes.some((f) => desligadasO2.has(f.id))) {
    revisar.grupos_diferentes.push(r);
    continue;
  }
  if (fortes.length === 1) {
    confirmar.push({ r, fichaId: fortes[0].id, como: "nome_unico" });
    continue;
  }
  const grupos = new Set(fortes.map((f) => f.grupo_id));
  if (grupos.size === 1 && !grupos.has(null)) {
    const principal = [...fortes].sort(
      (a, b) => (b.papel_no_grupo === "matriz") - (a.papel_no_grupo === "matriz") || (fontesPorFicha[b.id] ?? 0) - (fontesPorFicha[a.id] ?? 0) || a.nome.localeCompare(b.nome)
    )[0];
    confirmar.push({ r, fichaId: principal.id, como: "mesmo_grupo" });
  } else revisar.grupos_diferentes.push(r);
}

const resumo = {};
for (const c of confirmar) {
  const k = `${c.r.fonte} · ${c.como}`;
  resumo[k] ??= { registros: 0, linhas: 0 };
  resumo[k].registros++;
  resumo[k].linhas += c.r.volume ?? 0;
}
console.log("confirmar:", resumo);
console.log(`ficam para revisão: ${revisar.parecido} só com nome parecido | ${revisar.grupos_diferentes.length} com nome igual a fichas de grupos diferentes`);
for (const r of revisar.grupos_diferentes.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 15))
  console.log(`   ${r.fonte} "${r.nome_original}" (${r.volume}) → ${(r.sugestoes ?? []).map((s) => fichaPorId.get(s.imobiliaria_id)?.nome).join(" | ")}`);
console.log("\nmaiores confirmações (conferência):");
for (const c of [...confirmar].sort((a, b) => (b.r.volume ?? 0) - (a.r.volume ?? 0)).slice(0, 25))
  console.log(`   ${c.r.fonte} "${c.r.nome_original}" (${c.r.volume}) → ${fichaPorId.get(c.fichaId)?.nome} [${c.como}]`);
console.log("\nnomes de uma palavra só (conferência):");
for (const c of confirmar.filter((c) => !/\s/.test(c.r.nome_original.replace(/\(.*?\)/g, "").trim())).sort((a, b) => (b.r.volume ?? 0) - (a.r.volume ?? 0)).slice(0, 30))
  console.log(`   ${c.r.fonte} "${c.r.nome_original}" (${c.r.volume}) → ${fichaPorId.get(c.fichaId)?.nome}`);

if (!gravar) {
  console.log("\n(simulação — nada gravado; use --gravar)");
  process.exit(0);
}
const agora = new Date().toISOString();
for (const c of confirmar) {
  const { error } = await supabase
    .from("imobiliaria_registros_fonte")
    .update({ situacao: "confirmado", imobiliaria_id: c.fichaId, metodo_vinculo: c.como === "nome_unico" ? "nome_igual_unico" : "nome_igual_mesmo_grupo", confirmado_em: agora, confirmado_por_email: "base_unica_nome" })
    .eq("id", c.r.id)
    .eq("situacao", "sugerido");
  if (error) throw new Error(error.message);
  const { error: eh } = await supabase.from("imobiliaria_historico").insert({
    imobiliaria_id: c.fichaId,
    registro_id: c.r.id,
    campo: "vinculo",
    antes: { situacao: "sugerido" },
    depois: { situacao: "confirmado", imobiliaria_id: c.fichaId },
    motivo: c.como === "nome_unico" ? `"${c.r.nome_original}" (${c.r.fonte}) tem o mesmo nome de uma única ficha` : `"${c.r.nome_original}" (${c.r.fonte}) tem o mesmo nome de fichas do mesmo grupo`,
    origem: "base_unica",
  });
  if (eh) throw new Error(eh.message);
}
const { error: ep } = await supabase.rpc("atualizar_producao_painel", { p_forcar: true });
if (ep) throw new Error(ep.message);
console.log(`\ngravado: ${confirmar.length} vínculos confirmados.`);
