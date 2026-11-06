// Nov e dez/2026: apólices vigentes SEM card ligado no ERP → procura no Bitrix (só leitura) algum card que a equipe tenha criado, unido ou movido.
// Saída: renovacoes-re/conferencia-nov-dez-2026-bitrix.csv
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { lerCardsRenovacao, urlCard } from "@/lib/erp/renovacaoCards";
import { listarItensSpaCategoria } from "@/lib/bitrix/client";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const norm = (s: string) => (s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function main() {
  const docs: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.rpc("erp_renovacao_documentos", { p_de: "2026-11-01", p_ate: "2026-12-31" }).range(de, de + 999);
    if (error) throw error;
    docs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const sem = (docs as any[]).filter((d) => !d.status_renovacao);
  console.log("vigentes/vencidas nov+dez a renovar:", (docs as any[]).length, "| sem card ligado:", sem.length);
  const cards = await lerCardsRenovacao();
  const auto = (await listarItensSpaCategoria(1050, 30)) as any[];
  const base = [
    ...cards.map((c) => ({ funil: String(c.funil), url: urlCard(c.entity, c.id), etapa: c.etapa, titulo: c.titulo ?? "", txt: norm(JSON.stringify(c.bruto ?? {}) + " " + (c.titulo ?? "")) })),
    ...auto.map((i) => ({ funil: "Automóvel (1050)", url: urlCard(1050, i.id), etapa: String(i.stageId), titulo: String(i.title ?? ""), txt: norm(JSON.stringify(i) + " " + (i.title ?? "")) })),
  ];
  const linhas: string[] = ["Mês;Produto;Ramo;Código O2 do documento;Nº da apólice;Seguradora;Cliente;Imobiliária;Fim da vigência;Achado no Bitrix;Funil;Etapa;Título do card;Link"];
  let achou = 0;
  for (const d of sem) {
    const num = String(d.numero_apolice ?? "").replace(/^0+/, "");
    const cliente = norm(d.cliente ?? "");
    const achados = base.filter((b) => (num.length >= 5 && b.txt.includes(num)) || (cliente.length >= 12 && b.txt.includes(cliente.slice(0, 22)))).slice(0, 3);
    if (achados.length) achou++;
    const mes = String(d.vigencia_fim).slice(0, 7);
    const comuns = [mes, d.produto, d.ramo, d.nosso_numero, d.numero_apolice, d.seguradora, d.cliente, d.imobiliaria, d.vigencia_fim];
    if (!achados.length) linhas.push([...comuns, "NÃO ACHADO", "", "", "", ""].map(csv).join(";"));
    else for (const a of achados) linhas.push([...comuns, "ACHADO", a.funil, a.etapa, a.titulo, a.url].map(csv).join(";"));
  }
  fs.writeFileSync(path.resolve(process.cwd(), "..", "renovacoes-re", "conferencia-nov-dez-2026-bitrix.csv"), "﻿" + linhas.join("\n"));
  const nao = sem.length - achou;
  console.log(`sem card ligado: ${sem.length} | achou algum card no Bitrix: ${achou} | NÃO achado: ${nao}`);
  const por: Record<string, number> = {};
  for (const d of sem) { const num = String(d.numero_apolice ?? "").replace(/^0+/, ""); const cl = norm(d.cliente ?? ""); const ok = base.some((b) => (num.length >= 5 && b.txt.includes(num)) || (cl.length >= 12 && b.txt.includes(cl.slice(0, 22)))); if (!ok) { const k = `${String(d.vigencia_fim).slice(0, 7)} ${d.ramo}`; por[k] = (por[k] ?? 0) + 1; } }
  console.log("NÃO achados por mês/ramo:", por);
}
main().catch((e) => { console.error(e); process.exit(1); });
