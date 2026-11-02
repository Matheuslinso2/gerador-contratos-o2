// Carrega para o ERP o que foi lido no portal da Porto (Corretor Online, tela Cobrança): fonte 'portal_seguradora', nível 1 do guia (leitura apenas).
//   parcelas:  npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-portal-porto-cobranca.ts parcelas "<json baixado da tela>" [--gravar]
//   vencidas:  npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-portal-porto-cobranca.ts vencidas "<xlsx baixado em Relatórios>" [--gravar]
// Sem --gravar é ensaio. Cada arquivo é uma carga (hash único) desfazível apagando a carga (cascade). Dados bancários e e-mails não são gravados.
process.loadEnvFile(".env.local");
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as XLSX from "xlsx";
import { createServiceClient } from "@/lib/supabase/service";

const [modo, arquivo] = [process.argv[2], process.argv[3]];
const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();

const dinheiro = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const dataBr = (s: string | null | undefined) => {
  const m = (s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
// planilha do portal: datas m/d/aa
const dataUs = (s: string | null | undefined) => {
  const m = (s ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const ano = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${ano}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
// Nº da apólice no ERP = último trecho do número do portal sem zeros à esquerda (086-0746-010629152 -> 10629152). Vida em Grupo (4 trechos) fica sem chave.
const chave = (doc: string | null | undefined) => {
  const p = (doc ?? "").split("-");
  if (p.length !== 3 || !/^\d+$/.test(p[2])) return null;
  return p[2].replace(/^0+/, "") || null;
};

async function cargaNova(tela: string, filtros: string, hash: string, nome: string, linhas: number, obs: string) {
  const { data: ja } = await sb.from("erp_portal_cargas").select("id").eq("arquivo_hash", hash).maybeSingle();
  if (ja) { console.log("arquivo já carregado (carga", ja.id, ")"); return null; }
  const { data, error } = await sb.from("erp_portal_cargas").insert({ tela, filtros, arquivo: nome, arquivo_hash: hash, lido_por: "sessão Repasses ERP (portal logado pelo Matheus)", linhas, observacao: obs }).select("id").single();
  if (error || !data) { console.log("erro na carga:", error?.message); return null; }
  return data.id as string;
}

(async () => {
  const buf = readFileSync(arquivo);
  const hash = createHash("sha256").update(buf).digest("hex");
  if (modo === "parcelas") {
    const j = JSON.parse(buf.toString("utf8")) as { lido_em: string; filtros: string; linhas: { pg: number; r: string[] }[] };
    const linhas = j.linhas.map(({ pg, r }) => {
      const nome = r[0].split(" | ");
      const cpf = nome.pop() ?? "";
      const prod = r[1].split(" | ");
      const doc = prod.pop() ?? "";
      const venc = r[4].match(/^(\d{2}\/\d{2}\/\d{4}) \| Parcela \| (\d+) \| de \| (\d+)$/);
      const pag = r[5].match(/^R\$ \| ([\d.,]+) \| (.+)$/);
      return {
        pagina: pg, susep: r[3], segurado_exibido: nome.join(" "), cpf_cnpj: cpf, produto_texto: prod.join(" "), numero_documento_portal: doc, numero_apolice_chave: chave(doc),
        tipo_doc: r[2], vencimento: dataBr(venc?.[1]), parcela_n: venc ? Number(venc[2]) : null, parcela_total: venc ? Number(venc[3]) : null,
        valor: pag ? dinheiro(pag[1]) : null, meio_pagamento: pag ? pag[2].replace(/ \| /g, " ") : null, status_portal: r[6].replace(/ \| /g, " "),
      };
    });
    const porStatus: Record<string, number> = {};
    linhas.forEach((l) => (porStatus[l.status_portal] = (porStatus[l.status_portal] ?? 0) + 1));
    const semParse = linhas.filter((l) => !l.vencimento || l.valor === null).length;
    console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${linhas.length} parcelas | ${JSON.stringify(porStatus)} | sem data/valor ${semParse} | sem chave ${linhas.filter((l) => !l.numero_apolice_chave).length}`);
    if (!GRAVAR) return;
    const id = await cargaNova("Cobrança > Gestão de parcelas", j.filtros, hash, basename(arquivo), linhas.length, `Lido em ${j.lido_em}. Nome do segurado como exibido (truncado pelo portal).`);
    if (!id) return;
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await sb.from("erp_portal_parcelas").insert(linhas.slice(i, i + 500).map((l) => ({ carga_id: id, ...l })));
      if (error) { console.log("erro no lote", i, error.message); return; }
    }
    const { data: v } = await sb.rpc("erp_portal_vincular_parcelas", { p_carga: id });
    console.log("carga", id, JSON.stringify(v));
  } else if (modo === "faturas") {
    const j = JSON.parse(buf.toString("utf8")) as { lido_em: string; filtros: string; linhas: { pg: number; r: string[] }[] };
    const linhas = j.linhas.map(({ pg, r }) => {
      const nome = r[0].split(" | ");
      const doc = nome.pop() ?? "";
      const pag = r[2].match(/^R\$ \| ([\d.,]+) \| (.+)$/);
      const ven = r[3].match(/^(\d{2}\/\d{2}\/\d{4})(?: \| (.+))?$/);
      return {
        pagina: pg, responsavel_nome: nome.join(" "), responsavel_doc: doc, responsavel_doc_digitos: doc.replace(/\D/g, ""), produto_texto: r[1].replace(/ \| /g, " "),
        valor: pag ? dinheiro(pag[1]) : null, meio_pagamento: pag ? pag[2].replace(/ \| /g, " ") : null, vencimento: dataBr(ven?.[1]), marca_vencimento: ven?.[2] ?? null, status_portal: r[4].replace(/ \| /g, " "),
      };
    });
    const porStatus: Record<string, number> = {};
    linhas.forEach((l) => (porStatus[l.status_portal] = (porStatus[l.status_portal] ?? 0) + 1));
    console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${linhas.length} faturas | ${JSON.stringify(porStatus)} | sem data/valor ${linhas.filter((l) => !l.vencimento || l.valor === null).length}`);
    if (!GRAVAR) return;
    const id = await cargaNova("Cobrança > Faturas", j.filtros, hash, basename(arquivo), linhas.length, `Lido em ${j.lido_em}.`);
    if (!id) return;
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await sb.from("erp_portal_faturas").insert(linhas.slice(i, i + 500).map((l) => ({ carga_id: id, ...l })));
      if (error) { console.log("erro no lote", i, error.message); return; }
    }
    const { data: v } = await sb.rpc("erp_portal_vincular_faturas", { p_carga: id });
    console.log("carga", id, JSON.stringify(v));
  } else if (modo === "vencidas") {
    const wb = XLSX.read(buf);
    const rows = XLSX.utils.sheet_to_json<Record<string, string | null>>(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: false });
    const lim = (s: string | null | undefined) => (s && s !== "--" && s !== "----" ? s : null);
    const linhas = rows.map((r) => ({
      preposto: lim(r["Preposto"]), forma_pagamento: r["Forma de pagamento"], segurado: r["Segurado"], telefone: lim((r["Telefone"] ?? "").replace(/\s+/g, "")),
      numero_proposta: lim(r["Proposta"]), endosso: lim(r["Endosso"]), numero_documento_portal: lim(r["Apolice"]), numero_apolice_chave: chave(lim(r["Apolice"])),
      parcela_n: r["Parc."] ? Number(r["Parc."]) : null, vencimento: dataUs(r["Vencimento"]), valor: r["Valor"] ? Number(r["Valor"]) : null, produto: r["Produto"], marca: lim(r["Marca"]),
      novo_vencimento: dataUs(r["Novo Vencimento"]), responsavel_financeiro: r["Responsável Financeiro"], vigencia_inicio: dataUs(r["Vigência Inicial"]), vigencia_fim: dataUs(r["Vigência Final"]),
      existe_acordo: lim(r["Existe acordo"]), renegociacao: lim(r["Renegociação"]), motivo_recusa_debito: lim(r["Motivo recusa débito automático"]), vencimento_original: dataUs(r["Vencimento Original"]),
    }));
    console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${linhas.length} linhas vencidas (${linhas.filter((l) => l.numero_apolice_chave).length} com chave de apólice; o resto é fatura conjugada sem apólice)`);
    if (!GRAVAR) return;
    const id = await cargaNova(`Cobrança > Relatórios > ${basename(arquivo)}`, "Parcelas vencidas, SUSEP CFU15J, 30/10/2024 a 29/10/2026", hash, basename(arquivo), linhas.length, "Relatório gerado pelo portal em 30/10/2026. Banco/agência/conta (vazios) não gravados.");
    if (!id) return;
    const { error } = await sb.from("erp_portal_vencidas").insert(linhas.map((l) => ({ carga_id: id, ...l })));
    if (error) { console.log("erro:", error.message); return; }
    const { data: v } = await sb.rpc("erp_portal_vincular_vencidas", { p_carga: id });
    console.log("carga", id, JSON.stringify(v));
  } else console.log("modo: parcelas | vencidas");
})();
