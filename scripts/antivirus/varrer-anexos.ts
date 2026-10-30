// Antivírus dos anexos dos formulários públicos (revisão de segurança 30/10/2026,
// item E, versão gratuita): roda no computador do Matheus pelo Agendador de
// Tarefas (varrer-anexos.cmd, a cada 30 min). Baixa cada anexo novo dos buckets
// públicos, passa o Microsoft Defender (MpCmdRun) e, se achar ameaça, move o
// arquivo para "quarentena/" no próprio bucket e manda alerta por e-mail.
//
// Limite conhecido: o formulário já anexa o arquivo ao card/e-mail na hora do
// envio -- a varredura é depois (até 30 min). O Gmail também varre o anexo do
// e-mail; isto é uma segunda camada, não um bloqueio na entrada.
//
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/antivirus/varrer-anexos.ts
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServiceClient } from "@/lib/supabase/service";
import { alertarAdmin } from "@/lib/email";

const BUCKETS = ["seguro-auto-anexos", "seguro-incendio-anexos", "seguro-celular-anexos", "condominio-anexos"];
const DEFENDER = "C:\\Program Files\\Windows Defender\\MpCmdRun.exe";
const SAIDA = path.join("scripts", "antivirus", "saida");
const ESTADO = path.join(SAIDA, "verificados.json");
const PASTA_TEMP = path.join(os.tmpdir(), "o2-antivirus");

type Estado = Record<string, string>; // "bucket/caminho" -> data da verificação

const sb = createServiceClient();

async function listarTudo(bucket: string, prefixo = ""): Promise<string[]> {
  const caminhos: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefixo, { limit: 1000, offset });
    if (error) throw new Error(`Falha ao listar ${bucket}/${prefixo}: ${error.message}`);
    for (const item of data ?? []) {
      const completo = prefixo ? `${prefixo}/${item.name}` : item.name;
      if (item.id === null) {
        if (completo !== "quarentena") caminhos.push(...(await listarTudo(bucket, completo)));
      } else {
        caminhos.push(completo);
      }
    }
    if (!data || data.length < 1000) break;
  }
  return caminhos;
}

// 0 = limpo, 2 = ameaça encontrada (códigos do MpCmdRun). Se o Defender em
// tempo real apagar o arquivo assim que ele é gravado, também conta como ameaça.
function varrer(arquivo: string): "limpo" | "ameaca" | "erro" {
  if (!fs.existsSync(arquivo)) return "ameaca";
  const r = spawnSync(DEFENDER, ["-Scan", "-ScanType", "3", "-File", arquivo, "-DisableRemediation"], { encoding: "utf8" });
  if (r.status === 0) return "limpo";
  if (r.status === 2) return "ameaca";
  console.error(`Defender saiu com código ${r.status}: ${(r.stdout || r.stderr || "").slice(0, 300)}`);
  return "erro";
}

async function main() {
  if (!fs.existsSync(DEFENDER)) throw new Error(`Microsoft Defender não encontrado em ${DEFENDER}`);
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.mkdirSync(PASTA_TEMP, { recursive: true });
  const estado: Estado = fs.existsSync(ESTADO) ? JSON.parse(fs.readFileSync(ESTADO, "utf8")) : {};

  let verificados = 0;
  const ameacas: string[] = [];
  for (const bucket of BUCKETS) {
    for (const caminho of await listarTudo(bucket)) {
      const chave = `${bucket}/${caminho}`;
      if (estado[chave]) continue;

      const { data, error } = await sb.storage.from(bucket).download(caminho);
      if (error || !data) {
        console.error(`Não baixou ${chave}: ${error?.message}`);
        continue;
      }
      const local = path.join(PASTA_TEMP, `${Date.now()}-${path.basename(caminho)}`);
      try {
        fs.writeFileSync(local, Buffer.from(await data.arrayBuffer()));
      } catch {
        // gravação bloqueada pelo Defender em tempo real = ameaça
      }
      const resultado = varrer(local);
      fs.rmSync(local, { force: true });

      if (resultado === "erro") continue; // tenta de novo na próxima rodada
      if (resultado === "ameaca") {
        const destino = `quarentena/${caminho}`;
        const { error: erroMover } = await sb.storage.from(bucket).move(caminho, destino);
        ameacas.push(`${chave} → ${erroMover ? `NÃO movido (${erroMover.message})` : `${bucket}/${destino}`}`);
      }
      estado[chave] = new Date().toISOString();
      verificados++;
    }
  }

  fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 1));
  console.log(`${new Date().toISOString()} verificados ${verificados} novo(s), ${ameacas.length} ameaça(s).`);

  if (ameacas.length) {
    await alertarAdmin({
      contexto: `Antivírus encontrou ${ameacas.length} anexo(s) com ameaça nos formulários públicos. O arquivo foi movido para a pasta quarentena do bucket. Confira o card/e-mail correspondente (o código antes da primeira barra é o envio do formulário) e não abra o anexo.`,
      detalhe: ameacas.join("\n"),
      quem: "Antivírus dos anexos",
    });
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
});
