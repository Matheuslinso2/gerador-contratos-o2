import { sheets } from "@googleapis/sheets";
import { drive } from "@googleapis/drive";
import { obterAutenticacaoGoogle } from "@/lib/googleAuth";

const ESCOPOS = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

export type PlanilhaDaPasta = { id: string; nome: string };

// Cada pasta (incêndio, fiança) tem uma planilha por mês. Lista todas as
// planilhas (Google Sheets) dentro de uma pasta, mais recentes primeiro.
export async function listarPlanilhasDaPasta(folderId: string): Promise<PlanilhaDaPasta[]> {
  const auth = obterAutenticacaoGoogle(ESCOPOS);
  const cliente = drive({ version: "v3", auth: auth as never });

  const resposta = await cliente.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 100,
  });

  return (resposta.data.files ?? [])
    .filter((f): f is { id: string; name: string } => !!f.id && !!f.name)
    .map((f) => ({ id: f.id, nome: f.name }));
}

// Lê o cabeçalho (linha 1) e algumas linhas de amostra (2 a 6) da primeira
// aba de uma planilha — usado tanto no diagnóstico inicial quanto, depois,
// para saber em qual coluna procurar cada dado.
export async function lerCabecalhoEAmostra(
  spreadsheetId: string
): Promise<{ aba: string; cabecalho: string[]; amostra: string[][] }> {
  const auth = obterAutenticacaoGoogle(ESCOPOS);
  const cliente = sheets({ version: "v4", auth: auth as never });

  const metadados = await cliente.spreadsheets.get({ spreadsheetId });
  const aba = metadados.data.sheets?.[0]?.properties?.title ?? "Página1";

  const valores = await cliente.spreadsheets.values.get({
    spreadsheetId,
    range: `'${aba}'!A1:Z6`,
  });

  const linhas = valores.data.values ?? [];
  const cabecalho = (linhas[0] ?? []).map((v) => String(v ?? ""));
  const amostra = linhas.slice(1).map((linha) => linha.map((v) => String(v ?? "")));

  return { aba, cabecalho, amostra };
}
