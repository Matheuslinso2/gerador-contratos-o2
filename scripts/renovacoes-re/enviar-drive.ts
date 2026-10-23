// Robô de renovações RE — envia para o Drive as planilhas de lote do mês e o
// arquivo de extração do Corp, na pasta "PLANILHAS DE REN MM.AAAA" (decisão do
// Matheus, 23/10/2026: lotes individuais + documento de extração juntos, para
// controle). Usa a conta de serviço do Workspace, que precisa ser Editor da pasta.
// Planilhas de lote viram Planilhas Google (a equipe edita on-line); o arquivo
// do Corp vai como veio. Não duplica: arquivo com o mesmo nome é pulado.
// uso: npx tsx scripts/renovacoes-re/enviar-drive.ts --pasta-drive <id> --lotes <pasta local> [--extracao <arquivo>...]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { drive as criarDrive } from "@googleapis/drive";
import { obterAutenticacaoGoogle } from "@/lib/googleAuth";

const args = process.argv.slice(2);
const op = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const pastaDrive = op("--pasta-drive");
const lotes = op("--lotes");
const extracoes = args.flatMap((a, i) => (args[i - 1] === "--extracao" ? [a] : []));
if (!pastaDrive || !lotes) {
  console.error("uso: npx tsx scripts/renovacoes-re/enviar-drive.ts --pasta-drive <id> --lotes <pasta> [--extracao <arquivo>...]");
  process.exit(1);
}
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME: Record<string, string> = { ".xlsx": XLSX_MIME, ".pdf": "application/pdf" };

async function main() {
  const auth = obterAutenticacaoGoogle(["https://www.googleapis.com/auth/drive"]);
  const drive = criarDrive({ version: "v3", auth });
  const existentes = new Set<string>();
  let pageToken: string | undefined;
  do {
    const r = await drive.files.list({
      q: `'${pastaDrive}' in parents and trashed = false`,
      fields: "nextPageToken, files(name)",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
      pageToken,
    });
    for (const f of r.data.files ?? []) existentes.add(f.name ?? "");
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken);

  const envios = [
    ...fs.readdirSync(lotes!).filter((f) => f.endsWith(".xlsx")).map((f) => ({ arquivo: path.join(lotes!, f), converter: true })),
    ...extracoes.map((arquivo) => ({ arquivo, converter: false })),
  ];
  let enviados = 0, pulados = 0;
  for (const { arquivo, converter } of envios) {
    const ext = path.extname(arquivo).toLowerCase();
    const nome = converter ? path.basename(arquivo, ext) : path.basename(arquivo);
    if (existentes.has(nome)) { pulados++; continue; }
    await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: nome, parents: [pastaDrive!], ...(converter ? { mimeType: "application/vnd.google-apps.spreadsheet" } : {}) },
      media: { mimeType: MIME[ext] ?? "application/octet-stream", body: Readable.from(fs.readFileSync(arquivo)) },
      fields: "id",
    });
    enviados++;
    console.log(`enviado: ${nome}`);
  }
  console.log(`pronto: ${enviados} enviados, ${pulados} já estavam na pasta`);
}
main().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
