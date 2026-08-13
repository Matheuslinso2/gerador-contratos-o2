import "server-only";

import { drive } from "@googleapis/drive";
import { sheets } from "@googleapis/sheets";
import { obterAutenticacaoGoogle } from "@/lib/googleAuth";
import { textoCorresponde } from "@/lib/textoCorresponde";

// Cruza os dados extraídos de um e-mail de confirmação com a planilha
// "COTAÇÃO DIÁRIA RE" do mês correspondente -- mesma planilha/pasta já lida
// por src/lib/ramos-elementares/fonteGoogle.ts, só que aqui lemos colunas
// que o painel de Ramos Elementares não precisa (SEGURADO, APÓLICE), então
// é uma leitura própria em vez de reaproveitar aquele módulo.

export type ResultadoCorrespondencia = {
  encontrado: boolean;
  aba: string | null;
  linha: number | null;
  status: string | null;
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
    contexto: "Verificação de e-mails de incêndio",
  });
}

function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

function nomeAbaRenovacao(data: Date, deslocamentoMeses: number): string {
  const referencia = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + deslocamentoMeses, 1));
  return `RN ${MESES[referencia.getUTCMonth()]}`;
}

// Mesma lógica de resolverPlanilhaDaCompetencia (fonteGoogle.ts), mas
// buscando pelo mês da DATA DO E-MAIL em vez de uma competência escolhida
// na tela -- o e-mail chega e cruza contra a planilha do mês em que chegou.
async function resolverPlanilhaDoMes(data: Date): Promise<string | null> {
  const pastaId = process.env.RAMOS_ELEMENTARES_DRIVE_FOLDER_ID?.trim();
  if (!pastaId) return null;

  const autenticacao = obterAutenticacaoRamos(["https://www.googleapis.com/auth/drive.readonly"]);
  const api = drive({ version: "v3", auth: autenticacao });

  const arquivos: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const resposta = await api.files.list({
      q: `'${pastaId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`,
      fields: "nextPageToken,files(id,name)",
      pageSize: 100,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    for (const arquivo of resposta.data.files || []) {
      if (arquivo.id && arquivo.name) arquivos.push({ id: arquivo.id, name: arquivo.name });
    }
    pageToken = resposta.data.nextPageToken || undefined;
  } while (pageToken);

  const mes = MESES[data.getUTCMonth()];
  const ano = data.getUTCFullYear();
  const encontrada = arquivos.find((arquivo) => {
    const nome = normalizar(arquivo.name);
    return !nome.startsWith("COPIA DE") && nome.includes("COTACAO DIARIA RE") && (nome.includes(`${mes}/${ano}`) || nome.includes(`${mes} ${ano}`));
  });
  return encontrada?.id ?? null;
}

async function lerAba(
  api: ReturnType<typeof sheets>,
  spreadsheetId: string,
  nomeAba: string,
  ultimaColuna: string
): Promise<(string | number | boolean | null)[][]> {
  try {
    const resposta = await api.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba.replace(/'/g, "''")}'!A2:${ultimaColuna}5000`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    return (resposta.data.values || []) as (string | number | boolean | null)[][];
  } catch {
    return []; // aba não existe (ex: mês sem "RN" daquele nome) -- não é erro fatal
  }
}

export async function encontrarCorrespondenciaPlanilha(params: {
  clienteNome: string;
  seguradora: string | null;
  numeroApolice: string | null;
  dataReferencia: Date;
  // Assunto do e-mail recebido -- a coluna "ASSUNTO DO EMAIL" (NOVOS
  // PENDENTES/NOVOS MÊS) é preenchida pelo negociador com o assunto do
  // e-mail daquela negociação, e como o assunto costuma se repetir
  // (Re:/RES: mantém o texto original) essa é uma correspondência bem mais
  // confiável do que casar só pelo nome do segurado.
  assuntoEmail?: string | null;
  // true para e-mails de LOTE (várias apólices numa mensagem só) -- nesses
  // casos cliente_nome não é um nome de verdade, então pulamos a
  // correspondência por nome e só aceitamos sinais fortes e inequívocos
  // (número de apólice exato ou assunto do e-mail batendo).
  apenasSinaisFortes?: boolean;
}): Promise<ResultadoCorrespondencia> {
  const spreadsheetId = await resolverPlanilhaDoMes(params.dataReferencia);
  if (!spreadsheetId) return { encontrado: false, aba: null, linha: null, status: null };

  const autenticacao = obterAutenticacaoRamos(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const api = sheets({ version: "v4", auth: autenticacao });

  const clienteBusca = normalizar(params.clienteNome);
  const seguradoraBusca = params.seguradora ? normalizar(params.seguradora) : null;
  const apoliceBusca = params.numeroApolice ? apenasDigitos(params.numeroApolice) : null;
  const assuntoBusca = params.assuntoEmail?.trim() || null;

  // NOVOS PENDENTES / NOVOS MÊS: col 0 status, col 14 segurado, col 26
  // seguradora, col 38 "ASSUNTO DO EMAIL".
  const abasNovos: { nomeAba: string; linhas: (string | number | boolean | null)[][] }[] = [];
  for (const nomeAba of ["NOVOS PENDENTES", "NOVOS MÊS"]) {
    abasNovos.push({ nomeAba, linhas: await lerAba(api, spreadsheetId, nomeAba, "AR") });
  }
  if (assuntoBusca) {
    for (const { nomeAba, linhas } of abasNovos) {
      for (let i = 0; i < linhas.length; i++) {
        const assuntoLinha = String(linhas[i][38] ?? "").trim();
        if (!assuntoLinha || !textoCorresponde(assuntoLinha, assuntoBusca)) continue;
        return { encontrado: true, aba: nomeAba, linha: i + 2, status: String(linhas[i][0] ?? "") || null };
      }
    }
  }
  if (!params.apenasSinaisFortes) {
    for (const { nomeAba, linhas } of abasNovos) {
      for (let i = 0; i < linhas.length; i++) {
        const segurado = String(linhas[i][14] ?? "");
        if (!segurado || !textoCorresponde(segurado, clienteBusca)) continue;
        const seguradoraLinha = String(linhas[i][26] ?? "");
        if (seguradoraBusca && seguradoraLinha && !textoCorresponde(seguradoraLinha, seguradoraBusca)) continue;
        return { encontrado: true, aba: nomeAba, linha: i + 2, status: String(linhas[i][0] ?? "") || null };
      }
    }
  }

  // Renovações (mês do e-mail e o seguinte, já que "RN" cobre 2 meses por
  // planilha): col 0 status, col 2 apólice, col 5 segurado, col 8 seguradora.
  for (const deslocamento of [0, 1]) {
    const nomeAba = nomeAbaRenovacao(params.dataReferencia, deslocamento);
    const linhas = await lerAba(api, spreadsheetId, nomeAba, "AA");
    for (let i = 0; i < linhas.length; i++) {
      const apoliceLinha = apenasDigitos(String(linhas[i][2] ?? ""));
      if (apoliceBusca && apoliceLinha && apoliceLinha === apoliceBusca) {
        return { encontrado: true, aba: nomeAba, linha: i + 2, status: String(linhas[i][0] ?? "") || null };
      }
      if (params.apenasSinaisFortes) continue;
      const segurado = String(linhas[i][5] ?? "");
      if (!segurado || !textoCorresponde(segurado, clienteBusca)) continue;
      const seguradoraLinha = String(linhas[i][8] ?? "");
      if (seguradoraBusca && seguradoraLinha && !textoCorresponde(seguradoraLinha, seguradoraBusca)) continue;
      return { encontrado: true, aba: nomeAba, linha: i + 2, status: String(linhas[i][0] ?? "") || null };
    }
  }

  // ENDOSSOS: col 0 status, col 6 segurado, col 8 apólice, col 9 seguradora.
  const linhasEndosso = await lerAba(api, spreadsheetId, "ENDOSSOS", "U");
  for (let i = 0; i < linhasEndosso.length; i++) {
    const apoliceLinha = apenasDigitos(String(linhasEndosso[i][8] ?? ""));
    if (apoliceBusca && apoliceLinha && apoliceLinha === apoliceBusca) {
      return { encontrado: true, aba: "ENDOSSOS", linha: i + 2, status: String(linhasEndosso[i][0] ?? "") || null };
    }
    if (params.apenasSinaisFortes) continue;
    const segurado = String(linhasEndosso[i][6] ?? "");
    if (!segurado || !textoCorresponde(segurado, clienteBusca)) continue;
    const seguradoraLinha = String(linhasEndosso[i][9] ?? "");
    if (seguradoraBusca && seguradoraLinha && !textoCorresponde(seguradoraLinha, seguradoraBusca)) continue;
    return { encontrado: true, aba: "ENDOSSOS", linha: i + 2, status: String(linhasEndosso[i][0] ?? "") || null };
  }

  return { encontrado: false, aba: null, linha: null, status: null };
}
