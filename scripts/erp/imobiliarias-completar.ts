// Completa a ficha das imobiliárias (tabela única `imobiliarias`) SÓ em campo vazio, com prova e fonte registradas em imobiliaria_campos_log.
// Nunca cria imobiliária e nunca sobrescreve dado existente. Ordem de fontes: Receita (CNPJ) > Bitrix (empresa) > Corp (produtor).
// E-mail de faturas/repasses: só com prova em e-mail trocado sobre fatura/repasse (view imobiliaria_email_evidencia_v); sem prova suficiente vira sugestão.
// Ensaio por padrão; --gravar grava.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/imobiliarias-completar.ts [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";

const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();
const vazio = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
const NIVEL: Record<string, number> = { receita_cnpj: 1, bitrix_empresa: 6, corp_produtor: 8, imobiliarias_conhecidas: 7 };
const PRIORIDADE = ["receita_cnpj", "bitrix_empresa", "corp_produtor", "imobiliarias_conhecidas"];

async function todas<T>(tabela: string, cols: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q: any = sb.from(tabela).select(cols).range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const fmtTel = (t: string) => {
  let d = t.replace(/\D/g, ""); if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
};
const texto = (v: unknown) => (typeof v === "string" && v.trim().length >= 3 ? v.trim().replace(/\s+/g, " ") : null);
const cnpj14 = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length === 14 ? d : null; };

(async () => {
  const imobs = await todas<any>("imobiliarias", "id,nome,cnpj,telefone,endereco,cidade,uf,bairro,email_faturas,email_repasses");
  const regs = await todas<any>("imobiliaria_registros_fonte", "fonte,imobiliaria_id,dados", (q) => q.eq("situacao", "confirmado").not("imobiliaria_id", "is", null).in("fonte", PRIORIDADE));
  const porImob = new Map<string, Map<string, any>>();
  for (const r of regs) { const m = porImob.get(r.imobiliaria_id) ?? porImob.set(r.imobiliaria_id, new Map()).get(r.imobiliaria_id)!; if (!m.has(r.fonte)) m.set(r.fonte, r.dados ?? {}); }
  const cnpjsUsados = new Set(imobs.map((i) => cnpj14(i.cnpj)).filter(Boolean));

  type Mud = { imobiliaria_id: string; campo: string; valor: string | string[]; fonte: string; evidencia: Record<string, unknown> };
  const mud: Mud[] = []; const sugestoes: Mud[] = [];
  const cont: Record<string, number> = {};

  for (const i of imobs) {
    const fontes = porImob.get(i.id); if (!fontes) continue;
    const pegar = (extrai: (d: any) => string | null): { v: string; fonte: string } | null => {
      for (const f of PRIORIDADE) { const d = fontes.get(f); if (!d) continue; const v = extrai(d); if (v) return { v, fonte: f }; }
      return null;
    };
    const tentar = (campo: string, atual: unknown, r: { v: string; fonte: string } | null) => { if (vazio(atual) && r) { mud.push({ imobiliaria_id: i.id, campo, valor: r.v, fonte: r.fonte, evidencia: { nivel: NIVEL[r.fonte] } }); cont[campo] = (cont[campo] ?? 0) + 1; } };
    tentar("telefone", i.telefone, pegar((d) => { for (const t of Array.isArray(d.telefones) ? d.telefones : []) { const f = fmtTel(String(t)); if (f) return f; } return null; }));
    tentar("endereco", i.endereco, pegar((d) => texto(d.endereco)));
    tentar("cidade", i.cidade, pegar((d) => texto(d.cidade)));
    tentar("uf", i.uf, pegar((d) => { const u = typeof d.uf === "string" ? d.uf.trim().toUpperCase() : ""; return /^[A-Z]{2}$/.test(u) ? u : null; }));
    tentar("bairro", i.bairro, pegar((d) => texto(d.bairro)));
    if (vazio(i.cnpj)) {
      const r = pegar((d) => cnpj14(d.cpf_cnpj) ?? cnpj14(d.cnpj));
      if (r) { if (cnpjsUsados.has(r.v)) cont.cnpj_duplicado = (cont.cnpj_duplicado ?? 0) + 1; else { mud.push({ imobiliaria_id: i.id, campo: "cnpj", valor: r.v, fonte: r.fonte, evidencia: { nivel: NIVEL[r.fonte] } }); cnpjsUsados.add(r.v); cont.cnpj = (cont.cnpj ?? 0) + 1; } }
    }
  }

  // e-mails de faturas/repasses: prova = endereço visto em e-mails trocados sobre fatura/repasse (domínio de no máximo 2 imobiliárias, nunca o da O2)
  const ev = await todas<any>("imobiliaria_email_evidencia_v", "imobiliaria_id,addr,n_fatura,n_repasse,ultimo");
  const imobPorId = new Map(imobs.map((i) => [i.id, i]));
  const porImobEv = new Map<string, any[]>();
  for (const e of ev) (porImobEv.get(e.imobiliaria_id) ?? porImobEv.set(e.imobiliaria_id, []).get(e.imobiliaria_id)!).push(e);
  for (const [id, lista] of porImobEv) {
    const i = imobPorId.get(id); if (!i) continue;
    const fat = lista.filter((e) => e.n_fatura >= 2).sort((a, b) => b.n_fatura - a.n_fatura).slice(0, 3);
    if (vazio(i.email_faturas) && fat.length) { mud.push({ imobiliaria_id: id, campo: "email_faturas", valor: fat.map((e) => e.addr), fonte: "erp_emails", evidencia: { nivel: 5, e_mails_sobre_fatura: fat.map((e) => e.n_fatura), ultimo: fat[0].ultimo } }); cont.email_faturas = (cont.email_faturas ?? 0) + 1; }
    const rep = lista.filter((e) => e.n_repasse >= 1).sort((a, b) => b.n_repasse - a.n_repasse).slice(0, 3);
    if (vazio(i.email_repasses) && rep.length) {
      const forte = rep.filter((e) => e.n_repasse >= 2);
      if (forte.length) { mud.push({ imobiliaria_id: id, campo: "email_repasses", valor: forte.map((e) => e.addr), fonte: "erp_emails", evidencia: { nivel: 5, e_mails_sobre_repasse: forte.map((e) => e.n_repasse), ultimo: forte[0].ultimo } }); cont.email_repasses = (cont.email_repasses ?? 0) + 1; }
      else { sugestoes.push({ imobiliaria_id: id, campo: "email_repasses", valor: rep.map((e) => e.addr), fonte: "erp_emails", evidencia: { nivel: 5, e_mails_sobre_repasse: rep.map((e) => e.n_repasse), ultimo: rep[0].ultimo } }); cont.sug_email_repasses = (cont.sug_email_repasses ?? 0) + 1; }
    }
  }

  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"} — ${imobs.length} imobiliárias; fichas com fonte confirmada: ${porImob.size}`);
  console.log("preenchimentos (campo vazio → valor com prova):", JSON.stringify(cont));
  const porFonte: Record<string, number> = {}; for (const m of mud) porFonte[`${m.campo}/${m.fonte}`] = (porFonte[`${m.campo}/${m.fonte}`] ?? 0) + 1;
  console.log("por campo/fonte:", JSON.stringify(porFonte));
  if (!GRAVAR) return;

  for (const m of mud) {
    const { error } = await sb.from("imobiliarias").update({ [m.campo]: m.valor }).eq("id", m.imobiliaria_id);
    if (error) { console.log(`falhou ${m.campo} ${m.imobiliaria_id}: ${error.message}`); continue; }
    const { error: e2 } = await sb.from("imobiliaria_campos_log").insert({ imobiliaria_id: m.imobiliaria_id, campo: m.campo, valor_novo: Array.isArray(m.valor) ? m.valor.join(", ") : m.valor, fonte: m.fonte, nivel: (m.evidencia.nivel as number) ?? null, evidencia: m.evidencia });
    if (e2) console.log(`log ${m.campo}: ${e2.message}`);
  }
  for (const s of sugestoes) {
    await sb.from("imobiliaria_registros_fonte").upsert({ fonte: "sugestao_campo", chave_externa: `${s.imobiliaria_id}:${s.campo}`, nome_original: s.campo, imobiliaria_id: null, situacao: "sugerido", metodo_vinculo: "email_trocado", sugestoes: [{ imobiliaria_id: s.imobiliaria_id, campo: s.campo, valor: s.valor, ...s.evidencia }] }, { onConflict: "fonte,chave_externa" });
  }
  console.log(`GRAVADO: ${mud.length} preenchimentos, ${sugestoes.length} sugestões`);
})();
