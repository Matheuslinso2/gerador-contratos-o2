import { sheets } from "@googleapis/sheets";
import { drive, type drive_v3 } from "@googleapis/drive";
import { obterAutenticacaoGoogle } from "@/lib/googleAuth";

const ESCOPOS = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

const PROFUNDIDADE_MAXIMA = 4;

export type PlanilhaDaPasta = { id: string; nome: string };

function clienteDrive() {
  const auth = obterAutenticacaoGoogle(ESCOPOS);
  return drive({ version: "v3", auth: auth as never });
}

// As planilhas de cotação nem sempre ficam direto na pasta compartilhada —
// às vezes tem uma subpasta por ano no meio do caminho (ex: "2025", "2026").
// Entra recursivamente em qualquer subpasta encontrada, até um limite de
// profundidade, juntando todas as planilhas encontradas em qualquer nível.
async function listarRecursivo(
  cliente: drive_v3.Drive,
  folderId: string,
  profundidade: number
): Promise<PlanilhaDaPasta[]> {
  if (profundidade > PROFUNDIDADE_MAXIMA) return [];

  // As pastas de cotação ficam dentro de um Drive Compartilhado — sem essas
  // três opções, a API simplesmente não retorna nada de dentro de Drives
  // Compartilhados, mesmo com a pasta corretamente compartilhada.
  const resposta = await cliente.files.list({
    q: `'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.folder')`,
    fields: "files(id, name, mimeType, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });

  const arquivos = resposta.data.files ?? [];

  const planilhas: PlanilhaDaPasta[] = arquivos
    .filter((f) => f.mimeType === "application/vnd.google-apps.spreadsheet" && f.id && f.name)
    .map((f) => ({ id: f.id!, nome: f.name! }));

  const subpastas = arquivos.filter((f) => f.mimeType === "application/vnd.google-apps.folder" && f.id);
  for (const sub of subpastas) {
    planilhas.push(...(await listarRecursivo(cliente, sub.id!, profundidade + 1)));
  }

  return planilhas;
}

// Uma ou mais pastas-raiz (ex: uma pasta "Fiança 2025" e outra "Fiança
// 2026", se a estrutura de subpastas não puder ser toda compartilhada de
// uma vez) — junta e remove duplicatas.
export async function listarPlanilhasDasPastas(folderIds: string[]): Promise<PlanilhaDaPasta[]> {
  const cliente = clienteDrive();
  const listas = await Promise.all(folderIds.map((id) => listarRecursivo(cliente, id, 0)));
  const vistos = new Set<string>();
  const resultado: PlanilhaDaPasta[] = [];
  for (const planilha of listas.flat()) {
    if (vistos.has(planilha.id)) continue;
    vistos.add(planilha.id);
    resultado.push(planilha);
  }
  return resultado;
}

// Lê IDs de pasta a partir de uma variável de ambiente, aceitando uma ou
// várias pastas separadas por vírgula.
export function idsDePastasDoEnv(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
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
