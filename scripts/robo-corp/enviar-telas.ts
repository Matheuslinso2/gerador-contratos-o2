// Envia ao Workspace as telas do documento fotografadas pelo robô (telas.ts): imagem webp no bucket PRIVADO "corp-telas" e uma linha por
// (nosso_numero_corp, tela) em erp_corp_telas_documento (status 'capturada', nível 8). Os campos são lidos depois, fora do Corp.
// "não achou" grava a foto da busca com o motivo. Mantém a imagem local (para a leitura). Paralelo 1.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/enviar-telas.ts [--limite N]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const TELAS = path.join(PASTA, "telas");
const ESTADO = path.join(PASTA, "estado.json");
const ENVIADAS = path.join(PASTA, "telas-enviadas.json");
const BUCKET = "corp-telas";
const LOTE = `TELAS-${new Date().toISOString().slice(0, 10)}`;
const limite = process.argv.includes("--limite") ? Number(process.argv[process.argv.indexOf("--limite") + 1]) : Infinity;
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);
const lerJson = <T>(f: string, padrao: T): T => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : padrao);

(async () => {
  const sb = createServiceClient();
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: false });
    if (error) throw new Error("bucket: " + error.message);
    log(`bucket privado ${BUCKET} criado`);
  }
  const estado = lerJson<Record<string, { quando: string; resultado: string }>>(ESTADO, {});
  const enviadas = lerJson<Record<string, string>>(ENVIADAS, {});
  if (!fs.existsSync(TELAS)) { log("nenhuma tela capturada"); return; }
  const pendentes = fs.readdirSync(TELAS).filter((nn) => /^\d+$/.test(nn) && fs.readdirSync(path.join(TELAS, nn)).some((f) => f.endsWith(".webp")) && enviadas[nn] !== (estado[nn]?.quando ?? "?")).slice(0, limite);
  log(`documentos com telas ainda não enviadas: ${pendentes.length}`);
  let docs = 0, imagens = 0, bytes = 0;
  for (const nn of pendentes) {
    const linhas: Record<string, unknown>[] = [];
    for (const f of fs.readdirSync(path.join(TELAS, nn)).filter((x) => x.endsWith(".webp"))) {
      const tela = f.replace(/\.webp$/, "");
      const buf = fs.readFileSync(path.join(TELAS, nn, f));
      const caminho = `${nn}/${f}`;
      const up = await sb.storage.from(BUCKET).upload(caminho, buf, { contentType: "image/webp", upsert: true });
      if (up.error) throw new Error(`${nn}/${f}: ${up.error.message}`);
      const naoAchou = tela === "busca";
      linhas.push({ nosso_numero_corp: Number(nn), tela, status: naoAchou ? "nao_achou" : "capturada", imagem_path: caminho, imagem_bytes: buf.length, motivo: naoAchou ? "busca por Nosso Nº sem linha no resultado (foto da busca guardada)" : null, fonte: "corp_tela", nivel: 8, versao_leitor: 1, lote: LOTE, lido_em: estado[nn]?.quando ?? new Date().toISOString() });
      imagens++; bytes += buf.length;
    }
    const { error } = await sb.from("erp_corp_telas_documento").upsert(linhas, { onConflict: "nosso_numero_corp,tela" });
    if (error) throw new Error(`${nn}: ${error.message}`);
    enviadas[nn] = estado[nn]?.quando ?? "?";
    fs.writeFileSync(ENVIADAS, JSON.stringify(enviadas));
    if (++docs % 100 === 0) log(`  ${docs} documentos, ${imagens} imagens, ${Math.round(bytes / 1e6)} MB`);
  }
  log(`telas enviadas: ${docs} documentos, ${imagens} imagens, ${Math.round(bytes / 1e6)} MB`);
  // liga cada tela ao documento/imobiliária/cliente/seguradora do ERP pelo Nosso nº do Corp (só com 1 candidato; o resto fica com o motivo)
  const { data: lig, error: eLig } = await sb.rpc("erp_ligar_telas");
  if (eLig) log(`ligação ao ERP falhou: ${eLig.message}`); else log(`ligação ao ERP: ${JSON.stringify(lig)}`);
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
