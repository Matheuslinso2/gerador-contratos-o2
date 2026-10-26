// ERP O2 — gera o arquivo .txt que o InCorp do Corp lê para a Tokio, no MESMO layout do arquivo que a equipe sobe
// (texto do PDF "Extrato do Corretor" com as colunas alinhadas; modelo: "0608 cap.txt" baixado da Pasta Comissões
// em 26/10/2026). O InCorp exige "Data de Crédito:" e a data na mesma linha; sem isso recusa ("não consta a Data de
// pagamento") e renomeia o arquivo para COM_<nome>.
import type { ExtratoPdf } from "./extratosPdf";

const brl = (v: number | null | undefined) => {
  const n = Number(v ?? 0);
  const s = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}R$ ${s}`;
};
const dataBr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
const col = (s: string, w: number) => (s.length >= w ? s + " " : s + " ".repeat(w - s.length));

export type CabecalhoTokio = { corretora: string; cnpj: string; codCorretor: string; susep: string; processamento: string };

export const CORRETORAS_TOKIO: Record<string, CabecalhoTokio> = {
  "70145": { corretora: "O2 CAPITALIZACAO E SEGUROS LTDA", cnpj: "54.493.758/0001-38", codCorretor: "070145", susep: "242156242", processamento: "" },
  "195354": { corretora: "O2 CORRETORA DE SEGUROS LTDA EPP", cnpj: "20.001.784/0001-80", codCorretor: "195354", susep: "202052090", processamento: "" },
  "55002": { corretora: "O2 CORRETORA DE SEGUROS LTDA EPP", cnpj: "20.001.784/0001-80", codCorretor: "055002", susep: "202052090", processamento: "" },
};

export function gerarTxtTokioIncorp(e: ExtratoPdf, cab: CabecalhoTokio): string {
  const iss = (e.total_bruto ?? 0) - (e.total_liquido ?? 0);
  const L: string[] = [];
  L.push(`${" ".repeat(60)}Extrato do Corretor${" ".repeat(44)}Extrato nº ${e.numero ?? ""}`);
  L.push(`${" ".repeat(112)}Data de Processamento: ${cab.processamento || dataBr(e.pago_em)}`);
  L.push("");
  L.push(`${col(`Corretor: ${cab.corretora}`, 97)}SUSEP: ${cab.susep}`);
  L.push("");
  L.push(`${col(`CPF/CNPJ: ${cab.cnpj}`, 97)}ns. Pref.:`);
  L.push("");
  L.push(`${col(`Cod. Corretor: ${cab.codCorretor}`, 97)}Sucursal: 08302 - BARRA`);
  L.push("", "", "");
  L.push(`        FORMA DE CRÉDITO${" ".repeat(87)}FORMA DE CRÉDITO`);
  L.push(`${col("Data de Crédito:", 38)}${col(dataBr(e.pago_em), 56)}${col("Total da Comissão Bruta:", 48)}${brl(e.total_bruto)}`);
  L.push(`${col("Tipo de Crédito:", 38)}${col("DOC", 56)}${col("I.S.S:", 48)}${brl(-iss)}`);
  L.push(`${col("Banco:", 38)}${col("", 56)}${col("I.R:", 48)}${brl(0)}`);
  L.push(`${col("Agência:", 38)}${col("", 56)}${col("I.N.S.S:", 48)}${brl(0)}`);
  L.push(`${col("Conta Corrente:", 38)}${col("", 56)}${col("Outros Ajustes sem Impostos:", 48)}${brl(0)}`);
  L.push(`${col("Alíquota I.S.S.:", 38)}${brl(0)}`);
  L.push(`${col("Alíquota I.R.:", 38)}${brl(0)}`);
  L.push(`${" ".repeat(94)}${col("Total Comissão Líquida", 48)}${brl(e.total_liquido)}`);
  L.push(`${col("Alíquota I.N.S.S.:", 38)}${brl(0)}`);
  L.push("", "", "");
  L.push("              Segurado                 Negócio       Ramo       Apolice / Bilhete   Endosso     Tipo     Parc     Prêmio(R$)   Comissão (%)    Comissão (R$)");
  L.push("");
  // linhas de comissão nas MESMAS colunas do arquivo da equipe (medidas no "0608 cap.txt"): nome centralizado até a
  // coluna 36; Negócio 38, Ramo 50, Apólice 68, Endosso 87, Tipo 94, Parc 105, Prêmio 114, % 129, Comissão 146.
  // Campo maior que a coluna empurra os seguintes, sempre com pelo menos 2 espaços entre campos.
  const POS = [38, 50, 68, 87, 94, 105, 114, 129, 146];
  for (const c of e.linhas_campos ?? []) {
    // o InCorp lê por POSIÇÃO: nome longo quebra em duas linhas (como no arquivo da equipe) para não empurrar as colunas
    const palavras = c[0].split(" ");
    let nome = "";
    while (palavras.length && (nome + " " + palavras[0]).trim().length <= 30) nome = (nome + " " + palavras.shift()).trim();
    const resto = palavras.join(" ");
    const esq = Math.max(1, Math.floor((37 - nome.length) / 2));
    let linha = " ".repeat(esq) + nome;
    c.slice(1).forEach((v, i) => {
      const alvo = Math.max(POS[i], linha.length + 2);
      linha += " ".repeat(alvo - linha.length) + v;
    });
    L.push(linha);
    L.push(resto ? " ".repeat(Math.max(1, Math.floor((37 - resto.length) / 2))) + resto : "");
  }
  L.push("", "", "", `${" ".repeat(124)}Página 1 de 1`);
  return L.join("\r\n") + "\r\n";
}

