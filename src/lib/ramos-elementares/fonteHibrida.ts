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
// Linha histórica de Ramos Elementares (Matheus, 21/10/2026): de 2015 a
// set/2026 o controle de cotações (inclusive Automóvel) foi feito em planilhas
// mensais; a partir de out/2026 tudo vive no Bitrix, em 2 funis da SPA 1046
// ("Seguros Novos" e "Renovações"), mais o funil Movimentações (endossos).
// Unidades diferentes dos dois lados: na planilha cada linha é um ITEM; no
// Bitrix 1 card = 1 negociação por imobiliária (os itens ficam numa planilha
// anexa) -- por isso set e out NÃO são comparáveis (ver aviso abaixo).
//
// Migração completa (Matheus, 24/10/2026): out/2026 em diante lê SÓ o Bitrix.
// Antes disso a "próxima competência" de outubro ainda somava a aba RN
// NOVEMBRO da planilha, mas a Kamila já tinha criado à mão no funil
// Renovações os cards de novembro (23/10) -- novembro saía contado em dobro.
// E os endossos de outubro saem do funil Movimentações (escolha do Matheus),
// não mais da aba ENDOSSOS. Uma planilha que alguém crie na pasta para
// out/2026 em diante é ignorada: não soma dado nem derruba a leitura.
//  - até ago/2026: só planilha (lerFonteRamosElementares).
//  - set/2026: híbrida (esta função). Novos do Bitrix (decisão de 01/09/2026),
//    renovações das duas fontes, endossos da planilha.
//  - out/2026 em diante: só Bitrix.
const COMPETENCIA_INICIO_HIBRIDO = "2026-09";
const COMPETENCIA_SO_BITRIX = "2026-10";
const AVISO_TRANSICAO =
  "Transição planilha → Bitrix: até set/2026 as renovações são contadas por item (linhas das planilhas); a partir de out/2026, por card (1 card = 1 negociação por imobiliária, com os itens em planilha anexa). Set e out não são comparáveis; de outubro em diante, só Bitrix.";

export type ModoFonteRamos = "planilha" | "hibrida" | "bitrix";

export function modoFonteRamos(competencia: string): ModoFonteRamos {
  if (competencia >= COMPETENCIA_SO_BITRIX) return "bitrix";
  if (competencia >= COMPETENCIA_INICIO_HIBRIDO) return "hibrida";
  return "planilha";
}

// Ponto único de leitura do painel (tela, cron e pendências de e-mail), para
// os cortes de competência não se repetirem em cada lugar.
export async function lerFonteRamosElementaresDaCompetencia(competencia: string): Promise<FonteRamosBruta> {
  const modo = modoFonteRamos(competencia);
  if (modo === "planilha") return lerFonteRamosElementares(competencia);
  if (modo === "hibrida") return lerFonteRamosElementaresHibrida(competencia);
  const bitrix = await lerFonteRamosElementaresBitrix(competencia);
  return competencia === COMPETENCIA_SO_BITRIX ? { ...bitrix, avisos: [AVISO_TRANSICAO, ...bitrix.avisos] } : bitrix;
}

function mesSeguinte(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

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
      // A próxima competência (out/2026) já é só Bitrix.
      renovacoesFutura:
        mesSeguinte(competencia) < COMPETENCIA_SO_BITRIX
          ? [...bitrix.abas.renovacoesFutura, ...google.abas.renovacoesFutura]
          : bitrix.abas.renovacoesFutura,
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
      AVISO_TRANSICAO,
      ...bitrix.avisos,
      ...google.avisos.filter(
        (aviso) =>
          !/Aba não encontrada: NOVOS (PENDENTES|MÊS)/i.test(aviso) &&
          !(!google.nomesAbas.endossos && /Aba não encontrada: ENDOSSOS/i.test(aviso))
      ),
    ],
  };
}
