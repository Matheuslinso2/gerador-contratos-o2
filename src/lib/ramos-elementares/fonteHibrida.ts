import "server-only";

import { lerFonteRamosElementares, type FonteRamosBruta } from "./fonteGoogle";
import { lerFonteRamosElementaresBitrix } from "./fonteBitrix";

// A partir de COMPETENCIA_INICIO_HIBRIDO (ver page.tsx), Novos Negócios e
// Pendências passaram a ser lançados direto no Bitrix (SPA 1046).
//
// Achado real (29/09/2026): Renovações NÃO ficaram só na planilha como o
// comentário original dizia -- a equipe já começou a lançar renovação
// direto no Bitrix também (card com Tipo de Processo = "Renovação" na
// categoria 22), em paralelo à planilha, sem sobrepor os mesmos registros
// (confirmado com o Matheus). Essa função descartava TODO o lado Bitrix de
// renovacoesAtual/renovacoesFutura (só usava google.abas.*), fazendo a
// "Comissão dos efetivados" sumir mais de R$90 mil em setembro -- renovação
// lançada no Bitrix é calculada certinho em fonteBitrix.ts e ia pro lixo
// aqui. Agora soma as duas fontes. Endossos segue só na planilha por
// enquanto -- mesmo achado existe lá (bitrix.abas.endossos também fica sem
// uso), mas não afeta comissão/efetivados e fica pra uma correção à parte.
export async function lerFonteRamosElementaresHibrida(competencia: string): Promise<FonteRamosBruta> {
  const [google, bitrix] = await Promise.all([
    lerFonteRamosElementares(competencia),
    lerFonteRamosElementaresBitrix(competencia),
  ]);

  return {
    competencia,
    planilha: {
      id: `hibrido:${bitrix.planilha.id}+${google.planilha.id}`,
      titulo: `${bitrix.planilha.titulo} (novos + renovações) + ${google.planilha.titulo} (renovações + endossos)`,
      url: bitrix.planilha.url,
      modificadaEm: google.planilha.modificadaEm,
      tipo: "hibrido",
      urlSecundaria: google.planilha.url,
      tituloSecundario: google.planilha.titulo,
    },
    abas: {
      novosPendentes: bitrix.abas.novosPendentes,
      novosMes: bitrix.abas.novosMes,
      renovacoesAtual: [...bitrix.abas.renovacoesAtual, ...google.abas.renovacoesAtual],
      renovacoesFutura: [...bitrix.abas.renovacoesFutura, ...google.abas.renovacoesFutura],
      endossos: google.abas.endossos,
    },
    nomesAbas: {
      novosPendentes: bitrix.nomesAbas.novosPendentes,
      novosMes: bitrix.nomesAbas.novosMes,
      renovacoesAtual: google.nomesAbas.renovacoesAtual,
      renovacoesFutura: google.nomesAbas.renovacoesFutura,
      endossos: google.nomesAbas.endossos,
    },
    avisos: [...bitrix.avisos, ...google.avisos],
  };
}
