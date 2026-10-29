// Substitui a planilha de itens anexada nos cards do funil Renovações (SPA 1046 cat 34) por uma versão com as colunas novas
// "RENOVA?" (Renova / Não renova) e "% COMISSÃO" (Matheus 29/10). Só mexe em planilha AINDA NÃO PREENCHIDA (sem PARCELAS (X), VALOR 2026 ou
// decisão); se a equipe já preencheu algo, pula e avisa. Mantém todas as linhas e colunas existentes; os outros anexos do card ficam como estão.
// Ensaio por padrão. uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/substituir-planilhas-lote.ts [--card N] [--gravar]
process.loadEnvFile(".env.local");
import * as XLSX from "xlsx";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const CARD = arg("card");
const base = (process.env.BITRIX_WEBHOOK_URL ?? "").replace(/\/$/, "");
const CAMPO = "ufCrm12PlanilhaItens";
type Arq = { id: number; urlMachine: string };
type Card = { id: number; title: string; stageId: string; ufCrm12ReferenciaPlanilha?: string; [CAMPO]?: Arq[] | null };

const NOVAS = ["RENOVA?", "% COMISSÃO"] as const;
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

async function bitrix(metodo: string, corpo: unknown) {
  const r = await fetch(`${base}/${metodo}.json`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  return r.json() as Promise<{ result?: unknown; error?: string; error_description?: string }>;
}

/** Devolve a planilha nova (Buffer) ou o motivo de não mexer. */
function acrescentarColunas(buf: Buffer): { novo: Buffer; linhas: number } | { pular: string } {
  const wb = XLSX.read(buf);
  const nome = wb.SheetNames.find((n) => {
    const r = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[n], { defval: "" });
    return r.length && Object.keys(r[0]).some((h) => sem(h) === "APOLICE");
  });
  if (!nome) return { pular: "sem aba de itens" };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nome], { defval: "" });
  const cab = Object.keys(rows[0]);
  if (cab.some((h) => sem(h) === "RENOVA?")) return { pular: "já tem a coluna RENOVA?" };
  const preenchida = rows.some((r) => cab.some((h) => /^(PARCELAS \(X\)|VALOR 2026|ORCAMENTO)$/.test(sem(h)) && String(r[h] ?? "").trim() !== ""));
  if (preenchida) return { pular: "equipe já preencheu parcelas/valor/orçamento" };
  // ordem: RENOVA? logo depois de STATUS; % COMISSÃO logo depois de ORÇAMENTO (antes de CM)
  const colunas: string[] = [];
  for (const h of cab) {
    colunas.push(h);
    if (sem(h) === "STATUS") colunas.push("RENOVA?");
    if (sem(h) === "ORCAMENTO") colunas.push("% COMISSÃO");
  }
  for (const n of NOVAS) if (!colunas.includes(n)) colunas.push(n);
  const linhas = rows.map((r) => Object.fromEntries(colunas.map((c) => [c, r[c] ?? ""])));
  const ws = XLSX.utils.json_to_sheet(linhas, { header: colunas });
  ws["!cols"] = colunas.map((c) => ({ wch: Math.min(40, Math.max(10, c.length + 2)) }));
  const novoWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(novoWb, ws, nome);
  return { novo: XLSX.write(novoWb, { type: "buffer", bookType: "xlsx" }) as Buffer, linhas: rows.length };
}

(async () => {
  const cards: Card[] = [];
  const filtro = CARD ? `filter[id]=${CARD}` : "filter[categoryId]=34";
  for (let start = 0; ; ) {
    const r = await (await fetch(`${base}/crm.item.list.json?entityTypeId=1046&${filtro}&start=${start}`)).json();
    cards.push(...(r.result?.items ?? []));
    if (r.next === undefined) break;
    start = r.next;
  }
  console.log(`${cards.length} card(s) · ${GRAVAR ? "GRAVANDO" : "ENSAIO"}`);
  let trocados = 0, pulados = 0;
  for (const c of cards) {
    const arqs = c[CAMPO] ?? [];
    let alvo: { arq: Arq; res: { novo: Buffer; linhas: number } } | null = null;
    let motivo = "sem planilha de itens";
    for (const a of arqs) {
      const buf = Buffer.from(await (await fetch(a.urlMachine)).arrayBuffer());
      let r; try { r = acrescentarColunas(buf); } catch { continue; }
      if ("pular" in r) { motivo = r.pular; continue; }
      alvo = { arq: a, res: r }; break;
    }
    if (!alvo) { pulados++; console.log(`card ${c.id} ${c.title.slice(0, 48)} · pulado: ${motivo}`); continue; }
    if (!GRAVAR) { trocados++; console.log(`card ${c.id} ${c.title.slice(0, 48)} · ${alvo.res.linhas} itens · trocaria o arquivo ${alvo.arq.id}`); continue; }
    // mantém os outros anexos (por id) e troca só a planilha de itens
    const nome = `${(c.ufCrm12ReferenciaPlanilha || c.title).replace(/[\\/:*?"<>|]/g, " ").slice(0, 120)}.xlsx`;
    const novosAnexos: unknown[] = arqs.filter((a) => a.id !== alvo!.arq.id).map((a) => ({ id: a.id }));
    novosAnexos.push([nome, alvo.res.novo.toString("base64")]);
    const resp = await bitrix("crm.item.update", { entityTypeId: 1046, id: c.id, fields: { [CAMPO]: novosAnexos } });
    if (resp.error) { console.log(`card ${c.id} · ERRO ${resp.error}: ${resp.error_description}`); continue; }
    // confere: o card ficou com o mesmo número de anexos e a nova planilha tem as colunas
    const dep = await (await fetch(`${base}/crm.item.get.json?entityTypeId=1046&id=${c.id}`)).json();
    const novos = (dep.result?.item?.[CAMPO] ?? []) as Arq[];
    console.log(`card ${c.id} ${c.title.slice(0, 48)} · trocado: ${arqs.length} → ${novos.length} anexos`);
    trocados++;
  }
  console.log(`\n${trocados} ${GRAVAR ? "trocados" : "a trocar"} · ${pulados} pulados`);
})();
