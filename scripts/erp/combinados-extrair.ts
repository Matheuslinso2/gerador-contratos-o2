// Extrai os "combinados" de cadastro (comissão, repasse, pró-labore, vigência, plano) das mensagens das tarefas CADASTRO do Bitrix,
// lendo o ÍNDICE LOCAL da sessão da baixa (cópia do tarefas-indice.jsonl) — não relê o Bitrix. NUNCA guarda o texto bruto da mensagem.
// Ensaio por padrão (só conta e mostra amostra mascarada); --gravar grava em erp_combinados_cadastro (supabase/erp_combinados_cadastro.sql).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/combinados-extrair.ts <indice.jsonl> [--desde 2025-01-01] [--gravar]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";

const arq = process.argv[2]; if (!arq) throw new Error("informe o indice.jsonl");
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const desde = arg("desde") ?? "2025-01-01";

const iso = (d: string) => d.split("/").reverse().join("-");
const PLANOS = /\b(PORTO|POTTENCIAL|TOKIO|TOO|YELUM|LIBERTY|ALFA|SUHAI|HDI|SOMPO|BRASILCAP|ALLIANZ|ZURICH|ICATU|AZUL|SUL ?AM[EÉ]RICA|MAPFRE)\b/i;
type Comb = Record<string, unknown>;

/** Uma mensagem de cadastro -> dados estruturados (o texto não é guardado). null = mensagem sem dados (aviso do sistema, "FINALIZADO", só nome de arquivo). */
function lerMsg(texto: string): Comb | null {
  const t = texto.replace(/\r/g, "");
  if (/^\s*\[USER=\d+\]/.test(t) || /\[TIMESTAMP=|\[URL=\/company/.test(t)) return null;
  const linhas = t.split("\n").map((l) => l.trim()).filter((l) => l && !/^=+$/.test(l));
  if (!linhas.length) return null;
  const campo = (re: RegExp) => { for (const l of linhas) { const m = re.exec(l); if (m) return m[1].trim(); } return null; };
  const pct = (s: string | null) => { const m = s ? /(\d+(?:[.,]\d+)?)\s*%/.exec(s) : null; return m ? Number(m[1].replace(",", ".")) : null; };
  const rs = (s: string | null) => { const m = s ? /R\$\s*([\d.]+(?:,\d{2})?)/.exec(s) : null; return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null; };
  const comLinha = campo(/^COMISS[AÃ]O\s*:?\s*(.+)$/i);
  const repLinha = campo(/^REPASSE\b[^:\d]*:?\s*(.+)$/i);
  const plLinhas = linhas.filter((l) => /PR[OÓ][\s-]?LABORE/i.test(l)).join(" | ");
  const plSem = /\bSEM\s+PR[OÓ][\s-]?LABORE/i.test(plLinhas);
  const vig = /VIG[EÊ]NCIA[^0-9]*(\d{2}\/\d{2}\/\d{4})\s*(?:A|a|-|AT[EÉ])?\s*(?:a\s*)?(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  const seg = campo(/^SEG:?\s*(\d+)/i) ?? campo(/^PROPOSTA:?\s*(\d+)/i);
  const primeira = linhas[0];
  const partes = primeira.split(/\s+-\s+/).map((x) => x.trim());
  const nome = /^(COMISS|REPASSE|CONTRATA|IMOBILI|SEG:|VIG|OBS|\*)/i.test(primeira) || /^\d+$/.test(partes[0]) ? null : partes[0] || null;
  const imobCampo = campo(/^IMOBILI[AÁ]RIA\s*:\s*(.+)$/i);
  const imobPrimeira = partes.slice(1).filter((x) => !/^(NOVOS?|RENOVA[CÇ][AÃ]O|\d+ ITENS?)$/i.test(x)).join(" - ") || null;
  const endossoNum = campo(/^NUMERO ENDOSSO:?\s*(\S+)/i) ?? campo(/^N[ºO°]? ?ENDOSSO:?\s*(\S+)/i);
  const endossoData = /DATA DO ENDOSSO:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  const locatario = campo(/^LOCAT[AÁ]RIOS?:\s*(.+)$/i);
  const plano = [...linhas].reverse().find((l) => PLANOS.test(l) && !/^(E-?MAIL|ASSUNTO|RE:|OBS)/i.test(l) && l.length < 60) ?? null;
  const itens = /(\d+)\s+ITENS?/i.exec(primeira);
  const c = {
    segurado_nome: (locatario ?? nome)?.slice(0, 120) ?? null,
    imobiliaria_nome: (imobCampo ?? imobPrimeira)?.slice(0, 80) ?? null,
    seg_numero: seg, vigencia_ini: vig ? iso(vig[1]) : null, vigencia_fim: vig ? iso(vig[2]) : null,
    seguradora_plano: plano, comissao_pct: pct(comLinha), repasse_pct: pct(repLinha), repasse_valor: rs(repLinha),
    sem_repasse: /\bSEM REPASSE\b/i.test(t),
    pro_labore_status: plLinhas ? (plSem ? "sem" : "com") : null,
    pro_labore_pct: plLinhas && !plSem ? pct(plLinhas) : null,
    pro_labore_valor: plLinhas && !plSem ? rs(plLinhas) : null,
    valor_premio: rs(campo(/^VALOR:?\s*(.+)$/i)),
    numero_endosso: endossoNum, data_endosso: endossoData ? iso(endossoData[1]) : null, n_itens: itens ? Number(itens[1]) : null,
  };
  // só vale se trouxe algum dado de cadastro além do nome
  const tem = c.comissao_pct != null || c.repasse_pct != null || c.repasse_valor != null || c.vigencia_ini || c.seg_numero || c.numero_endosso || c.pro_labore_status || c.sem_repasse;
  return tem ? c : null;
}

const setorDe = (titulo: string) => {
  const t = titulo.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [k, re] of [["ENDOSSO", /ENDOSS/], ["RENOVACAO", /RENOVA/], ["CAPITALIZACAO", /CAPITALIZA|\bCAP\b/], ["FIANCA", /FIANCA/], ["INCENDIO", /INCENDIO/], ["DEMAIS_RAMOS", /DEMAIS RAMOS/]] as const) if (re.test(t)) return k;
  return "OUTRO";
};

(async () => {
  const linhas = fs.readFileSync(arq, "utf8").split("\n").filter(Boolean);
  const out: Comb[] = [];
  let tarefas = 0, msgs = 0, ignoradas = 0;
  for (const l of linhas) {
    let o: any; try { o = JSON.parse(l); } catch { continue; }
    if (!/^\s*CADASTRO\b/i.test(o.titulo ?? "") || /TESTE|NOVO CLIENTE|LEAD #/i.test(o.titulo)) continue;
    if ((o.criada ?? "") < desde) continue;
    tarefas++;
    for (const m of o.mensagens ?? []) {
      msgs++;
      const c = lerMsg(String(m.texto ?? ""));
      if (!c) { ignoradas++; continue; }
      out.push({ tarefa_id: o.tarefa, mensagem_id: m.id, data_mensagem: m.data ?? null, setor: setorDe(o.titulo), titulo_tarefa: String(o.titulo).slice(0, 120), ...c, n_arquivos: 0, fonte: "tarefa Bitrix", nivel: 3, lido_em: new Date().toISOString() });
    }
  }
  const n = (f: (x: any) => boolean) => out.filter(f).length;
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: tarefas ${tarefas} | mensagens ${msgs} | combinados ${out.length} | sem dados de cadastro ${ignoradas}`);
  console.log(`com nome ${n((x) => x.segurado_nome)} | imobiliária ${n((x) => x.imobiliaria_nome)} | comissão % ${n((x) => x.comissao_pct != null)} | vigência ${n((x) => x.vigencia_ini)} | SEG/proposta ${n((x) => x.seg_numero)} | plano ${n((x) => x.seguradora_plano)} | repasse % ${n((x) => x.repasse_pct != null)} | repasse R$ ${n((x) => x.repasse_valor != null)} | sem repasse ${n((x) => x.sem_repasse)} | endosso ${n((x) => x.numero_endosso)}`);
  console.log(`pró-labore: com ${n((x) => x.pro_labore_status === "com")} (com % ${n((x) => x.pro_labore_status === "com" && x.pro_labore_pct != null)}) | sem ${n((x) => x.pro_labore_status === "sem")}`);
  const porSetor = new Map<string, number>(); for (const x of out) porSetor.set(String(x.setor), (porSetor.get(String(x.setor)) ?? 0) + 1);
  console.log("por setor:", [...porSetor].map(([k, v]) => `${k} ${v}`).join(" | "));
  if (!GRAVAR) {
    const mascara = (s: unknown) => (s ? String(s).split(" ")[0] + " …" : "-");
    for (const x of out.filter((_, i) => i % Math.ceil(out.length / 12) === 0).slice(0, 12)) console.log(`  ${x.setor} | ${mascara(x.segurado_nome)} | ${String(x.imobiliaria_nome ?? "-").slice(0, 18)} | SEG ${x.seg_numero ? "****" : "-"} | vig ${x.vigencia_ini ?? "-"}→${x.vigencia_fim ?? "-"} | ${String(x.seguradora_plano ?? "-").slice(0, 14)} | com ${x.comissao_pct ?? "-"} | rep ${x.repasse_pct ?? x.repasse_valor ?? "-"} | PL ${x.pro_labore_status ?? "-"} ${x.pro_labore_pct ?? ""}`);
    return;
  }
  const sb = createServiceClient();
  for (let i = 0; i < out.length; i += 200) {
    const { error } = await sb.from("erp_combinados_cadastro").upsert(out.slice(i, i + 200), { onConflict: "tarefa_id,mensagem_id" });
    if (error) throw new Error(error.message);
  }
  console.log(`gravados ${out.length}`);
})();
