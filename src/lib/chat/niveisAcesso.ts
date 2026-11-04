import { DOMINIO_O2 } from "@/lib/admin";

// NÍVEIS DE ACESSO do Robô O2 (decisão do Matheus, 04/11/2026). Uma régua só para o chat; as mesmas ideias valem para o portal Apólice O2.
//
//  Nível 1 — OPERAÇÃO (todo e-mail @o2seguros.com.br): cotações, propostas, apólices, endossos, parcelas, faturas, sinistros, campanhas, painéis operacionais,
//            os cruzamentos estatísticos desses dados E os PERCENTUAIS E VALORES DAS COMISSÕES E DOS REPASSES DAS APÓLICES (quem fecha o seguro e controla as
//            metas do setor já tem esses dados desde a cotação).
//  Nível 2 — PESSOAS (inquilino, proprietário/locador, segurado, garantido): nome, CPF/CNPJ, e-mail, telefone, endereço do imóvel. Com quem já tem o nível 1,
//            SEMPRE só em texto (nunca PDF/relatório) e sem credenciais nem corpo de e-mail.
//  Nível 3 — FINANCEIRO DA O2 = a CONTA e o dinheiro que entrou/saiu: Nibo (contas, lançamentos, folha), extratos, baixas e recebimentos de comissão, receita
//            realizada, imposto/DAS (devido e pago), saldo, descontos de baixa e a margem (comissão - repasse). Somente as pessoas abaixo.
//
// Fora do robô (quem NÃO é @o2seguros.com.br, inclusive desenvolvedores da Nichoos): sem acesso ao robô.
// Portal Apólice O2 (futuro, regras já decididas): pessoa abaixo do nível imobiliária só vê o que está ligado ao PRÓPRIO CPF; imobiliária só vê a própria carteira e o
// próprio % no relatório de repasse; NINGUÉM de fora vê comissão ou percentual da O2 (só por pedido fora do portal).

export const FINANCEIRO_O2 = ["matheus@o2seguros.com.br", "william@o2seguros.com.br", "nathalie@o2seguros.com.br", "vanessa@o2seguros.com.br"];

export type NivelChat = "financeiro" | "operacao" | "sem_acesso";

export function roboLiberadoPara(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(DOMINIO_O2);
}

// Percentuais e valores das comissões e dos repasses DAS APÓLICES (nível 1).
export function podeVerComissaoNoChat(email: string | null | undefined): boolean {
  return roboLiberadoPara(email);
}

// Conta e dinheiro que entrou (nível 3).
export function podeVerFinanceiroNoChat(email: string | null | undefined): boolean {
  return !!email && FINANCEIRO_O2.includes(email.toLowerCase());
}

export function nivelNoChat(email: string | null | undefined): NivelChat {
  if (podeVerFinanceiroNoChat(email)) return "financeiro";
  if (roboLiberadoPara(email)) return "operacao";
  return "sem_acesso";
}
