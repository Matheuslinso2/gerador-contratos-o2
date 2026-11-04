import { DOMINIO_O2 } from "@/lib/admin";

// NÍVEIS DE ACESSO do Robô O2 (decisão do Matheus, 04/11/2026). Uma régua só para o chat; as mesmas ideias valem para o portal Apólice O2.
//
//  Nível 1 — OPERAÇÃO (todo e-mail @o2seguros.com.br): cotações, propostas, apólices, endossos, parcelas, faturas, sinistros, campanhas,
//            painéis operacionais e os cruzamentos estatísticos desses mesmos dados (ticket médio, prêmio, aluguel, coberturas, indenização, mercado).
//  Nível 2 — PESSOAS (inquilino, proprietário/locador, segurado, garantido): nome, CPF/CNPJ, e-mail, telefone, endereço do imóvel. Fica com quem
//            já tem o nível 1 (a equipe cota e emite com esses dados todo dia), SEMPRE só em texto (nunca PDF/relatório) e sem credenciais nem corpo de e-mail.
//  Nível 3 — FINANCEIRO DA O2: comissão (valor e %), repasse, pró-labore, margem, receita, imposto/DAS, Nibo, baixas, saldo, desconto de comissão.
//            Somente as pessoas abaixo.
//
// Fora do robô (quem NÃO é @o2seguros.com.br, inclusive desenvolvedores da Nichoos): sem acesso ao robô.
// Portal Apólice O2 (futuro, regras já decididas): pessoa abaixo do nível imobiliária só vê o que está ligado ao PRÓPRIO CPF; imobiliária só vê a própria carteira e o
// próprio % no relatório de repasse; NINGUÉM de fora vê comissão ou percentual da O2 (só por pedido fora do portal).

export const FINANCEIRO_O2 = ["matheus@o2seguros.com.br", "william@o2seguros.com.br", "nathalie@o2seguros.com.br", "vanessa@o2seguros.com.br"];

export type NivelChat = "financeiro" | "operacao" | "sem_acesso";

export function roboLiberadoPara(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(DOMINIO_O2);
}

export function podeVerFinanceiroNoChat(email: string | null | undefined): boolean {
  return !!email && FINANCEIRO_O2.includes(email.toLowerCase());
}

export function nivelNoChat(email: string | null | undefined): NivelChat {
  if (podeVerFinanceiroNoChat(email)) return "financeiro";
  if (roboLiberadoPara(email)) return "operacao";
  return "sem_acesso";
}
