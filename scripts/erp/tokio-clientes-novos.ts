// Ensaio (SÓ LEITURA): das propostas da Tokio sem apólice, quem é cliente JÁ CADASTRADO e quem é NOVO (criar). Regras:
//  parte ligada ao cadastro (locatario_id) = cadastrada; sem ligação mas com CPF/CNPJ válido já existente em locatarios = só ligar;
//  CPF/CNPJ válido inexistente = NOVO (criar); sem CPF/CNPJ = pendência (com candidatos por nome). 'Histórico' = outros documentos do ERP
//  ou apólices antigas no portal da Tokio com o mesmo CPF.
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
const sb = createServiceClient(); const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
(async () => {
  const props = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "tokio-propostas.json"), "utf8")) as { id: string; codigo_o2: number; ramo: string }[];
  const ids = props.map((p) => p.id); const idsSet = new Set(ids);
  const docs = new Map<string, { origem: string; locatario_id: string | null; ref: string | null }>();
  for (const g of em(ids)) { const { data } = await sb.from("erp_documentos").select("id,origem,locatario_id,origem_ref").in("id", g); for (const d of data ?? []) docs.set(d.id, { origem: d.origem, locatario_id: d.locatario_id, ref: d.origem_ref }); }
  type Parte = { doc: string; papel: string; nome: string | null; cpf: string; loc: string | null };
  const partes: Parte[] = [];
  for (const g of em(ids, 60)) {
    const { data: its } = await sb.from("erp_documento_itens").select("id,documento_id").in("documento_id", g);
    const mapa = new Map((its ?? []).map((i) => [i.id, i.documento_id]));
    for (const g2 of em([...mapa.keys()], 100)) { const { data: ps } = await sb.from("erp_item_partes").select("item_id,papel,nome,documento_numero,locatario_id").in("item_id", g2); for (const p of ps ?? []) partes.push({ doc: mapa.get(p.item_id)!, papel: p.papel, nome: p.nome, cpf: dig(p.documento_numero), loc: p.locatario_id }); }
  }
  for (const [id, d] of docs) if (d.locatario_id) partes.push({ doc: id, papel: "titular", nome: null, cpf: "", loc: d.locatario_id });
  // dados dos locatários ligados e dos CPFs soltos
  const locIds = [...new Set(partes.map((p) => p.loc).filter((x): x is string => !!x))];
  const locs = new Map<string, { cpf: string; nome: string; fonte: string | null; criado: string }>();
  for (const g of em(locIds)) { const { data } = await sb.from("locatarios").select("id,cpf,nome,primeira_fonte,created_at").in("id", g); for (const l of data ?? []) locs.set(l.id, { cpf: dig(l.cpf), nome: l.nome, fonte: l.primeira_fonte, criado: String(l.created_at).slice(0, 10) }); }
  const cpfsSoltos = [...new Set(partes.filter((p) => !p.loc && (p.cpf.length === 11 || p.cpf.length === 14)).map((p) => p.cpf))];
  const existe = new Map<string, string>();
  for (const g of em(cpfsSoltos)) { const { data } = await sb.from("locatarios").select("id,cpf").in("cpf", g); for (const l of data ?? []) existe.set(dig(l.cpf), l.id); }
  // histórico: outros documentos do ERP por locatário
  const hist = new Map<string, number>();
  for (const g of em(locIds)) { const { data } = await sb.from("erp_documentos").select("id,locatario_id").in("locatario_id", g); for (const d of data ?? []) if (!idsSet.has(d.id)) hist.set(d.locatario_id!, (hist.get(d.locatario_id!) ?? 0) + 1); }
  // histórico no portal da Tokio (qualquer apólice, mesmo vencida)
  const portal = new Set<string>(); const f = path.join(os.tmpdir(), "tokio", "consulta-55002.txt");
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split("\n")) { const c = l.split("|")[0]; if (c) portal.add(c); }
  const r: Record<string, number> = {}; const porDoc = new Map<string, string[]>();
  const add = (doc: string, k: string) => { r[k] = (r[k] ?? 0) + 1; (porDoc.get(doc) ?? porDoc.set(doc, []).get(doc)!).push(k); };
  for (const p of partes) {
    if (p.loc) {
      const l = locs.get(p.loc); const h = hist.get(p.loc) ?? 0; const cpf = l?.cpf ?? ""; const noPortal = portal.has(cpf);
      const grupo = /corp_clientes|planilha/i.test(l?.fonte ?? "") ? "base antiga" : "criado pelo fluxo"; const novoRecente = h === 0 && !noPortal && grupo === "criado pelo fluxo";
      add(p.doc, novoRecente ? "cadastrada, SEM histórico (cliente novo já criado)" : "cadastrada, com histórico (ERP ou portal Tokio)");
    } else if (p.cpf.length === 11 || p.cpf.length === 14) add(p.doc, existe.has(p.cpf) ? "CPF já existe no cadastro: só LIGAR" : "CPF válido inexistente: CRIAR NOVO");
    else add(p.doc, "sem CPF/CNPJ: pendência");
  }
  console.log("propostas", props.length, "partes", partes.length, JSON.stringify(r, null, 1));
  const semParte = props.filter((p) => !porDoc.has(p.id)).length; console.log("propostas sem nenhuma parte/cliente:", semParte);
  const orig: Record<string, number> = {}; for (const p of props) { const k = `${docs.get(p.id)?.origem}${docs.get(p.id)?.ref ? ":" + String(docs.get(p.id)?.ref).split(":")[0] : ""}`; orig[k] = (orig[k] ?? 0) + 1; } console.log("origem das propostas", JSON.stringify(orig));
  const fontes: Record<string, number> = {}; for (const l of locs.values()) fontes[`${l.fonte}`] = (fontes[`${l.fonte}`] ?? 0) + 1; console.log("primeira_fonte dos clientes ligados", JSON.stringify(fontes));

  // sem CPF/CNPJ: candidatos por nome exato (sem acento, sem diferença de caixa) em locatarios
  const sem = partes.filter((p) => !p.loc && p.cpf.length !== 11 && p.cpf.length !== 14 && p.nome);
  const res: Record<string, number> = { "1 candidato (sugerir ligação)": 0, "2+ candidatos (escolher)": 0, "nenhum (cliente novo sem CPF)": 0 }; const exemplos: string[] = [];
  for (const p of sem) {
    const { data } = await sb.from("locatarios").select("id,nome,cpf,codigo_cliente").ilike("nome", p.nome!.trim());
    const k = !data?.length ? "nenhum (cliente novo sem CPF)" : data.length === 1 ? "1 candidato (sugerir ligação)" : "2+ candidatos (escolher)"; res[k]++;
    if (exemplos.length < 6) exemplos.push(p.papel + " | " + p.nome + " -> " + (data ?? []).map((x) => x.codigo_cliente + (x.cpf ? " cpf " + String(x.cpf).slice(0, 3) + "..." : " sem cpf")).join(", "));
  }
  console.log("partes sem CPF com nome:", sem.length, JSON.stringify(res)); console.log(exemplos.join(" ;; "));
})();
