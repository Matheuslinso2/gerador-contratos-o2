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

function clienteSheets() {
  const auth = obterAutenticacaoGoogle(ESCOPOS);
  return sheets({ version: "v4", auth: auth as never });
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

const MESES = [
  "janeiro", "fevereiro", "março", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// As pastas têm arquivos que não são planilhas mensais de cotação de
// verdade: cópias de backup ("Cópia de ...") e planilhas de controle à
// parte (ex: "PLANILHA CONTROLE NEGOCIAÇÕES"). Considera só arquivos cujo
// nome tem um mês do ano (é como as planilhas mensais de verdade são
// nomeadas nas duas pastas) e que não comecem com "Cópia de".
export function ehPlanilhaMensalValida(nomeArquivo: string): boolean {
  const nome = semAcento(nomeArquivo.toLowerCase());
  if (nome.startsWith("copia de")) return false;
  return MESES.some((mes) => nome.includes(semAcento(mes)));
}

export function normalizarTextoBusca(texto: string): string {
  return semAcento(texto.toLowerCase()).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function textoCorresponde(valor: string, busca: string): boolean {
  const a = normalizarTextoBusca(valor);
  const b = normalizarTextoBusca(busca);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// Uma planilha pode ter mais de uma aba (ex: um "resumo" do lote e o
// "detalhamento" linha a linha) — a aba com os dados de verdade nem sempre
// é a primeira. Procura, entre todas as abas, a que tem mais colunas do
// cabeçalho batendo com as colunas esperadas (busca por conterem o nome,
// não exata, já que a grafia varia entre meses).
export async function encontrarAbaDeDados(
  spreadsheetId: string,
  colunasEsperadas: string[]
): Promise<{ aba: string; cabecalho: string[] } | null> {
  const cliente = clienteSheets();
  const metadados = await cliente.spreadsheets.get({ spreadsheetId });
  const abas = (metadados.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => !!t);

  let melhor: { aba: string; cabecalho: string[]; pontos: number } | null = null;

  for (const aba of abas) {
    let valores;
    try {
      valores = await cliente.spreadsheets.values.get({ spreadsheetId, range: `'${aba}'!A1:Z1` });
    } catch {
      continue;
    }
    const cabecalho = (valores.data.values?.[0] ?? []).map((v) => String(v ?? ""));
    const cabecalhoNormalizado = cabecalho.map(normalizarTextoBusca);
    const pontos = colunasEsperadas.filter((esperada) =>
      cabecalhoNormalizado.some((col) => col.includes(normalizarTextoBusca(esperada)))
    ).length;

    if (pontos > 0 && (!melhor || pontos > melhor.pontos)) {
      melhor = { aba, cabecalho, pontos };
    }
  }

  return melhor ? { aba: melhor.aba, cabecalho: melhor.cabecalho } : null;
}

// Lê todas as linhas de dados de uma aba (a partir da linha 2) e devolve
// cada linha como objeto {nomeDaColuna: valor}, usando o cabeçalho passado.
export async function lerLinhasComoObjetos(
  spreadsheetId: string,
  aba: string,
  cabecalho: string[]
): Promise<Record<string, string>[]> {
  const cliente = clienteSheets();
  const ultimaColuna = String.fromCharCode(65 + Math.min(cabecalho.length - 1, 25));
  const valores = await cliente.spreadsheets.values.get({
    spreadsheetId,
    range: `'${aba}'!A2:${ultimaColuna}100000`,
  });

  const linhas = valores.data.values ?? [];
  return linhas
    .filter((linha) => linha.some((v) => String(v ?? "").trim() !== ""))
    .map((linha) => {
      const objeto: Record<string, string> = {};
      cabecalho.forEach((coluna, i) => {
        // Um cabeçalho com só um espaço em branco (comum em planilha
        // editada manualmente) é "verdadeiro" em JS — sem o trim(), a
        // coluna virava a chave " " em vez de "coluna_N", quebrando a
        // busca posicional de colunas sem nome de verdade.
        const nomeColuna = (coluna ?? "").trim();
        objeto[nomeColuna || `coluna_${i + 1}`] = String(linha[i] ?? "");
      });
      return objeto;
    });
}

// Lê o cabeçalho (linha 1) e algumas linhas de amostra (2 a 6) da primeira
// aba de uma planilha — usado só no diagnóstico inicial (página temporária).
export async function lerCabecalhoEAmostra(
  spreadsheetId: string
): Promise<{ aba: string; cabecalho: string[]; amostra: string[][] }> {
  const cliente = clienteSheets();
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
