import "server-only";

import { lerFonteRamosElementares, PlanilhaDaCompetenciaNaoEncontradaError, type FonteRamosBruta } from "./fonteGoogle";
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
//
// Achado real (05/10/2026): em outubro a equipe deixou de criar a planilha
// mensal (migração completa pro Bitrix, como o Matheus avisou em 01/09) --
// sem a "10 OUTUBRO /2026- COTAÇÃO DIÁRIA RE" na pasta, a leitura do Google
// lançava erro, o Promise.all derrubava a busca INTEIRA (inclusive o Bitrix,
// que tinha os dados) e o painel caía no fallback "vazio" -- tudo zerado.
// Agora, se o único problema é a planilha do mês não existir, segue só com o
// Bitrix, que já traz novos, renovações E endossos. Qualquer outro erro do
// Google (autenticação, duplicidade de planilha) continua falhando alto, pra
// não mostrar número parcial sem avisar.
export async function lerFonteRamosElementaresHibrida(competencia: string): Promise<FonteRamosBruta> {
  const [google, bitrix] = await Promise.all([
    lerFonteRamosElementares(competencia).catch((erro) => {
      if (erro instanceof PlanilhaDaCompetenciaNaoEncontradaError) return null;
      throw erro;
    }),
    lerFonteRamosElementaresBitrix(competencia),
  ]);

  if (!google) {
    return {
      ...bitrix,
      avisos: [
        `Planilha mensal de ${competencia} não encontrada na pasta — painel montado só com o Bitrix24 (novos, renovações e endossos).`,
        ...bitrix.avisos,
      ],
    };
  }

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
      endossos: google.nomesAbas.endossos ? google.abas.endossos : bitrix.abas.endossos,
    },
    nomesAbas: {
      novosPendentes: bitrix.nomesAbas.novosPendentes,
      novosMes: bitrix.nomesAbas.novosMes,
      renovacoesAtual: google.nomesAbas.renovacoesAtual,
      renovacoesFutura: google.nomesAbas.renovacoesFutura,
      endossos: google.nomesAbas.endossos ?? bitrix.nomesAbas.endossos,
    },
    // Novos vêm do Bitrix (as abas NOVOS da planilha não são usadas aqui) e
    // endossos caem no Bitrix quando a planilha não tem a aba -- então o aviso
    // "aba não encontrada" dessas abas seria só ruído.
    avisos: [
      ...bitrix.avisos,
      ...google.avisos.filter(
        (aviso) =>
          !/Aba não encontrada: NOVOS (PENDENTES|MÊS)/i.test(aviso) &&
          !(!google.nomesAbas.endossos && /Aba não encontrada: ENDOSSOS/i.test(aviso))
      ),
    ],
  };
}
