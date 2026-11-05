// Carrega o que o portal da Porto (Corretor Online > Meus Clientes, CFU15J, clientes vigentes) traz de produtos/apólices: Nº, emissão, início e fim de vigência, status.
// Fonte 'portal_seguradora', nível 1. Unicidade de erp_portal_apolices é global (seguradora + nº + seq): só entram números novos; nos já existentes completa-se a vigência.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/_tmp-porto-meus-clientes.ts "<json>" [--gravar]
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

type Item = { codigoPessoa: number; cpfCnpj: string; nome: string; susep: string; codProduto: number; produto: string; numeroDocumento: string; emissao: string; ini: string; fim: string; status: string; papel: string };

// "86|746|10571152|" = sucursal|ramo|número|(endosso) -> "746-86-10571152"
const numeroPortal = (nd: string) => {
  const p = nd.split("|");
  if (p.length < 3 || !/^\d+$/.test(p[2])) return null;
  return { numero: `${p[1]}-${p[0]}-${p[2]}`, chave: p[2].replace(/^0+/, ""), seq: p[3] && /^\d+$/.test(p[3]) ? Number(p[3]) : null };
};

(async () => {
  const buf = readFileSync(arquivo);
  const hash = createHash("sha256").update(buf).digest("hex");
  const itens: Item[] = JSON.parse(buf.toString()).itens;
  const porNumero = new Map<string, Item & { n: NonNullable<ReturnType<typeof numeroPortal>>; papeis: Set<string> }>();
  let semNumero = 0;
  for (const i of itens) {
    const n = numeroPortal(i.numeroDocumento);
    if (!n) { semNumero++; continue; }
    const k = `${n.numero}|${n.seq}`;
    const ja = porNumero.get(k);
    if (ja) ja.papeis.add(i.papel); else porNumero.set(k, { ...i, n, papeis: new Set([i.papel]) });
  }
  console.log("linhas:", itens.length, "números distintos:", porNumero.size, "sem número legível:", semNumero);

  // já existentes (qualquer carga)
  const jaTem = new Map<string, { id: string; vigencia_inicio: string | null }>();
  for (let p = 0; ; p++) {
    const { data, error } = await sb.from("erp_portal_apolices").select("id, numero_apolice, emissao_seq, vigencia_inicio").eq("seguradora_id", PORTO).order("id").range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    for (const r of data ?? []) jaTem.set(`${r.numero_apolice}|${r.emissao_seq}`, { id: r.id, vigencia_inicio: r.vigencia_inicio });
    if ((data ?? []).length < 1000) break;
  }
  const novos = [...porNumero.entries()].filter(([k]) => !jaTem.has(k));
  const completar = [...porNumero.entries()].filter(([k]) => jaTem.has(k) && !jaTem.get(k)!.vigencia_inicio);
  console.log("novos:", novos.length, "a completar vigência:", completar.length);

  // ERP: documentos Porto por chave (último trecho)
  const docs: { id: string; numero_apolice: string; situacao: string }[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await sb.from("erp_documentos").select("id, numero_apolice, situacao").in("seguradora_id", [PORTO, PESS]).not("numero_apolice", "is", null).order("id").range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    docs.push(...(data ?? []) as typeof docs);
    if ((data ?? []).length < 1000) break;
  }
  const porChave = new Map<string, typeof docs>();
  for (const d of docs) {
    if (d.situacao === "duplicado") continue;
    const partes = d.numero_apolice.split(/[\s-]+/).filter(Boolean);
    const ks = new Set([partes[partes.length - 1]?.replace(/^0+/, ""), d.numero_apolice.replace(/\D/g, "").replace(/^0+/, "")]);
    for (const k of ks) if (k) porChave.set(k, [...(porChave.get(k) ?? []), d]);
  }
  const res: Record<string, number> = {};
  const linhas = novos.map(([, v]) => {
    const c = porChave.get(v.n.chave) ?? [];
    const st = c.length === 1 ? "vinculado" : c.length > 1 ? "ambiguo" : "sem_documento";
    res[st] = (res[st] ?? 0) + 1;
    return { v, c, st };
  });
  console.log("novos por cruzamento de número:", res);
  if (!GRAVAR) { console.log("ensaio (sem --gravar)"); return; }

  const { data: ja } = await sb.from("erp_portal_cargas").select("id").eq("arquivo_hash", hash).maybeSingle();
  if (ja) { console.log("arquivo já carregado (carga", ja.id, ")"); return; }
  const { data: carga, error: eC } = await sb.from("erp_portal_cargas").insert({
    fonte: "portal_seguradora", nivel_guia: 1, seguradora_id: PORTO, tela: "Meus Clientes (produtos dos clientes vigentes)", filtros: "SUSEP CFU15J; clientes vigentes; todos os produtos (emissão, vigência, status)",
    arquivo: basename(arquivo), arquivo_hash: hash, lido_por: "fork Porto (portal logado pelo Matheus)", linhas: itens.length, status: "lida", observacao: "API cli-search/v1/list, 20 por página. Só inclui números que a carga de Apólices e Contratos ainda não tinha.",
  }).select("id").single();
  if (eC || !carga) throw new Error("carga: " + eC?.message);
  const rows = linhas.map(({ v, c, st }) => ({
    carga_id: carga.id, seguradora_id: v.codProduto === 89 ? PESS : PORTO, numero_apolice: v.n.numero, emissao_seq: v.n.seq, produto: v.produto, segurado: v.nome,
    dt_emissao: v.emissao, vigencia_inicio: v.ini, vigencia_fim: v.fim, tipo_emissao: "emitida", cod_parceiro: v.susep,
    documento_id: st === "vinculado" ? c[0].id : null, vinculo_status: st,
    vinculo_motivo: st === "vinculado" ? "Nº da apólice (último trecho)" : st === "ambiguo" ? `${c.length} documentos com o mesmo número` : "número não achado no ERP",
  }));
  for (let p = 0; p < rows.length; p += 200) {
    const { error } = await sb.from("erp_portal_apolices").insert(rows.slice(p, p + 200));
    if (error) throw new Error("linhas: " + error.message);
  }
  let comp = 0;
  for (const [k, v] of completar) {
    const { error } = await sb.from("erp_portal_apolices").update({ vigencia_inicio: v.ini, vigencia_fim: v.fim }).eq("id", jaTem.get(k)!.id);
    if (!error) comp++;
  }
  console.log("gravado: carga", carga.id, "linhas novas", rows.length, "vigências completadas", comp);
})();
