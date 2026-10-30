// ERP O2 — leitor fixo do "Demonstrativo de Comissões - Corretagem" da Yelum (PDF). Exato e sem IA (30/10/2026):
// os PDFs grandes (230+ linhas) vinham "nenhuma linha reconhecida" pela IA. Cada comissão é uma linha de texto:
//   YELUM <CLIENTE> <APÓLICE> <PARCELA>/<TOTAL> <PRÊMIO> <% COM.> <COMISSÃO>   (parcela pode vir "1;2/10" = duas parcelas juntas)
// O total bruto vem do TOTALIZADOR. Se a soma das linhas não bater com o total bruto, devolve null (cai na leitura antiga).
import type { LinhaExtrato } from "@/lib/erp/extratos";

const LINHA = /^YELUM (.+?) (\d{10,}) ([\d;]+)\/(\d+) (-?[\d.]+,\d{2}) ([\d.]+,\d{2}) (-?[\d.]+,\d{2})$/;
// restituição de endosso (estorno): YELUM <CLIENTE> <APÓLICE> <ENDOSSO> 1/1 <PRÊMIO> <COMISSÃO> END RESTITUICAO
const RESTITUICAO = /^YELUM (.+?) (\d{10,}) (\d+) ([\d;]+)\/(\d+) (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2}) END (.+)$/;
const valor = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

export function parseYelumPdf(texto: string): { linhas: LinhaExtrato[]; total_bruto: number | null; total_liquido: number | null } | null {
  const linhas: LinhaExtrato[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const r = RESTITUICAO.exec(bruta.trim());
    if (r) {
      linhas.push({
        n: linhas.length + 1, apolice: r[2], proposta: null, endosso: r[3], parcela: Number(r[4].split(";")[0]), cliente: r[1].trim(), cpf_cnpj: null,
        premio: valor(r[6]), pct_comissao: null, valor_comissao: valor(r[7]), vigencia_inicio: null, produto: null, tipo: `endosso ${r[8].trim().toLowerCase()}`,
      });
      continue;
    }
    const m = LINHA.exec(bruta.trim());
    if (!m) continue;
    const parcelas = m[3].split(";").filter(Boolean);
    linhas.push({
      n: linhas.length + 1, apolice: m[2], proposta: null, endosso: null, parcela: Number(parcelas[0]), cliente: m[1].trim(), cpf_cnpj: null,
      premio: valor(m[5]), pct_comissao: valor(m[6]), valor_comissao: valor(m[7]), vigencia_inicio: null, produto: null,
      tipo: parcelas.length > 1 ? `parcelas ${parcelas.join(";")}/${m[4]}` : null,
    });
  }
  if (!linhas.length) return null;
  // TOTALIZADOR: a linha seguinte ao cabeçalho "Total Bruto - R$ ..." traz bruto, descontos e líquido
  const tot = /Total Bruto - R\$[^\n]*\n\s*(-?[\d.]+,\d{2}) (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2})/.exec(texto);
  const total_bruto = tot ? valor(tot[1]) : null;
  const soma = Math.round(linhas.reduce((s, l) => s + (l.valor_comissao ?? 0), 0) * 100) / 100;
  if (total_bruto !== null && Math.abs(soma - total_bruto) > 0.05) return null;
  return { linhas, total_bruto, total_liquido: tot ? valor(tot[3]) : null };
}
