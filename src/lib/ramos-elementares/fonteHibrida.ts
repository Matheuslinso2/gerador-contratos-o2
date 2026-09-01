import "server-only";

import { lerFonteRamosElementares, type FonteRamosBruta } from "./fonteGoogle";
import { lerFonteRamosElementaresBitrix } from "./fonteBitrix";

// A partir de COMPETENCIA_INICIO_HIBRIDO (ver page.tsx), Novos Negócios e
// Pendências passaram a ser lançados direto no Bitrix (SPA 1046). Renovações
// e Endossos ainda não migraram e continuam só na planilha mensal. Por isso
// o painel combina as duas fontes em vez de usar uma só.
export async function lerFonteRamosElementaresHibrida(competencia: string): Promise<FonteRamosBruta> {
  const [google, bitrix] = await Promise.all([
    lerFonteRamosElementares(competencia),
    lerFonteRamosElementaresBitrix(competencia),
  ]);

  return {
    competencia,
    planilha: {
      id: `hibrido:${bitrix.planilha.id}+${google.planilha.id}`,
      titulo: `${bitrix.planilha.titulo} (novos) + ${google.planilha.titulo} (renovações/endossos)`,
      url: bitrix.planilha.url,
      modificadaEm: google.planilha.modificadaEm,
      tipo: "hibrido",
      urlSecundaria: google.planilha.url,
      tituloSecundario: google.planilha.titulo,
    },
    abas: {
      novosPendentes: bitrix.abas.novosPendentes,
      novosMes: bitrix.abas.novosMes,
      renovacoesAtual: google.abas.renovacoesAtual,
      renovacoesFutura: google.abas.renovacoesFutura,
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
