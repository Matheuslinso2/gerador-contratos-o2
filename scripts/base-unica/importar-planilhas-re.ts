// Base Única — cotações de NEGÓCIO NOVO de Ramos Elementares (e Automóvel,
// que o setor de RE controlava na mesma planilha) das planilhas mensais
// "COTAÇÃO DIÁRIA RE", jul/2025 → ago/2026 (a partir de set/2026 os negócios
// novos estão no Bitrix — ver bitrixProdutos.ts).
// jul/2026 → ago/2026: mesma leitura do painel /ramos-elementares
// (lerFonteRamosElementares + mapearNovos), conferida com o próprio cálculo do
// painel. jul/2025 → jun/2026: formatos antigos que o painel não lê, pelas
// cópias congeladas (_re-planilhas-antigas.ts), com as mesmas normalizações;
// conferidos com o quadro de totais da própria planilha.
// Linha do tempo: aba NOVOS MÊS = entrada; NOVOS PENDENTES = a mesma cotação
// herdada do mês anterior (herança, como nas planilhas de Fiança). O caso é
// ligado entre os meses por imobiliária + segurado + data recebida + ramo.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/importar-planilhas-re.ts [--gravar]
process.loadEnvFile(".env.local");
import crypto from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { lerFonteRamosElementares } from "@/lib/ramos-elementares/fonteGoogle";
import { mapearNovos, montarAnaliseRamosElementares } from "@/lib/ramos-elementares/analise";
import { lerPlanilhasAntigasRE } from "./_re-planilhas-antigas";

const gravar = process.argv.includes("--gravar");
const INICIO = "2026-07"; // daqui em diante pelo leitor do painel; antes, planilhas antigas
const FIM = "2026-08";
const somarMes = (m: string, n: number) => {
  const [a, mm] = m.split("-").map(Number);
  const t = a * 12 + mm - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const statusPadrao = (s: string) =>
  s === "EFETIVADO" ? "Convertido" : ["NÃO EFETIVADO", "CANCELADO", "SEM PARCERIA"].includes(s) ? "Perdido" : "Em análise";
const isoSerial = (n: number | null) => {
  if (n == null || !Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
};

async function main() {
  const sb = createServiceClient();
  const conferencia: string[] = [];
  const porMes: { comp: string; arquivoId: string; arquivoNome: string; linhas: Record<string, unknown>[]; ref: { novas: number; efetivados: number } }[] = [];
  const primeiraConversao = new Map<string, string>();
  type Reg = { status: string; imobiliaria: string; segurado: string; dataRecebida: number | null; ramo: string; seguradora: string; premioTotal: number; comissao: number; dataEfetivacao: number | null; aba: string; linha: number; cotador: string; origem?: string; negociador?: string };
  const montar = (r: Reg, herdada: boolean, comp: string, arquivoId: string, vistos: Map<string, number>) => {
    const base = [r.imobiliaria, r.segurado, r.dataRecebida, r.ramo].join("|").toUpperCase();
    const n = (vistos.get(`${herdada}|${base}`) ?? 0) + 1;
    vistos.set(`${herdada}|${base}`, n);
    const chave = crypto.createHash("sha1").update(`re|${base}|${n}`).digest("hex");
    const produto = r.ramo === "AUTOMÓVEL" ? "automovel" : "re";
    const sp = statusPadrao(r.status);
    if (sp === "Convertido" && !primeiraConversao.has(chave)) primeiraConversao.set(chave, comp);
    return {
      produto,
      tipo: "novo",
      fonte: "planilha",
      origem_arquivo_id: arquivoId,
      origem_aba: r.aba,
      origem_linha: r.linha,
      competencia_arquivo: comp,
      herdada,
      chave_caso: chave,
      data_recebimento: isoSerial(r.dataRecebida),
      data_efetivacao: isoSerial(r.dataEfetivacao),
      status_original: r.status,
      status_padrao: sp,
      ramo_original: r.ramo,
      ramo_padrao: r.ramo,
      seguradora: r.seguradora && r.seguradora !== "NÃO INFORMADA" ? r.seguradora : null,
      imobiliaria_texto: produto === "re" && r.imobiliaria && r.imobiliaria !== "NÃO INFORMADA" ? r.imobiliaria : null,
      fonte_vinculo: produto === "re" ? "planilha_re" : null,
      responsavel: r.cotador || null,
      premio: sp === "Convertido" && r.premioTotal ? r.premioTotal : null,
      comissao: sp === "Convertido" && r.comissao ? r.comissao : null,
      extras: { origem: r.origem ?? null, negociador: r.negociador || null } as Record<string, unknown>,
    } as Record<string, unknown>;
  };
  // jul/2025 → jun/2026: formatos antigos (cópias congeladas). Herdada = data de
  // recebimento em mês anterior ao da planilha.
  for (const p of await lerPlanilhasAntigasRE(INICIO)) {
    const vistos = new Map<string, number>();
    const linhas = p.linhas.map((r) => {
      const mesRecebida = r.dataRecebida == null ? null : isoSerial(r.dataRecebida)?.slice(0, 7) ?? null;
      return montar(r, !!mesRecebida && mesRecebida < p.comp, p.comp, p.arquivoId, vistos);
    });
    const st: Record<string, number> = {};
    for (const l of p.linhas) st[l.status] = (st[l.status] ?? 0) + 1;
    conferencia.push(`${p.comp}: ${linhas.length} linhas (${linhas.filter((l) => l.herdada).length} herdadas) ${JSON.stringify(st)} | totais da planilha: ${p.totais.join("; ") || "—"} | ${p.nome.trim()}`);
    porMes.push({ comp: p.comp, arquivoId: p.arquivoId, arquivoNome: p.nome.trim(), linhas, ref: { novas: -1, efetivados: -1 } });
  }
  for (let comp = INICIO; comp <= FIM; comp = somarMes(comp, 1)) {
    let fonte;
    try {
      fonte = await lerFonteRamosElementares(comp);
    } catch (e) {
      conferencia.push(`${comp}: NÃO LIDO — ${(e as Error).message}`);
      continue;
    }
    // O cálculo do painel quebra em mês com data inválida na planilha (achado
    // 21/10/2026): aí a conferência fica sem a referência do painel.
    let ref: { novas: number; pendentes: number; efetivados: number } | null = null;
    try {
      const a = montarAnaliseRamosElementares(fonte);
      ref = { novas: a.visaoGeral.novasEntradas, pendentes: a.visaoGeral.pendenciasAnteriores, efetivados: a.visaoGeral.novosEfetivados };
    } catch (e) {
      conferencia.push(`${comp}: o cálculo do painel de RE falha nesta planilha (${(e as Error).message})`);
    }
    const pend = mapearNovos(fonte.abas.novosPendentes, fonte.nomesAbas.novosPendentes || "NOVOS PENDENTES");
    const mes = mapearNovos(fonte.abas.novosMes, fonte.nomesAbas.novosMes || "NOVOS MÊS", comp);
    const vistos = new Map<string, number>();
    const linhas: Record<string, unknown>[] = [];
    for (const [r, herdada] of [...mes.map((r) => [r, false] as const), ...pend.map((r) => [r, true] as const)]) linhas.push(montar(r, herdada, comp, fonte.planilha.id, vistos));
    const efetivadosMes = linhas.filter((l) => l.status_padrao === "Convertido").length;
    conferencia.push(
      `${comp}: novos ${mes.length} (painel ${ref?.novas ?? "—"}) | pendentes ${pend.length} (painel ${ref?.pendentes ?? "—"}) | efetivados na planilha ${efetivadosMes} (painel ${ref?.efetivados ?? "—"}) | ${fonte.planilha.titulo}`
    );
    porMes.push({ comp, arquivoId: fonte.planilha.id, arquivoNome: fonte.planilha.titulo, linhas, ref: { novas: ref?.novas ?? -1, efetivados: ref?.efetivados ?? -1 } });
  }
  // Pendência herdada de um mês que não foi lido (jun/2026 para trás): a
  // entrada aconteceu antes — não conta como entrada no mês em que aparece.
  const comEntrada = new Set(porMes.flatMap((p) => p.linhas.filter((l) => !l.herdada).map((l) => l.chave_caso)));
  for (const p of porMes)
    for (const l of p.linhas) if (l.herdada && !comEntrada.has(l.chave_caso)) l.extras = { ...(l.extras as object), sem_entrada: true };
  console.log(conferencia.join("\n"));
  // Conversões que a linha do tempo conta por mês (1ª planilha em que a cotação aparece EFETIVADO).
  const convPorMes: Record<string, number> = {};
  for (const m of primeiraConversao.values()) convPorMes[m] = (convPorMes[m] ?? 0) + 1;
  console.log("\nconversões na linha do tempo (1ª vez EFETIVADO):", convPorMes);
  const casos = new Set(porMes.flatMap((p) => p.linhas.map((l) => l.chave_caso)));
  const herdadasSemOrigem = porMes.flatMap((p) => p.linhas.filter((l) => l.herdada)).filter((l) => !porMes.some((p) => p.linhas.some((x) => !x.herdada && x.chave_caso === l.chave_caso))).length;
  console.log(`casos: ${casos.size} | linhas herdadas sem a entrada achada no mês anterior: ${herdadasSemOrigem}`);
  if (!gravar) return console.log("\n(simulação — nada gravado; use --gravar)");

  // Nomes de imobiliária da planilha entram na base única (a ligação com a ficha é do cron de vínculos).
  const nomes = [...new Set(porMes.flatMap((p) => p.linhas.map((l) => l.imobiliaria_texto as string | null)).filter((n): n is string => !!n))];
  for (let i = 0; i < nomes.length; i += 500) {
    const { error } = await sb
      .from("imobiliaria_registros_fonte")
      .upsert(nomes.slice(i, i + 500).map((n) => ({ fonte: "planilha_re", chave_externa: n, nome_original: n })), { onConflict: "fonte,chave_externa", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  for (const p of porMes) {
    await sb.from("base_unica_planilhas_congeladas").upsert({ arquivo_id: p.arquivoId, nome: p.arquivoNome, pasta: "Cotação diária RE", mime_type: "application/vnd.google-apps.spreadsheet" }, { onConflict: "arquivo_id", ignoreDuplicates: true });
    const { data: imp, error } = await sb
      .from("base_unica_importacoes")
      .upsert(
        {
          arquivo_id: p.arquivoId,
          arquivo_nome: p.arquivoNome,
          aba: "NOVOS",
          produto: "re",
          layout: "re_cotacao_diaria",
          competencia: p.comp,
          linhas_lidas: p.linhas.length,
          linhas_importadas: p.linhas.length,
          descartes: {},
          totais_planilha: p.ref,
          totais_importados: { novos: p.linhas.filter((l) => !l.herdada).length, efetivados: p.linhas.filter((l) => l.status_padrao === "Convertido").length },
          confere: p.linhas.filter((l) => !l.herdada).length === p.ref.novas,
          importado_em: new Date().toISOString(),
        },
        { onConflict: "arquivo_id,aba" }
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { error: eDel } = await sb.from("producao_unificada").delete().eq("importacao_id", imp.id);
    if (eDel) throw new Error(eDel.message);
    for (let i = 0; i < p.linhas.length; i += 500) {
      const { error: e2 } = await sb.from("producao_unificada").insert(p.linhas.slice(i, i + 500).map((l) => ({ ...l, importacao_id: imp.id })));
      if (e2) throw new Error(e2.message);
    }
  }
  const { error: ep } = await sb.rpc("atualizar_producao_painel", { p_forcar: true });
  if (ep) throw new Error(ep.message);
  console.log("\ngravado.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
