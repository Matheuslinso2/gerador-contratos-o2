// Base Única — RENOVAÇÕES de Seguro Fiança e de Ramos Elementares das
// planilhas congeladas → producao_unificada (tipo='renovacao', fonte='planilha'),
// série separada das cotações novas no Power BI - O2 Seguros (21/10/2026).
// Leitura das abas: ./_renovacoes-planilhas.ts. Regras (mesma régua do painel
// de cada produto, "quando a fonte muda, só a fonte muda"):
//  - Fiança (aba RENOVAÇÕES, nov/2025 → set/2026): é uma lista de trabalho com
//    herança — a renovação em andamento no fim do mês aparece de novo na
//    planilha do mês seguinte (mesma apólice). 1 renovação = 1 caso ligado
//    pela APÓLICE; recebida = 1ª planilha em que aparece; renovada / não
//    renovada = 1ª planilha em que aparece RENOVADO / NÃO RENOVADO (não há
//    coluna de data de efetivação). A planilha de out/2026 entra só com a
//    herança (apólices já vistas): renovações novas de out/2026 em diante
//    vêm do funil Renovação do Bitrix (categoria 32).
//  - RE (aba RN <mês>, nov/2025 → set/2026): cada aba é o LOTE do mês de
//    vencimento (1 linha = 1 item/apólice); recebida = mês do vencimento
//    (FIM. VIG, senão o mês da aba); efetivada / não efetivada = mês da DATA
//    EFETIVAÇÃO quando preenchida e plausível (até 2 meses antes ou 3 depois
//    do vencimento), senão o mês da aba — regra da efetivação do painel
//    /ramos-elementares (Matheus 18/10/2026: conta no mês em que ocorreu). A
//    planilha de nov/2025 traz o lote de dez/2025 ainda em cotação; a de
//    dez/2025 traz o mesmo lote resolvido — a mesma apólice vira 1 caso (status
//    mais avançado). De out/2026 em diante a fonte é o funil Renovações do
//    Bitrix (categoria 34); em set/2026 o painel soma planilha e Bitrix.
// Dados pessoais (locatário/segurado) NÃO são gravados (só servem para a chave
// quando falta a apólice).
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/importar-planilhas-renovacoes.ts [fianca|re] [--gravar]
// Sem --gravar só mostra o que faria e confere com os retratos dos painéis.
process.loadEnvFile(".env.local");
import crypto from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { lerRenovacoesFiancaPlanilhas, lerRenovacoesRePlanilhas, type LinhaRenovacaoPlanilha } from "./_renovacoes-planilhas";

const args = process.argv.slice(2);
const gravar = args.includes("--gravar");
const produtos = (["fianca", "re"] as const).filter((p) => args.includes(p) || !args.some((a) => a === "fianca" || a === "re"));
const ULTIMO_MES_PLANILHA = "2026-09";
const PRIMEIRO_MES_PLANILHA = "2025-11";

const sha = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
const normApolice = (a: string | null) => {
  const n = (a ?? "").replace(/\s/g, "").toUpperCase();
  return /[0-9]{4}/.test(n) ? n : null; // "-", "0", "S/N" não identificam a apólice
};
const somarMes = (m: string, n: number) => {
  const [a, mm] = m.split("-").map(Number);
  const t = a * 12 + mm - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const mesDe = (d: string | null) => (d && d >= "2000-01-01" ? d.slice(0, 7) : null);

type Registro = Record<string, unknown> & { chave_caso: string; competencia_arquivo: string; status_padrao: string; origem_linha: number; extras: Record<string, unknown> };
type Lote = { comp: string; arquivoId: string; arquivoNome: string; aba: string; produto: "fianca" | "re"; layout: string; registros: Registro[]; totaisPlanilha: Record<string, number>; observacao: string | null };

function montarFianca(linhas: LinhaRenovacaoPlanilha[]): Lote[] {
  const lotes: Lote[] = [];
  const vistas = new Set<string>(); // chaves já vistas em planilhas anteriores
  const porArquivo = new Map<string, LinhaRenovacaoPlanilha[]>();
  for (const l of linhas) {
    if (!porArquivo.has(l.arquivoId)) porArquivo.set(l.arquivoId, []);
    porArquivo.get(l.arquivoId)!.push(l);
  }
  for (const [arquivoId, ls] of [...porArquivo].sort((a, b) => a[1][0].comp.localeCompare(b[1][0].comp))) {
    const comp = ls[0].comp;
    const soHeranca = comp > ULTIMO_MES_PLANILHA;
    const registros: Registro[] = [];
    const totais: Record<string, number> = {};
    const novasDoMes = new Set<string>();
    let ignoradasOut = 0;
    for (const l of ls) {
      totais[l.status] = (totais[l.status] ?? 0) + 1;
      const ap = normApolice(l.apolice);
      const chave = ap
        ? sha(`fianca|renovacao|${ap}`)
        : sha(`fianca|renovacao|${(l.imobiliaria ?? "").toUpperCase()}|${String(l.extras.locatario_nome ?? "").toUpperCase()}|${l.fimVigencia ?? ""}`);
      const herdada = vistas.has(chave);
      if (soHeranca && !herdada) {
        ignoradasOut++;
        continue;
      }
      novasDoMes.add(chave);
      const { locatario_nome: _l, ...extras } = l.extras;
      registros.push({
        produto: "fianca", tipo: "renovacao", fonte: "planilha", origem_arquivo_id: arquivoId, origem_aba: l.aba, origem_linha: l.linha,
        competencia_arquivo: comp, herdada, chave_caso: chave,
        data_recebimento: l.dataRecebimento, data_efetivacao: null,
        status_original: l.status, status_padrao: l.statusPadrao,
        seguradora: l.seguradora, imobiliaria_texto: l.imobiliaria, fonte_vinculo: "planilha_fianca",
        responsavel: l.responsavel, premio: l.premio, comissao: l.comissao,
        extras: { ...extras, fim_vigencia: l.fimVigencia, apolice: l.apolice, ...(ap ? {} : { chave_sem_apolice: true }) },
      });
    }
    for (const c of novasDoMes) vistas.add(c);
    lotes.push({
      comp, arquivoId, arquivoNome: ls[0].arquivoNome, aba: ls[0].aba, produto: "fianca", layout: "fianca_renovacao", registros, totaisPlanilha: totais,
      observacao: soHeranca ? `só herança (${registros.length} apólices já vistas); ${ignoradasOut} linhas novas ignoradas — de out/2026 em diante a fonte é o Bitrix` : null,
    });
  }
  return lotes;
}

function montarRe(linhas: LinhaRenovacaoPlanilha[]): Lote[] {
  const lotes: Lote[] = [];
  const porArquivo = new Map<string, LinhaRenovacaoPlanilha[]>();
  for (const l of linhas) {
    if (!porArquivo.has(l.arquivoId)) porArquivo.set(l.arquivoId, []);
    porArquivo.get(l.arquivoId)!.push(l);
  }
  const vistas = new Set<string>();
  for (const [arquivoId, ls] of [...porArquivo].sort((a, b) => a[1][0].comp.localeCompare(b[1][0].comp))) {
    const compAba = ls[0].comp;
    const registros: Registro[] = [];
    const totais: Record<string, number> = {};
    const chavesDoMes = new Set<string>();
    for (const l of ls) {
      totais[l.status] = (totais[l.status] ?? 0) + 1;
      // Competência da renovação = mês do vencimento (a aba é o lote do mês);
      // vencimento fora de ±1 mês da aba é digitação → vale a aba.
      const mesVig = mesDe(l.fimVigencia);
      const comp = mesVig && mesVig >= somarMes(compAba, -1) && mesVig <= somarMes(compAba, 1) ? mesVig : compAba;
      const ap = normApolice(l.apolice);
      const chave = ap
        ? sha(`re|renovacao|${ap}|${comp}`)
        : sha(`re|renovacao|${(l.imobiliaria ?? "").toUpperCase()}|${String(l.extras.segurado_nome ?? "").toUpperCase()}|${l.ramo ?? ""}|${comp}`);
      const mesEfet = mesDe(l.dataEfetivacao);
      const dataEvento = mesEfet && mesEfet >= somarMes(comp, -2) && mesEfet <= somarMes(comp, 3) ? l.dataEfetivacao : null;
      const herdada = vistas.has(chave) && !chavesDoMes.has(chave);
      chavesDoMes.add(chave);
      const { segurado_nome: _s, ...extras } = l.extras;
      registros.push({
        produto: l.produto, tipo: "renovacao", fonte: "planilha", origem_arquivo_id: arquivoId, origem_aba: l.aba, origem_linha: l.linha,
        competencia_arquivo: comp, herdada, chave_caso: chave,
        data_recebimento: l.dataRecebimento, data_efetivacao: l.statusPadrao === "Convertido" ? l.dataEfetivacao : null,
        status_original: l.status, status_padrao: l.statusPadrao === "Cancelado" ? "Perdido" : l.statusPadrao,
        ramo_original: l.ramo, ramo_padrao: l.ramo,
        seguradora: l.seguradora && l.seguradora !== "NÃO INFORMADA" ? l.seguradora : null,
        imobiliaria_texto: l.produto === "re" && l.imobiliaria && l.imobiliaria !== "NÃO INFORMADA" ? l.imobiliaria : null,
        fonte_vinculo: l.produto === "re" ? "planilha_re" : null,
        responsavel: l.responsavel, premio: l.statusPadrao === "Convertido" ? l.premio : null, comissao: l.statusPadrao === "Convertido" ? l.comissao : null,
        extras: {
          ...extras, fim_vigencia: l.fimVigencia, apolice: l.apolice, aba_competencia: compAba,
          ...(l.statusPadrao === "Convertido" && dataEvento ? { data_conversao: dataEvento } : {}),
          ...(["Perdido", "Cancelado"].includes(l.statusPadrao) && dataEvento ? { data_perda: dataEvento } : {}),
          ...(l.statusPadrao === "Cancelado" ? { cancelado: true } : {}),
          ...(ap ? {} : { chave_sem_apolice: true }),
        },
      });
    }
    for (const c of chavesDoMes) vistas.add(c);
    lotes.push({ comp: compAba, arquivoId, arquivoNome: ls[0].arquivoNome, aba: ls[0].aba, produto: "re", layout: "re_renovacao", registros, totaisPlanilha: totais, observacao: null });
  }
  return lotes;
}

// O que a linha do tempo vai contar por mês (mesma lógica do resumo
// producao_painel_mensal): recebida = 1ª aparição não herdada; renovada /
// não renovada = mês do evento (data, senão 1ª planilha naquela situação).
function contar(lotes: Lote[]) {
  const porCaso = new Map<string, { entrada: string | null; conv: string | null; perda: string | null; rank: number; status: string; produto: string }>();
  const rank = (s: string) => ({ Convertido: 6, Perdido: 5, Recusado: 4, Cancelado: 3, Aprovado: 2, "Em análise": 1 })[s] ?? 0;
  for (const lote of lotes)
    for (const r of lote.registros) {
      const c = porCaso.get(r.chave_caso) ?? { entrada: null, conv: null, perda: null, rank: -1, status: "", produto: String(r.produto) };
      if (!r.herdada && (!c.entrada || r.competencia_arquivo < c.entrada)) c.entrada = r.competencia_arquivo;
      const mConv = r.status_padrao === "Convertido" ? ((r.extras.data_conversao as string | undefined)?.slice(0, 7) ?? r.competencia_arquivo) : null;
      const mPerda = r.status_padrao === "Perdido" ? ((r.extras.data_perda as string | undefined)?.slice(0, 7) ?? r.competencia_arquivo) : null;
      if (mConv && (!c.conv || mConv < c.conv)) c.conv = mConv;
      if (mPerda && (!c.perda || mPerda < c.perda)) c.perda = mPerda;
      if (rank(r.status_padrao) > c.rank) {
        c.rank = rank(r.status_padrao);
        c.status = r.status_padrao;
      }
      porCaso.set(r.chave_caso, c);
    }
  const porMes: Record<string, { recebidas: number; renovadas: number; nao_renovadas: number }> = {};
  const m = (k: string) => (porMes[k] ||= { recebidas: 0, renovadas: 0, nao_renovadas: 0 });
  for (const c of porCaso.values()) {
    if (c.entrada) m(c.entrada).recebidas++;
    if (c.conv) m(c.conv).renovadas++;
    if (c.perda) m(c.perda).nao_renovadas++;
  }
  return { porMes, casos: porCaso.size, emAndamento: [...porCaso.values()].filter((c) => c.status === "Em análise").length };
}

async function main() {
  const sb = createServiceClient();
  const { data: retRe } = await sb.from("ramos_elementares_snapshots").select("competencia, payload").order("competencia");
  const refRe = new Map((retRe ?? []).map((r) => [r.competencia as string, r.payload?.visaoGeral as { renovacoesEntradas?: number; renovacoesCompetencia?: number; renovacoesEfetivadas?: number } | undefined]));

  for (const produto of produtos) {
    const linhas = produto === "fianca" ? await lerRenovacoesFiancaPlanilhas(PRIMEIRO_MES_PLANILHA, somarMes(ULTIMO_MES_PLANILHA, 1)) : await lerRenovacoesRePlanilhas(PRIMEIRO_MES_PLANILHA, ULTIMO_MES_PLANILHA);
    const lotes = produto === "fianca" ? montarFianca(linhas) : montarRe(linhas);
    console.log(`\n==== ${produto.toUpperCase()} — ${lotes.length} planilhas, ${linhas.length} linhas lidas`);
    for (const l of lotes) {
      const st: Record<string, number> = {};
      for (const r of l.registros) st[r.status_padrao] = (st[r.status_padrao] ?? 0) + 1;
      console.log(
        `${l.comp} | ${l.registros.length} linhas (${l.registros.filter((r) => r.herdada).length} herdadas) ${JSON.stringify(st)} | status da planilha: ${JSON.stringify(l.totaisPlanilha)}${l.observacao ? " | " + l.observacao : ""} | ${l.arquivoNome} › ${l.aba}`
      );
    }
    const semApolice = lotes.flatMap((l) => l.registros).filter((r) => r.extras.chave_sem_apolice).length;
    const statusDesconhecido = [...new Set(linhas.filter((l) => l.statusPadrao === "Em análise").map((l) => l.status))];
    const { porMes, casos, emAndamento } = contar(lotes);
    console.log(`\ncasos: ${casos} | em andamento no fim: ${emAndamento} | linhas sem apólice (chave por imob+nome+vencimento): ${semApolice}`);
    console.log(`status lidos como "Em análise": ${statusDesconhecido.join(", ")}`);
    console.log("\nlinha do tempo (recebidas / renovadas / não renovadas)" + (produto === "re" ? " × painel /ramos-elementares (renovações da competência / efetivadas)" : ""));
    for (const mes of Object.keys(porMes).sort()) {
      const p = porMes[mes];
      const ref = produto === "re" ? refRe.get(mes) : undefined;
      console.log(`  ${mes}: ${p.recebidas} / ${p.renovadas} / ${p.nao_renovadas}${ref ? `   painel: ${ref.renovacoesEntradas ?? ref.renovacoesCompetencia ?? "—"} / ${ref.renovacoesEfetivadas ?? "—"}` : ""}`);
    }
    if (!gravar) continue;

    // Nomes de imobiliária entram na base única (a ligação com a ficha é do cron de vínculos).
    const fonteVinculo = produto === "fianca" ? "planilha_fianca" : "planilha_re";
    const nomes = [...new Set(lotes.flatMap((l) => l.registros.map((r) => r.imobiliaria_texto as string | null)).filter((n): n is string => !!n))];
    for (let i = 0; i < nomes.length; i += 500) {
      const { error } = await sb
        .from("imobiliaria_registros_fonte")
        .upsert(nomes.slice(i, i + 500).map((n) => ({ fonte: fonteVinculo, chave_externa: n, nome_original: n })), { onConflict: "fonte,chave_externa", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    for (const l of lotes) {
      const totaisImportados: Record<string, number> = {};
      for (const r of l.registros) totaisImportados[r.status_padrao] = (totaisImportados[r.status_padrao] ?? 0) + 1;
      const { data: imp, error } = await sb
        .from("base_unica_importacoes")
        .upsert(
          {
            arquivo_id: l.arquivoId, arquivo_nome: l.arquivoNome, aba: l.aba, produto, layout: l.layout, competencia: l.comp,
            linhas_lidas: linhas.filter((x) => x.arquivoId === l.arquivoId).length, linhas_importadas: l.registros.length, descartes: {},
            totais_planilha: l.totaisPlanilha, totais_importados: totaisImportados, confere: null,
            observacao: l.observacao ?? "renovações: sem quadro de totais na planilha; conferido com o retrato do painel do produto",
            importado_em: new Date().toISOString(),
          },
          { onConflict: "arquivo_id,aba" }
        )
        .select("id")
        .single();
      if (error) throw new Error("importacoes: " + error.message);
      // Re-rodável: apaga o que esta importação gravou antes (falha aqui para tudo).
      const { error: eDel } = await sb.from("producao_unificada").delete().eq("importacao_id", imp.id);
      if (eDel) throw new Error("apagar importação anterior: " + eDel.message);
      const regs = l.registros.map((r) => ({ ...r, importacao_id: imp.id }));
      for (let i = 0; i < regs.length; i += 500) {
        const { error: e2 } = await sb.from("producao_unificada").insert(regs.slice(i, i + 500));
        if (e2) throw new Error("producao_unificada: " + e2.message);
      }
      console.log(`gravado: ${l.comp} ${l.aba} → ${regs.length} linhas`);
    }
  }
  if (!gravar) return console.log("\n(simulação — nada gravado; use --gravar)");
  const { error } = await sb.rpc("atualizar_producao_painel", { p_forcar: true });
  if (error) throw new Error("atualizar painel: " + error.message);
  console.log("resumo do painel remontado.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
