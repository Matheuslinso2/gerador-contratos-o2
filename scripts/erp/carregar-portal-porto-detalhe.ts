process.loadEnvFile(".env.local");
// Carrega o DETALHE de cada apólice do Corretor Online da Porto (telas antigas col_apoliceTabsRENew / col_apoliceTabsFiancaNew: dados gerais, prêmio, parcelas),
// lido uma a uma pelo navegador logado, em erp_portal_porto_detalhe; liga à lista (erp_portal_porto_apolices) e ao documento do ERP pelo número da apólice.
// Entrada: porto_detalhe_*.json em Downloads ({ lido_em, itens:[{s,ap,ramo,prop,txt,parcelasHtml}] }). Nova carga por arquivo; reler a mesma apólice substitui a anterior.
// Uso: npx tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-portal-porto-detalhe.ts <arquivo.json> [<arquivo2.json> ...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const arqs = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(os.homedir(), "Downloads", "porto_detalhe_0511.json")];
const carga = `porto-det-${new Date().toISOString().slice(0, 16)}`;
const num = (s?: string) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);
const dt = (s?: string) => { const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const m1 = (t: string, re: RegExp) => re.exec(t)?.[1];

type Item = { s: string; ap: string; ramo: string; prop: string; txt: string; parcelasHtml: string | null };

function parcelas(x: Item) {
  const out: { n: number; vencimento: string | null; valor: number; situacao: string; pago_em: string | null }[] = [];
  // o texto da tabela vem sem separadores: RE "115/11/202611.82R$ 11,82PENDENTE" (parcela 1, vencimento, valor sem formatação, valor, situação);
  // Fiança "110/11/2026130,36ABERTO / /". O 1º número é a parcela, seguido do vencimento dd/mm/aaaa (leitura gulosa recua 1 dígito quando preciso).
  const seg = x.txt.split(/Data de Pagamento/i)[1] ?? "";
  for (const m of seg.matchAll(/(\d{1,2})(\d{2}\/\d{2}\/\d{4})(?:\d+(?:\.\d+)?R\$\s?)?([\d.]+,\d{2})([A-ZÇÃ]+)\s*(?:(\d{2}\/\d{2}\/\d{4}))?/g))
    out.push({ n: Number(m[1]), vencimento: dt(m[2]), valor: num(m[3])!, situacao: m[4], pago_em: dt(m[5]) });
  return out;
}

async function main() {
  const linhas: Record<string, unknown>[] = [];
  for (const arq of arqs) {
    const j = JSON.parse(fs.readFileSync(arq, "utf8")) as { lido_em: string; itens: Item[] };
    for (const x of j.itens) {
      const t = x.txt;
      const vig = /Vig[êe]ncia\s*(\d{2}\/\d{2}\/\d{4})\s*at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t);
      const ps = parcelas(x);
      const premio = num(m1(t, /Pr[êe]mio\s*([\d.]+,\d{2})\s*Juros/i)), iof = num(m1(t, /IOF\s*([\d.]+,\d{2})/i));
      linhas.push({
        carga, coletado_em: j.lido_em, susep: x.s === "G" ? "G0852J" : "CFU15J", apolice: x.ap, ramo: x.ramo, proposta: x.prop,
        status: m1(t, /Status\s*(Ativ[oa]|Cancelad[oa]|N[ãa]o Vigente|Vencid[oa]|Suspens[oa]|Recusad[oa])/i)?.toUpperCase().replace(/A$/, "O") ?? null, emissao: dt(m1(t, /Data de Emiss[ãa]o\s*(\d{2}\/\d{2}\/\d{4})/i)),
        vigencia_inicio: dt(vig?.[1]), vigencia_fim: dt(vig?.[2]), oferta: m1(t, /Oferta\s*(.+?)\s*Vig[êe]ncia/i) ?? null,
        cliente_nome: (m1(t, /Nome de Registro\s*(.+?)\s*(?:Email|CPF|CNPJ)/i) ?? null),
        cpf_cnpj: m1(t, /(?:CPF|CNPJ)\s*([\d.\-\/]{11,18})/i)?.replace(/\D/g, "") ?? null,
        premio, iof, premio_total: num(m1(t, /Pr[êe]mio Total\s*([\d.]+,\d{2})/i)),
        forma_pagamento: m1(t, /Forma de Pagamento\s*(.+?)\s*Quantidade de Parcelas/i) ?? null, qtd_parcelas: Number(m1(t, /Quantidade de Parcelas\s*(\d+)/i)) || null,
        parcelas: ps, corretor_susep: m1(t, /([0-9A-Z]{5,6}J)\s*100%/) ?? null, bruto: { texto: t.slice(0, 6000) },
      });
    }
  }
  // reler a mesma apólice substitui a leitura anterior
  const aps = [...new Set(linhas.map((l) => l.apolice as string))];
  for (let i = 0; i < aps.length; i += 100) await sb.from("erp_portal_porto_detalhe").delete().in("apolice", aps.slice(i, i + 100));
  for (let i = 0; i < linhas.length; i += 100) {
    const { error } = await sb.from("erp_portal_porto_detalhe").insert(linhas.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  const sem = (f: (l: Record<string, unknown>) => boolean) => linhas.filter(f).length;
  console.log("detalhes gravados:", linhas.length, "carga", carga, "| sem prêmio:", sem((l) => l.premio == null), "| sem parcelas:", sem((l) => !(l.parcelas as unknown[]).length),
    "| parcelas ≠ quantidade:", sem((l) => l.qtd_parcelas != null && (l.parcelas as unknown[]).length !== l.qtd_parcelas), "| sem status:", sem((l) => l.status == null));
}
main().catch((e) => { console.error(e); process.exit(1); });
