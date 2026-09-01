import "server-only";

import { drive } from "@googleapis/drive";
import { sheets } from "@googleapis/sheets";
import { obterAutenticacaoGoogle } from "@/lib/googleAuth";

export type CelulaGoogle = string | number | boolean | null;

export type FonteRamosBruta = {
  competencia: string;
  planilha: {
    id: string;
    titulo: string;
    url: string;
    modificadaEm: string | null;
    tipo?: "google_sheets" | "bitrix24" | "hibrido";
    // Só usados quando tipo === "hibrido": novos vêm do Bitrix (url/titulo
    // principais), renovações e endossos vêm da planilha (secundários).
    urlSecundaria?: string | null;
    tituloSecundario?: string | null;
  };
  abas: {
    novosPendentes: CelulaGoogle[][];
    novosMes: CelulaGoogle[][];
    renovacoesAtual: CelulaGoogle[][];
    renovacoesFutura: CelulaGoogle[][];
    endossos: CelulaGoogle[][];
  };
  nomesAbas: {
    novosPendentes: string | null;
    novosMes: string | null;
    renovacoesAtual: string | null;
    renovacoesFutura: string | null;
    endossos: string | null;
  };
  avisos: string[];
};

const MESES = [
  "JANEIRO",
  "FEVEREIRO",
  "MARÇO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
] as const;

function obterAutenticacaoRamos(escopos: string[]) {
  return obterAutenticacaoGoogle(escopos, {
    email: process.env.RAMOS_ELEMENTARES_GOOGLE_SERVICE_ACCOUNT_EMAIL,
    chavePrivada: process.env.RAMOS_ELEMENTARES_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    contexto: "Ramos Elementares",
  });
}

function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function decomporCompetencia(competencia: string): { ano: number; mes: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!match) throw new Error("Competência inválida. Use o formato AAAA-MM.");
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  if (mes < 1 || mes > 12) throw new Error("Mês inválido na competência.");
  return { ano, mes };
}

function nomeAbaRenovacao(competencia: string, deslocamento: number): string {
  const { ano, mes } = decomporCompetencia(competencia);
  const data = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  return `RN ${MESES[data.getUTCMonth()]}`;
}

function tituloCompativel(titulo: string, competencia: string): boolean {
  const { ano, mes } = decomporCompetencia(competencia);
  const tituloNormalizado = normalizar(titulo);
  const mesNormalizado = normalizar(MESES[mes - 1]);
  return (
    !tituloNormalizado.startsWith("COPIA DE") &&
    tituloNormalizado.includes("COTACAO DIARIA RE") &&
    (tituloNormalizado.includes(`${mesNormalizado}/${ano}`) || tituloNormalizado.includes(`${mesNormalizado} ${ano}`))
  );
}

async function lerTituloPlanilha(id: string): Promise<{ titulo: string; url: string }> {
  const autenticacao = obterAutenticacaoRamos(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const api = sheets({ version: "v4", auth: autenticacao });
  const resposta = await api.spreadsheets.get({
    spreadsheetId: id,
    fields: "spreadsheetId,spreadsheetUrl,properties.title",
    includeGridData: false,
  });
  return {
    titulo: resposta.data.properties?.title || "Planilha sem título",
    url: resposta.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}`,
  };
}

export async function resolverPlanilhaDaCompetencia(competencia: string): Promise<{
  id: string;
  titulo: string;
  url: string;
  modificadaEm: string | null;
}> {
  const pastaId = process.env.RAMOS_ELEMENTARES_DRIVE_FOLDER_ID?.trim();
  const planilhaFixaId = process.env.RAMOS_ELEMENTARES_SPREADSHEET_ID?.trim();

  if (pastaId) {
    const autenticacao = obterAutenticacaoRamos(["https://www.googleapis.com/auth/drive.readonly"]);
    const api = drive({ version: "v3", auth: autenticacao });
    const arquivos: { id: string; name: string; modifiedTime: string | null; webViewLink: string | null }[] = [];
    let pageToken: string | undefined;

    do {
      const resposta = await api.files.list({
        q: `'${pastaId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`,
        fields: "nextPageToken,files(id,name,modifiedTime,webViewLink)",
        pageSize: 100,
        pageToken,
        orderBy: "modifiedTime desc",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });
      for (const arquivo of resposta.data.files || []) {
        if (arquivo.id && arquivo.name) {
          arquivos.push({
            id: arquivo.id,
            name: arquivo.name,
            modifiedTime: arquivo.modifiedTime || null,
            webViewLink: arquivo.webViewLink || null,
          });
        }
      }
      pageToken = resposta.data.nextPageToken || undefined;
    } while (pageToken);

    const candidatas = arquivos.filter((arquivo) => tituloCompativel(arquivo.name, competencia));
    if (candidatas.length === 1) {
      const encontrada = candidatas[0];
      return {
        id: encontrada.id,
        titulo: encontrada.name,
        url: encontrada.webViewLink || `https://docs.google.com/spreadsheets/d/${encontrada.id}`,
        modificadaEm: encontrada.modifiedTime,
      };
    }
    if (candidatas.length > 1) {
      throw new Error(
        `Foram encontradas ${candidatas.length} planilhas para ${competencia}. Renomeie ou mova as cópias para que reste apenas a fonte original.`
      );
    }
    if (!planilhaFixaId) {
      throw new Error(`Nenhuma planilha original de COTAÇÃO DIÁRIA RE foi encontrada na pasta para ${competencia}.`);
    }
  }

  if (planilhaFixaId) {
    const planilha = await lerTituloPlanilha(planilhaFixaId);
    if (!tituloCompativel(planilha.titulo, competencia)) {
      throw new Error(
        `A planilha configurada (${planilha.titulo}) não corresponde à competência ${competencia}. Configure a pasta mensal no Vercel.`
      );
    }
    return { id: planilhaFixaId, titulo: planilha.titulo, url: planilha.url, modificadaEm: null };
  }

  throw new Error(
    "Fonte de Ramos Elementares não configurada. Informe RAMOS_ELEMENTARES_DRIVE_FOLDER_ID ou RAMOS_ELEMENTARES_SPREADSHEET_ID."
  );
}

function escaparNomeAba(nome: string): string {
  return `'${nome.replace(/'/g, "''")}'`;
}

export async function lerFonteRamosElementares(competencia: string): Promise<FonteRamosBruta> {
  const planilha = await resolverPlanilhaDaCompetencia(competencia);
  const autenticacao = obterAutenticacaoRamos(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const api = sheets({ version: "v4", auth: autenticacao });

  const metadados = await api.spreadsheets.get({
    spreadsheetId: planilha.id,
    includeGridData: false,
    fields: "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))",
  });

  const propriedades = metadados.data.sheets?.map((aba) => aba.properties).filter(Boolean) || [];
  const encontrar = (nome: string) => propriedades.find((aba) => normalizar(aba?.title || "") === normalizar(nome));
  const especificacoes = [
    { chave: "novosPendentes" as const, nome: "NOVOS PENDENTES", ultimaColuna: "AR" },
    { chave: "novosMes" as const, nome: "NOVOS MÊS", ultimaColuna: "AR" },
    { chave: "renovacoesAtual" as const, nome: nomeAbaRenovacao(competencia, 0), ultimaColuna: "AA" },
    { chave: "renovacoesFutura" as const, nome: nomeAbaRenovacao(competencia, 1), ultimaColuna: "AA" },
    { chave: "endossos" as const, nome: "ENDOSSOS", ultimaColuna: "U" },
  ];

  const avisos: string[] = [];
  const encontradas = especificacoes.map((spec) => {
    const aba = encontrar(spec.nome);
    if (!aba?.title) avisos.push(`Aba não encontrada: ${spec.nome}. O painel correspondente será exibido zerado.`);
    return { ...spec, aba };
  });

  const comAba = encontradas.filter((item) => item.aba?.title);
  const ranges = comAba.map((item) => {
    const totalLinhas = Math.max(item.aba?.gridProperties?.rowCount || 1, 1);
    return `${escaparNomeAba(item.aba!.title!)}!A1:${item.ultimaColuna}${totalLinhas}`;
  });

  const valores = ranges.length
    ? await api.spreadsheets.values.batchGet({
        spreadsheetId: planilha.id,
        ranges,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "SERIAL_NUMBER",
      })
    : null;

  const abas: FonteRamosBruta["abas"] = {
    novosPendentes: [],
    novosMes: [],
    renovacoesAtual: [],
    renovacoesFutura: [],
    endossos: [],
  };
  const nomesAbas: FonteRamosBruta["nomesAbas"] = {
    novosPendentes: null,
    novosMes: null,
    renovacoesAtual: null,
    renovacoesFutura: null,
    endossos: null,
  };

  comAba.forEach((item, indice) => {
    const linhas = (valores?.data.valueRanges?.[indice]?.values || []) as CelulaGoogle[][];
    abas[item.chave] = linhas.length > 0 ? linhas.slice(1) : [];
    nomesAbas[item.chave] = item.aba?.title || null;
  });

  return {
    competencia,
    planilha: {
      id: planilha.id,
      titulo: metadados.data.properties?.title || planilha.titulo,
      url: metadados.data.spreadsheetUrl || planilha.url,
      modificadaEm: planilha.modificadaEm,
      tipo: "google_sheets",
    },
    abas,
    nomesAbas,
    avisos,
  };
}
