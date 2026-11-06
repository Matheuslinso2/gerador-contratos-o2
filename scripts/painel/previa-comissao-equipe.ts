// PRÉVIA da comissão da equipe pela regra de 06/11/2026 (nada é gravado no Bitrix nem no banco; só leitura).
//   NODE_PATH="$TEMP/stub" npx tsx scripts/painel/previa-comissao-equipe.ts [saida.json]
process.loadEnvFile(".env.local");
import { writeFileSync } from "node:fs";
import { gerarHtmlPrevia } from "./previa-comissao-equipe-html";
import { buscarTodasPaginasFlat, chamarBitrix } from "@/lib/bitrix/client";
import { createServiceClient } from "@/lib/supabase/service";
import { construirDatasets, type BaseComissaoEquipe, type DealBruto, type EmpresaBruta } from "@/lib/painelComercial/construir";
import { calcularComissaoEquipe, resumirComissaoEquipe } from "@/lib/painelComercial/comissaoEquipe";
import { evidenciasWorkspace, imobiliariasDaElite, nomesImobiliarias, vinculosEmpresaImobiliaria } from "@/lib/painelComercial/comissaoEquipeDados";

const CAMPOS_EMPRESA = ["ID", "TITLE", "UF_CRM_1788467865683", "UF_CRM_1788467885830", "UF_CRM_1789589770952"];

async function main() {
  const saida = process.argv[2];
  const db = createServiceClient();
  const deals = (await Promise.all([0, 1, 12].map((c) => buscarTodasPaginasFlat<DealBruto>("crm.deal.list", { "filter[CATEGORY_ID]": c, select: ["*", "UF_*"] })))).flat();
  const ids = [...new Set(deals.map((d) => String(d.COMPANY_ID ?? "")).filter((x) => x && x !== "0"))];
  const empresas = new Map<string, EmpresaBruta>();
  for (let i = 0; i < ids.length; i += 50) for (const e of await buscarTodasPaginasFlat<EmpresaBruta>("crm.company.list", { select: CAMPOS_EMPRESA, "filter[ID]": ids.slice(i, i + 50) })) empresas.set(String(e.ID), e);
  const etapas = await chamarBitrix<{ result: { STATUS_ID: string; NAME: string }[] }>("crm.dealcategory.stage.list", { id: 12 });

  let base: BaseComissaoEquipe | null = null;
  const datasets = construirDatasets({
    agora: new Date(),
    deals,
    historico: [],
    empresas,
    atividades: [],
    nomesEtapas12: Object.fromEntries(etapas.result.map((s) => [s.STATUS_ID, s.NAME])),
    metasPersonalizadas: new Map(),
    mesesCongelados: { kpi: [] },
    coletarBase: (b) => (base = b),
  });
  if (!base) throw new Error("base não coletada");
  const b: BaseComissaoEquipe = base;

  const imobPorEmpresa = await vinculosEmpresaImobiliaria(db, b.cards.map((c) => c.empresaId));
  const imobs = [...new Set(imobPorEmpresa.values())];
  const [nomeImob, evidencias, eliteImobs] = await Promise.all([nomesImobiliarias(db, imobs), evidenciasWorkspace(db, imobs, "2026-09-01"), imobiliariasDaElite(db)]);
  const linhas = calcularComissaoEquipe({ base: b, imobPorEmpresa, nomeImob, evidencias, eliteImobs, pagas: ["Dayane", "Livia"], competenciaInicial: "2026-10" });
  const resumo = resumirComissaoEquipe(linhas);

  // Regra anterior (Painel Comercial publicado), para comparar por mês e responsável.
  const antigo = new Map<string, number>();
  for (const l of (datasets.comissao ?? []) as Record<string, unknown>[]) {
    const k = `${l.vendedora}|${String(l.data).slice(0, 7)}`;
    antigo.set(k, (antigo.get(k) ?? 0) + Number(l.total));
  }

  console.log(`Cards lidos: ${b.cards.length} | calls: ${b.calls.length} | empresas com vínculo: ${imobPorEmpresa.size} | evidências do Workspace: ${evidencias.length} | imobiliárias na Elite: ${eliteImobs.size}`);
  console.log(`Cards com "Data de cotação" preenchida: ${b.cards.filter((c) => c.dataCotacao).length} | cards com Tipos de oportunidade: ${b.cards.filter((c) => c.produtos.length).length}`);
  console.log("\nRESUMO por responsável e competência (validado / pendente) — regra anterior entre parênteses");
  for (const r of resumo) console.log(`${r.vendedora.padEnd(8)} ${r.competencia.padEnd(17)} validado R$ ${r.validado.toFixed(0).padStart(4)} | pendente R$ ${r.pendente.toFixed(0).padStart(4)} | ${r.linhas} linha(s) ${JSON.stringify(r.porSituacao)} (antigo: R$ ${antigo.get(`${r.vendedora}|${r.competencia}`) ?? 0})`);
  // Contexto da conferência: vínculos usados, pendências de dados e lacunas do Workspace.
  const callsCotacao = b.calls.filter((e) => e.realizada && !e.treino && e.resultadoId === "3274" && ["Dayane", "Livia"].includes(e.vendedora) && e.data >= "2026-10-01");
  const cardsComCall = new Set(callsCotacao.map((e) => e.card));
  const empresasRelevantes = new Set(linhas.map((l) => l.empresaId).concat(b.cards.filter((c) => cardsComCall.has(c.card)).map((c) => c.empresaId)));
  const vinculos = [...empresasRelevantes].map((emp) => {
    const card = b.cards.find((c) => c.empresaId === emp);
    const imob = imobPorEmpresa.get(emp) ?? null;
    return { empresaId: emp, cliente: card?.cliente ?? "", imobiliaria: imob ? (nomeImob.get(imob) ?? imob) : null, vinculado: !!imob, elite: imob ? eliteImobs.has(imob) : false };
  });
  const convertidasNovas = evidencias.filter((e) => e.tipo === "novo" && e.status === "Convertido" && (e.dataCotacao ?? "") >= "2026-10-01" && (e.dataCotacao ?? "") < "2027-01-01");
  const lacunaEfetivacao = ["fianca", "re", "capitalizacao"].map((p) => ({ produto: p, convertidas: convertidasNovas.filter((e) => e.produto === p).length, semData: convertidasNovas.filter((e) => e.produto === p && !e.dataEfetivacao).length }));
  const contexto = {
    cards: b.cards.length,
    cardsComTipos: b.cards.filter((c) => c.produtos.length).length,
    cardsComDataCotacao: b.cards.filter((c) => c.dataCotacao).length,
    callsRealizadas: b.calls.filter((e) => e.realizada && !e.treino).length,
    callsCotacao: callsCotacao.length,
    cardsComCallCotacaoSemTipos: [...cardsComCall].filter((id) => !b.cards.find((c) => c.card === id)?.produtos.length).length,
    cardsComCallCotacao: cardsComCall.size,
    empresasComResultadoFinanceiro: b.fin.length,
    elite: eliteImobs.size,
    evidenciasWorkspace: evidencias.length,
    lacunaEfetivacao,
  };
  const dados = { geradoEm: new Date().toISOString(), linhas, resumo, antigo: [...antigo], vinculos, contexto };
  if (saida) {
    writeFileSync(saida, JSON.stringify(dados, null, 2));
    writeFileSync(saida.replace(/\.json$/, ".html"), gerarHtmlPrevia(dados));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
