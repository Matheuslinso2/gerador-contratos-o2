// Envia ao Workspace os anexos que o robô baixou do Corp (scripts/robo-corp/anexos.ts):
// cada arquivo vai para o bucket privado "corp-anexos" e ganha uma linha em corp_anexos,
// ligada ao Nosso Nº, na mesma ordem e com o mesmo nome da aba Anexos do Corp
// (supabase/schema_corp_anexos.sql). Decisão do Matheus, 27/10/2026.
// Depois de enviado, o arquivo que não é apólice é apagado da pasta local (a apólice fica
// para a carga do acervo, scripts/apolices/carga-drive.ts com APOLICES_FONTE=corp).
//
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/enviar-anexos.ts [--limite N]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import type { LinhaAnexo } from "./anexos";

const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const ESTADO = path.join(PASTA, "estado.json");
const ENVIADOS = path.join(PASTA, "enviados.json");
const BUCKET = "corp-anexos";
const args = process.argv.slice(2);
const limite = args.includes("--limite") ? Number(args[args.indexOf("--limite") + 1]) : Infinity;
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);
const lerJson = <T>(f: string, padrao: T): T => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : padrao);

// Nome dos tipos já conferidos a olho (recorte da tela do Corp → texto). Tipo novo entra sem
// nome e o ERP mostra o próprio recorte até alguém dar o nome em corp_anexos_tipos.
const TIPOS_CONHECIDOS: Record<string, string> = {
  e13686035870: "Apólice",
  "6b096b0dfa75": "Proposta",
  e1947b4cc768: "Outro",
  "21941a1734c2": "Boleto",
};

const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain", ".zip": "application/zip", ".msg": "application/vnd.ms-outlook", ".eml": "message/rfc822",
};

type Visita = { quando: string; versao?: number; resultado: string; lista?: LinhaAnexo[] };

async function main() {
  const sb = createServiceClient();
  const estado = lerJson<Record<string, Visita>>(ESTADO, {});
  const enviados = lerJson<Record<string, string>>(ENVIADOS, {});
  const pendentes = Object.entries(estado).filter(([nn, v]) => v.lista && enviados[nn] !== v.quando);
  log(`documentos com anexos baixados e ainda não enviados: ${pendentes.length}`);

  // tipos (recortes) que o banco ainda não tem
  const { data: tiposBanco, error: eTipos } = await sb.from("corp_anexos_tipos").select("rotulo_id");
  if (eTipos) throw new Error(eTipos.message);
  const temTipo = new Set((tiposBanco ?? []).map((t) => t.rotulo_id));

  let docs = 0, arquivos = 0, bytes = 0;
  for (const [nn, v] of pendentes.slice(0, limite)) {
    const linhas = [];
    for (const l of v.lista!) {
      if (!temTipo.has(l.rotulo)) {
        const img = path.join(PASTA, "rotulos", `${l.rotulo}.png`);
        const caminho = `_tipos/${l.rotulo}.png`;
        const up = await sb.storage.from(BUCKET).upload(caminho, fs.readFileSync(img), { contentType: "image/png", upsert: true });
        if (up.error) throw new Error(`tipo ${l.rotulo}: ${up.error.message}`);
        const { error } = await sb.from("corp_anexos_tipos").upsert({ rotulo_id: l.rotulo, tipo: TIPOS_CONHECIDOS[l.rotulo] ?? null, imagem_path: caminho });
        if (error) throw new Error(error.message);
        temTipo.add(l.rotulo);
      }
      const local = path.join(PASTA, l.arquivo);
      if (!fs.existsSync(local)) throw new Error(`${nn}: arquivo sumiu da pasta local (${l.arquivo})`);
      const buf = fs.readFileSync(local);
      const sha = createHash("sha256").update(buf).digest("hex");
      const ext = path.extname(l.nome).toLowerCase();
      // caminho no bucket sem o nome original (acentos/espaços); o nome do Corp fica na tabela
      const caminho = `${nn}/${l.ordem}-${sha.slice(0, 16)}${/^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ""}`;
      const mime = MIME[ext] ?? "application/octet-stream";
      const up = await sb.storage.from(BUCKET).upload(caminho, buf, { contentType: mime, upsert: true });
      if (up.error) throw new Error(`${nn} #${l.ordem}: ${up.error.message}`);
      linhas.push({ nosso_numero: nn, ordem: l.ordem, nome: l.nome, rotulo_id: l.rotulo, apolice: l.apolice, bytes: buf.length, sha256: sha, mime, storage_path: caminho, visto_em: v.quando, gravado_em: new Date().toISOString() });
      arquivos++;
      bytes += buf.length;
    }
    if (linhas.length) {
      const { error } = await sb.from("corp_anexos").upsert(linhas, { onConflict: "nosso_numero,ordem" });
      if (error) throw new Error(`${nn}: ${error.message}`);
    }
    // a lista do Corp encolheu desde a última visita: tira as linhas que não existem mais
    const { error: eDel } = await sb.from("corp_anexos").delete().eq("nosso_numero", nn).gt("ordem", linhas.length);
    if (eDel) throw new Error(`${nn}: ${eDel.message}`);
    for (const l of v.lista!) if (!l.apolice) fs.rmSync(path.join(PASTA, l.arquivo), { force: true });
    fs.rmSync(path.join(PASTA, "outros", nn), { recursive: true, force: true });
    enviados[nn] = v.quando;
    fs.writeFileSync(ENVIADOS, JSON.stringify(enviados));
    if (++docs % 100 === 0) log(`  ${docs} documentos, ${arquivos} arquivos, ${Math.round(bytes / 1e6)} MB`);
  }
  log(`enviados: ${docs} documentos, ${arquivos} arquivos, ${Math.round(bytes / 1e6)} MB`);
}

main().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
