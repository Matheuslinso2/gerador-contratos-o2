// Carrega o que o portal da Porto (Corretor Online > Apólices e Contratos, todas as SUSEPs) mostra de emitidas e canceladas de 01/09 a 05/11/2026
// e cruza pelo Nº da apólice com o ERP. Fonte 'portal_seguradora', nível 1 do guia. Cada arquivo = uma carga (hash), desfazível.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/_tmp-porto-apolices-set-nov.ts "<json>" [--gravar]
process.loadEnvFile(".env.local");
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const arquivo = process.argv[2];
const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();
const PORTO = "6210f103-6bdb-421a-a39b-4795f29d9b20";
const PESS = "490b1be6-4564-492a-8891-d6e1018941c2";

type Item = { tipo: string; janela: string; apolice: string; nome: string; produto: string; susep: string; data: string; status: string };
const dataBr = (s: string) => { const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const chaveDe = (n: string) => { const p = n.split("-"); return p.length >= 3 && /^\d+$/.test(p[2]) ? p[2].replace(/^0+/, "") : null; };
const seqDe = (n: string) => { const p = n.split("-"); return p.length >= 4 && /^\d+$/.test(p[3]) ? Number(p[3]) : null; };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  const buf = readFileSync(arquivo);
  const hash = createHash("sha256").update(buf).digest("hex");
  const itens: Item[] = JSON.parse(buf.toString()).itens;
  console.log("itens no arquivo:", itens.length);

  // ERP: todos os documentos Porto (Seguro e Essencial) com número
  const docs: { id: string; numero_apolice: string; tipo: string; situacao: string; vigencia_inicio: string | null; seguradora_id: string }[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await sb.from("erp_documentos").select("id, numero_apolice, tipo, situacao, vigencia_inicio, seguradora_id").in("seguradora_id", [PORTO, PESS]).not("numero_apolice", "is", null).order("id").range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    docs.push(...(data ?? []) as typeof docs);
    if ((data ?? []).length < 1000) break;
  }
  const porChave = new Map<string, typeof docs>();
  for (const d of docs) {
    const ks = new Set<string>();
    const digs = d.numero_apolice.replace(/\D/g, "");
    const partes = d.numero_apolice.split(/[\s-]+/).filter(Boolean);
    if (partes.length) ks.add(partes[partes.length - 1].replace(/^0+/, ""));
    if (digs) ks.add(digs.replace(/^0+/, ""));
    for (const k of ks) if (k) porChave.set(k, [...(porChave.get(k) ?? []), d]);
  }

  const linhas = itens.map((i) => {
    const k = chaveDe(i.apolice);
    const cands = k ? (porChave.get(k) ?? []).filter((d) => d.situacao !== "duplicado") : [];
    const vincul = k ? (cands.length === 1 ? "vinculado" : cands.length > 1 ? "ambiguo" : "sem_documento") : "sem_documento";
    return { i, k, cands, vincul };
  });
  const res: Record<string, number> = {};
  for (const l of linhas) { const c = `${l.i.tipo} ${l.vincul}`; res[c] = (res[c] ?? 0) + 1; }
  console.log("cruzamento por número:", res);

  if (!GRAVAR) { console.log("ensaio (sem --gravar)"); return; }

  const { data: ja } = await sb.from("erp_portal_cargas").select("id").eq("arquivo_hash", hash).maybeSingle();
  if (ja) { console.log("arquivo já carregado (carga", ja.id, ")"); return; }
  const { data: carga, error: eC } = await sb.from("erp_portal_cargas").insert({
    fonte: "portal_seguradora", nivel_guia: 1, seguradora_id: PORTO, tela: "Apólices e Contratos (Emitidas/Canceladas)", filtros: "todas as SUSEPs; 01/09/2026 a 05/11/2026; janelas de 30 dias",
    arquivo: basename(arquivo), arquivo_hash: hash, lido_por: "fork Porto (portal logado pelo Matheus)", linhas: itens.length, status: "lida", observacao: "Emitidas e canceladas por período. Sem prêmio/vigência na tela: cruzamento pelo Nº da apólice (último trecho).",
  }).select("id").single();
  if (eC || !carga) throw new Error("carga: " + eC?.message);

  // mesmo Nº em Emitidas e em Canceladas: uma linha só, como cancelada (a unicidade da tabela é seguradora + nº + seq)
  const vistos = new Map<string, number>();
  const unicas: typeof linhas = [];
  for (const l of linhas) {
    const k = `${l.i.apolice}|${seqDe(l.i.apolice)}`;
    const at = vistos.get(k);
    if (at === undefined) { vistos.set(k, unicas.length); unicas.push(l); }
    else if (l.i.tipo === "CANCELADA") unicas[at] = { ...l, vincul: l.vincul };
  }
  console.log("linhas únicas:", unicas.length);
  const rows = unicas.map((l) => ({
    carga_id: carga.id, seguradora_id: PORTO, numero_apolice: l.i.apolice, produto: l.i.produto, segurado: l.i.nome,
    dt_emissao: dataBr(l.i.data), emissao_seq: seqDe(l.i.apolice), tipo_emissao: l.i.tipo === "CANCELADA" ? "cancelada" : "emitida",
    cod_parceiro: l.i.susep, documento_id: l.vincul === "vinculado" ? l.cands[0].id : null, vinculo_status: l.vincul,
    vinculo_motivo: l.vincul === "vinculado" ? "Nº da apólice (último trecho)" : l.vincul === "ambiguo" ? `${l.cands.length} documentos com o mesmo número` : "número não achado no ERP",
  }));
  for (let p = 0; p < rows.length; p += 200) {
    const { error } = await sb.from("erp_portal_apolices").insert(rows.slice(p, p + 200));
    if (error) throw new Error("linhas: " + error.message);
  }
  console.log("gravado: carga", carga.id, "linhas", rows.length);
})();
