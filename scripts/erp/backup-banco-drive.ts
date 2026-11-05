process.loadEnvFile(".env.local");
// Cópia de segurança diária das tabelas do banco (schema public) em arquivos .ndjson.gz, uma pasta por dia, para a pasta do Google Drive (ou local).
// SÓ LEITURA no banco: pagina por chave primária (sem OFFSET), 1.000 linhas por vez, com a trava de saúde (plataforma_saude_leve) — pausa se o banco estiver pressionado.
// Não copia: erp_auditoria (log, tem resumo diário), tabelas sem chave primária (derivadas) e os ARQUIVOS do Storage (PDFs/anexos; o Supabase já guarda).
// Retenção: 7 dias seguidos + 1 por semana (domingo) por 5 semanas. Destino: BACKUP_DESTINO, senão Drive para Computador (Meu Drive\Backups O2 Supabase), senão %USERPROFILE%\Backups-O2.
// Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/backup-banco-drive.ts [--so tabela1,tabela2] [--listar]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createGzip } from "node:zlib";
import { once } from "node:events";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const EXCLUIR = new Set(["erp_auditoria"]);
const PAGINA = 1000;
const LIMITE_CONEXOES_PCT = 60;
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const SO = arg("--so")?.split(",").map((s) => s.trim()).filter(Boolean);

function destinoBase(): string {
  if (process.env.BACKUP_DESTINO) return process.env.BACKUP_DESTINO;
  const home = os.homedir();
  const candidatos = [
    path.join(home, "My Drive"), path.join(home, "Meu Drive"), path.join(home, "Google Drive", "Meu Drive"), path.join(home, "Google Drive", "My Drive"),
    "G:\\Meu Drive", "G:\\My Drive",
  ];
  const drive = candidatos.find((c) => fs.existsSync(c));
  return drive ? path.join(drive, "Backups O2 Supabase") : path.join(home, "Backups-O2");
}

async function saudeOk(): Promise<{ ok: boolean; motivo: string }> {
  const { data, error } = await sb.rpc("plataforma_saude_leve");
  if (error) return { ok: false, motivo: `plataforma_saude_leve falhou: ${error.message}` };
  const s = data as { conexoes_pct?: number; consultas_longas?: number; bloqueios?: number } | null;
  const pct = Number(s?.conexoes_pct ?? 0), longas = Number(s?.consultas_longas ?? 0), bloq = Number(s?.bloqueios ?? 0);
  if (pct > LIMITE_CONEXOES_PCT) return { ok: false, motivo: `conexões em ${pct}%` };
  if (longas > 0) return { ok: false, motivo: `${longas} consulta(s) longa(s)` };
  if (bloq > 0) return { ok: false, motivo: `${bloq} bloqueio(s)` };
  return { ok: true, motivo: `conexões ${pct}%` };
}
async function esperarSaude(): Promise<boolean> {
  for (let t = 0; t < 10; t++) {
    const s = await saudeOk();
    if (s.ok) return true;
    console.log(new Date().toISOString(), "TRAVA: pausado —", s.motivo);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  return false;
}

type Tab = { tabela: string; pk: string[] | null; linhas_aprox: number; mb: number };

async function copiarTabela(t: Tab, pasta: string): Promise<{ linhas: number; bytes: number }> {
  const arq = path.join(pasta, `${t.tabela}.ndjson.gz`);
  const tmp = arq + ".tmp";
  const out = fs.createWriteStream(tmp);
  const gz = createGzip({ level: 6 });
  gz.pipe(out);
  let linhas = 0;
  let ultimo: unknown = null;
  let offset = 0;
  const pk = t.pk!;
  for (let pag = 0; ; pag++) {
    if (pag % 20 === 0 && !(await esperarSaude())) throw new Error("banco não ficou saudável em 10 min");
    let q = sb.from(t.tabela).select("*");
    if (pk.length === 1) { for (const c of pk) q = q.order(c, { ascending: true }); if (ultimo !== null) q = q.gt(pk[0], ultimo as string | number); q = q.limit(PAGINA); }
    else { for (const c of pk) q = q.order(c, { ascending: true }); q = q.range(offset, offset + PAGINA - 1); }
    let r = await q;
    for (let tent = 1; r.error && tent <= 3; tent++) { await new Promise((x) => setTimeout(x, 5000 * tent)); r = await q; }
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as Record<string, unknown>[];
    if (!rows.length) break;
    const texto = rows.map((x) => JSON.stringify(x)).join("\n") + "\n";
    if (!gz.write(texto)) await once(gz, "drain");
    linhas += rows.length;
    offset += rows.length;
    if (pk.length === 1) ultimo = rows[rows.length - 1][pk[0]];
    if (rows.length < PAGINA) break;
    await new Promise((x) => setTimeout(x, 150));
  }
  gz.end();
  await once(out, "finish");
  fs.renameSync(tmp, arq);
  return { linhas, bytes: fs.statSync(arq).size };
}

function aposentar(base: string) {
  const hoje = Date.now();
  for (const nome of fs.readdirSync(base)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nome);
    if (!m) continue;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const idade = (hoje - d.getTime()) / 86_400_000;
    const domingo = d.getUTCDay() === 0;
    if (idade > 35 || (idade > 7 && !domingo)) fs.rmSync(path.join(base, nome), { recursive: true, force: true });
  }
}

async function main() {
  const { data, error } = await sb.rpc("plataforma_tabelas_backup");
  if (error) throw new Error("lista de tabelas: " + error.message);
  const todas = (data as Tab[]);
  if (process.argv.includes("--listar")) { console.table(todas); return; }
  const base = destinoBase();
  const dia = new Date().toISOString().slice(0, 10);
  const pasta = path.join(base, dia);
  fs.mkdirSync(pasta, { recursive: true });
  console.log(new Date().toISOString(), "destino:", pasta);
  const fila = todas.filter((t) => !EXCLUIR.has(t.tabela) && (!SO || SO.includes(t.tabela)));
  const manifesto: Record<string, unknown>[] = [];
  const semChave = fila.filter((t) => !t.pk?.length).map((t) => t.tabela);
  let ok = 0, falhas = 0, totalLinhas = 0, totalBytes = 0;
  for (const t of fila.filter((x) => x.pk?.length).sort((a, b) => a.mb - b.mb)) {
    try {
      const r = await copiarTabela(t, pasta);
      manifesto.push({ tabela: t.tabela, linhas: r.linhas, bytes: r.bytes, linhas_aprox_banco: t.linhas_aprox });
      ok++; totalLinhas += r.linhas; totalBytes += r.bytes;
      console.log(new Date().toISOString(), "ok", t.tabela, r.linhas, "linhas", Math.round(r.bytes / 1024), "KB");
    } catch (e) {
      falhas++;
      manifesto.push({ tabela: t.tabela, erro: (e as Error).message });
      console.log(new Date().toISOString(), "FALHA", t.tabela, (e as Error).message);
      try { fs.rmSync(path.join(pasta, `${t.tabela}.ndjson.gz.tmp`), { force: true }); } catch { /* ignora */ }
    }
  }
  fs.writeFileSync(path.join(pasta, "_manifesto.json"), JSON.stringify({ gerado_em: new Date().toISOString(), tabelas_ok: ok, falhas, linhas: totalLinhas, bytes: totalBytes, sem_chave_primaria_nao_copiadas: semChave, excluidas: [...EXCLUIR], itens: manifesto }, null, 2));
  if (!SO) aposentar(base);
  console.log(new Date().toISOString(), `fim: ${ok} tabelas, ${falhas} falhas, ${totalLinhas} linhas, ${(totalBytes / 1048576).toFixed(1)} MB compactados`);
  if (falhas) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
