import type { SupabaseClient } from "@supabase/supabase-js";

// ERP O2 — fase B das faturas (Matheus 26/10/2026): transforma os arquivos já carregados no /faturas do Workspace
// (boleto + relatório) em faturas do ERP com as linhas mês a mês. Uma fatura = imobiliária + seguradora + identidade
// na seguradora; nunca mistura faturas.
//   Tokio: o boleto traz a "apólice-fatura" ("APÓLICE: 460 0000405364") = identidade; o relatório CSV traz as linhas
//          (Ramo;Apólice;Endosso;Segurado;Data de Vencimento;Imóvel;Nº Parcela;Qtd. Parcelas;Prêmio). Boleto e relatório
//          do mesmo mês se casam pelo nome do arquivo ("… LTDA 2.pdf" × "… LTDA 2.csv") ou pelo vencimento.
//   Porto: as linhas vêm no próprio boleto ("086.0746.010668970.000000000 018 22/14502140 217.24 15/04/2025 …").
//          A identidade é o ramo (0746 = Fiança) + a continuidade das apólices de um mês para o outro.
// Não guarda nome de segurado (já está no arquivo de origem); o ERP liga cada linha à apólice pelo número.

type Arquivo = {
  id: string;
  imobiliaria_id: string | null;
  seguradora: string;
  competencia: string;
  vencimento: string | null;
  valor: number | null;
  tipo_documento: string | null;
  arquivo_nome: string | null;
  texto_bruto_extraido: string | null;
};
export type Item = { ramo: string | null; apolice: string; endosso: string | null; parcela_n: number | null; parcelas_total: number | null; valor: number };

const reais = (s: string) => {
  const neg = s.includes("-");
  const n = Number(s.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return (neg ? -1 : 1) * (Number.isFinite(n) ? n : 0);
};
const semZero = (s: string) => s.replace(/^0+/, "") || "0";
/** "RELATÓRIO EXPANSAO … LTDA 2.csv" e "BOLETO EXPANSAO … LTDA 2.pdf" → "expansao … ltda 2" */
const nucleoArquivo = (nome: string | null) =>
  (nome ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.[a-z0-9]+$/, "").replace(/^(relatorio|boleto|demonstrativo)\s+/, "").replace(/\s+/g, " ").trim();

export function lerRelatorioTokio(texto: string): Item[] {
  const itens: Item[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    const c = linha.split(";");
    if (c.length < 9 || !/^\d+$/.test(c[0].trim()) || !/\d/.test(c[1])) continue;
    itens.push({
      ramo: c[0].trim(),
      apolice: semZero(c[1].trim()),
      endosso: c[2].trim() && c[2].trim() !== "0" ? c[2].trim() : null,
      parcela_n: Number(c[6]) || null,
      parcelas_total: Number(c[7]) || null,
      valor: reais(c[8]),
    });
  }
  return itens;
}

export function apoliceFaturaTokio(texto: string): { ramo: string; nr: string } | null {
  const m = texto.match(/AP[ÓO]LICE:\s*(\d+)\s+(\d+)/);
  return m ? { ramo: m[1], nr: semZero(m[2]) } : null;
}

export function lerBoletoPorto(texto: string): Item[] {
  const itens: Item[] = [];
  const re = /\d{3}\.(\d{4})\.(\d{9})\.\d+\s+(\d{1,3})\s+\S+\s+(-?[\d.]+(?:,\d{2})?)\s+\d{2}\/\d{2}\/\d{4}/g;
  for (const m of texto.matchAll(re)) {
    const v = m[4].includes(",") ? reais(m[4]) : Number(m[4]);
    itens.push({ ramo: m[1], apolice: semZero(m[2]), endosso: null, parcela_n: Number(m[3]) || null, parcelas_total: null, valor: v });
  }
  return itens;
}

// Pottencial (relatório .xls lido como texto): "Fatura:,,1000246093", "Pagador:,NOME (15021900)" e linhas
// Código Corretor,CPF,Locatário,Proposta,Apólice(25 díg.),Locador,Vencimento,Parc. n/N,Valor. A apólice do Corp são os 9 últimos dígitos.
function csvLinha(l: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (const ch of l) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
export function lerRelatorioPottencial(texto: string): { pagador: string | null; corretor: string | null; itens: Item[] } {
  const pagador = texto.match(/Pagador:,[^\n]*\((\d+)\)/)?.[1] ?? null;
  const itens: Item[] = [];
  let corretor: string | null = null;
  for (const linha of texto.split(/\r?\n/)) {
    const c = csvLinha(linha);
    if (c.length < 9 || !/^\d{5,}$/.test(c[0].trim()) || !/^\d{12,}$/.test(c[4].trim())) continue;
    corretor ??= c[0].trim();
    const [n, t] = c[7].split("/");
    itens.push({ ramo: c[4].trim().slice(9, 13) || null, apolice: semZero(c[4].trim().slice(-9)), endosso: null, parcela_n: Number(n) || null, parcelas_total: Number(t) || null, valor: Number(c[8].replace(/,/g, "")) || 0 });
  }
  return { pagador, corretor, itens };
}
// Too (relatório PDF): "Ramo 46 - FIANÇA LOCATÍCIA Corretor O2 CAPITALIZACAO E SEGUROS LTDA …" e linhas "1074600156218 R$ 269,94 16 NOME CPF".
export function lerRelatorioToo(texto: string): { ramo: string | null; corretor: string | null; itens: Item[] } {
  const ramo = texto.match(/Ramo\s+(\d+)/)?.[1] ?? null;
  const corretor = /Corretor\s+O2 CAP/i.test(texto) ? "O2 Capitalização" : /Corretor\s+O2/i.test(texto) ? "O2 Corretora" : null;
  const itens: Item[] = [];
  for (const m of texto.matchAll(/(\d{10,15})\s+R\$\s*(-?[\d.]*\d,\d{2})\s+(\d{1,3})\s/g)) itens.push({ ramo, apolice: semZero(m[1]), endosso: null, parcela_n: Number(m[3]) || null, parcelas_total: null, valor: reais(m[2]) });
  return { ramo, corretor, itens };
}
// Yelum (relatório PDF): "143820260021360 78403897/1 NOME … RESID IMOBIIND 2/4 10/10/2026 59,48" (nomes podem quebrar linha).
export function lerRelatorioYelum(texto: string): Item[] {
  const itens: Item[] = [];
  const pos = [...texto.matchAll(/(\d{15})\s+\d+\/\d+\s/g)];
  pos.forEach((m, i) => {
    const trecho = texto.slice(m.index!, pos[i + 1]?.index ?? texto.length);
    const f = trecho.match(/\s(\d{1,3})\/(\d{1,3})\s+\d{2}\/\d{2}\/\d{4}\s+(-?[\d.]*\d,\d{2})/);
    if (f) itens.push({ ramo: m[1].slice(0, 4), apolice: semZero(m[1]), endosso: null, parcela_n: Number(f[1]) || null, parcelas_total: Number(f[2]) || null, valor: reais(f[3]) });
  });
  return itens;
}

type Grupo = { seguradora: "TOKIO" | "PORTO" | "POTTENCIAL" | "TOO" | "YELUM"; codigo_corretor?: string | null; corretora?: string | null; imobiliaria_id: string; competencia: string; chaveBase: string; ramo: string | null; vencimento: string | null; valor_boleto: number | null; arquivos: string[]; itens: Item[] };

function montarGrupos(arquivos: Arquivo[]): Grupo[] {
  const grupos: Grupo[] = [];
  const porImobMes = new Map<string, Arquivo[]>();
  for (const a of arquivos) {
    if (!a.imobiliaria_id || !a.texto_bruto_extraido) continue;
    const k = `${a.imobiliaria_id}|${a.competencia}`;
    porImobMes.set(k, [...(porImobMes.get(k) ?? []), a]);
  }
  for (const lista of porImobMes.values()) {
    // Porto: o conteúdo manda (há boletos da Porto rotulados como TOKIO no upload)
    const porto = lista.filter((a) => /\d{3}\.\d{4}\.\d{9}\.\d+\s+\d{1,3}\s/.test(a.texto_bruto_extraido!));
    for (const a of porto) {
      const itens = lerBoletoPorto(a.texto_bruto_extraido!);
      if (!itens.length) continue;
      const ramo = itens[0].ramo;
      grupos.push({ seguradora: "PORTO", imobiliaria_id: a.imobiliaria_id!, competencia: a.competencia, chaveBase: `${ramo}`, ramo, vencimento: a.vencimento, valor_boleto: a.valor, arquivos: [a.id], itens });
    }
    const tokio = lista.filter((a) => a.seguradora === "TOKIO" && !porto.includes(a));
    const relatorios = tokio.filter((a) => /^Ramo;Ap/i.test(a.texto_bruto_extraido!.trim()));
    const boletos = tokio.filter((a) => !relatorios.includes(a) && apoliceFaturaTokio(a.texto_bruto_extraido!));
    const usados = new Set<string>();
    for (const r of relatorios) {
      const nucleo = nucleoArquivo(r.arquivo_nome);
      const b =
        boletos.find((x) => !usados.has(x.id) && nucleoArquivo(x.arquivo_nome) === nucleo) ??
        boletos.find((x) => !usados.has(x.id) && x.vencimento && x.vencimento === r.vencimento);
      if (b) usados.add(b.id);
      const af = b ? apoliceFaturaTokio(b.texto_bruto_extraido!) : null;
      const itens = lerRelatorioTokio(r.texto_bruto_extraido!);
      if (!itens.length) continue;
      grupos.push({
        seguradora: "TOKIO",
        imobiliaria_id: r.imobiliaria_id!,
        competencia: r.competencia,
        chaveBase: af ? `${af.ramo}-${af.nr}` : `sem-boleto:${itens[0].ramo}`,
        ramo: af?.ramo ?? itens[0].ramo,
        vencimento: b?.vencimento ?? r.vencimento,
        valor_boleto: b?.valor ?? null,
        arquivos: b ? [r.id, b.id] : [r.id],
        itens,
      });
    }
    for (const seg of ["POTTENCIAL", "TOO", "YELUM"] as const) {
      const daSeg = lista.filter((a) => a.seguradora === seg);
      const bols = daSeg.filter((a) => (a.tipo_documento ?? "") === "boleto");
      const rels = daSeg.filter((a) => (a.tipo_documento ?? "") !== "boleto");
      const usadosB = new Set<string>();
      for (const r of rels) {
        let itens: Item[] = [], chaveBase = "", codigo: string | null = null, corretora: string | null = null, ramo: string | null = null;
        if (seg === "POTTENCIAL") {
          const p = lerRelatorioPottencial(r.texto_bruto_extraido!);
          itens = p.itens; codigo = p.corretor; ramo = itens[0]?.ramo ?? null;
          chaveBase = `${p.pagador ?? "sem-pagador"}-${p.corretor ?? "?"}`;
        } else if (seg === "TOO") {
          const t = lerRelatorioToo(r.texto_bruto_extraido!);
          itens = t.itens; corretora = t.corretor; ramo = t.ramo;
          chaveBase = `${t.ramo ?? "?"}-${t.corretor === "O2 Capitalização" ? "CAP" : t.corretor === "O2 Corretora" ? "COR" : "?"}`;
        } else {
          itens = lerRelatorioYelum(r.texto_bruto_extraido!); ramo = itens[0]?.ramo ?? null;
          chaveBase = ramo ?? "?";
        }
        if (!itens.length) continue;
        const soma = itens.reduce((x, i) => x + i.valor, 0);
        const nucleo = nucleoArquivo(r.arquivo_nome);
        const b =
          bols.find((x) => !usadosB.has(x.id) && nucleoArquivo(x.arquivo_nome) === nucleo) ??
          bols.find((x) => !usadosB.has(x.id) && x.valor !== null && Math.abs(Number(x.valor) - soma) <= 1) ??
          bols.find((x) => !usadosB.has(x.id) && x.vencimento && x.vencimento === r.vencimento);
        if (b) usadosB.add(b.id);
        grupos.push({ seguradora: seg, imobiliaria_id: r.imobiliaria_id!, competencia: r.competencia, chaveBase, ramo, codigo_corretor: codigo, corretora, vencimento: b?.vencimento ?? r.vencimento, valor_boleto: b?.valor ?? null, arquivos: b ? [r.id, b.id] : [r.id], itens });
      }
    }
  }
  return grupos;
}

/** Lê os arquivos de fatura (Tokio e Porto) desde a competência dada e grava faturas, meses e linhas no ERP. */
export async function carregarItensFaturas(sb: SupabaseClient, o: { desde: string }) {
  const arquivos: Arquivo[] = [];
  for (let de = 0; ; de += 500) {
    const { data, error } = await sb
      .from("faturas")
      .select("id, imobiliaria_id, seguradora, competencia, vencimento, valor, tipo_documento, arquivo_nome, texto_bruto_extraido")
      .in("seguradora", ["TOKIO", "PORTO FIANÇA", "PORTO RE", "POTTENCIAL", "TOO", "YELUM"])
      .neq("status", "cancelada")
      .gte("competencia", o.desde)
      .order("competencia")
      .range(de, de + 499);
    if (error) throw new Error(`faturas: ${error.message}`);
    arquivos.push(...((data ?? []) as Arquivo[]));
    if (!data || data.length < 500) break;
  }
  const grupos = montarGrupos(arquivos).sort((a, b) => a.competencia.localeCompare(b.competencia));
  const { data: existentes } = await sb.from("erp_faturas").select("id, seguradora, imobiliaria_id, chave");
  const faturas = new Map((existentes ?? []).map((f) => [`${f.seguradora}|${f.imobiliaria_id}|${f.chave}`, f.id as string]));
  let meses = 0, linhas = 0;
  for (const g of grupos) {
    // Porto: mesma imobiliária e ramo pode ter mais de uma fatura; a do mês continua a fatura que mais divide apólices com ela
    const porContinuidade = g.seguradora === "PORTO" || g.seguradora === "YELUM";
    let chave = porContinuidade ? `${g.chaveBase}#1` : g.chaveBase;
    if (porContinuidade) {
      const candidatas = [...faturas.entries()].filter(([k]) => k.startsWith(`${g.seguradora}|${g.imobiliaria_id}|${g.chaveBase}#`));
      let melhor: { chave: string; comum: number } | null = null;
      // reler é seguro: se este arquivo já foi lido neste mês, fica na mesma fatura
      for (const [k, id] of candidatas) {
        const { data: ja } = await sb.from("erp_fatura_meses").select("id").eq("fatura_id", id).eq("competencia", g.competencia).overlaps("arquivos", g.arquivos).limit(1);
        if (ja?.length) melhor = { chave: k.split("|")[2], comum: Number.MAX_SAFE_INTEGER };
      }
      for (const [k, id] of melhor ? [] : candidatas) {
        const { data: ant } = await sb.from("erp_fatura_meses").select("id, competencia, erp_fatura_itens(apolice)").eq("fatura_id", id).lt("competencia", g.competencia).order("competencia", { ascending: false }).limit(1);
        const aps = new Set(((ant?.[0] as unknown as { erp_fatura_itens: { apolice: string }[] } | undefined)?.erp_fatura_itens ?? []).map((i) => i.apolice));
        const comum = g.itens.filter((i) => aps.has(i.apolice)).length;
        if (comum > 0 && (!melhor || comum > melhor.comum)) melhor = { chave: k.split("|")[2], comum };
      }
      if (melhor) chave = melhor.chave;
      else if (candidatas.length) {
        // já existe fatura desse ramo no mesmo mês? então é outra fatura (#2, #3…)
        const ocupadas = new Set<string>();
        for (const [k, id] of candidatas) {
          const { data: m } = await sb.from("erp_fatura_meses").select("id").eq("fatura_id", id).eq("competencia", g.competencia).limit(1);
          if (m?.length) ocupadas.add(k.split("|")[2]);
        }
        let n = 1;
        while (ocupadas.has(`${g.chaveBase}#${n}`)) n++;
        chave = `${g.chaveBase}#${n}`;
      }
    }
    const kf = `${g.seguradora}|${g.imobiliaria_id}|${chave}`;
    let faturaId = faturas.get(kf);
    if (!faturaId) {
      const { data, error } = await sb.from("erp_faturas").insert({ seguradora: g.seguradora, imobiliaria_id: g.imobiliaria_id, chave, ramo: g.ramo, codigo_corretor: g.codigo_corretor ?? null, corretora: g.corretora ?? null }).select("id").single();
      if (error) throw new Error(`erp_faturas: ${error.message} (${kf})`);
      faturaId = data.id as string;
      faturas.set(kf, faturaId);
    }
    const { data: mes, error: e2 } = await sb
      .from("erp_fatura_meses")
      .upsert(
        { fatura_id: faturaId, competencia: g.competencia, vencimento: g.vencimento, valor_boleto: g.valor_boleto, qtd_itens: g.itens.length, valor_itens: Math.round(g.itens.reduce((s, i) => s + i.valor, 0) * 100) / 100, arquivos: g.arquivos, lido_em: new Date().toISOString() },
        { onConflict: "fatura_id,competencia" }
      )
      .select("id")
      .single();
    if (e2) throw new Error(`erp_fatura_meses: ${e2.message}`);
    await sb.from("erp_fatura_itens").delete().eq("fatura_mes_id", mes.id);
    const { error: e3 } = await sb.from("erp_fatura_itens").insert(g.itens.map((i) => ({ ...i, fatura_mes_id: mes.id })));
    if (e3) throw new Error(`erp_fatura_itens: ${e3.message}`);
    meses++;
    linhas += g.itens.length;
  }
  const { data: ligados } = await sb.rpc("erp_ligar_itens_fatura");
  return { arquivos: arquivos.length, meses, linhas, ligados };
}
