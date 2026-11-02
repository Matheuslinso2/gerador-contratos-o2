// PÓS-PROCESSAMENTO DOS ROBÔS DO CORP (a cada 6 h, sem login do Corp). Chamado pelo orquestrador (e por anexos-pos.cmd).
// Ordem: junta o estado dos robôs → telas (envio, OCR local, leitura) → envio dos anexos ao Workspace → vinculador/limpeza → leitura dos PDFs novos
// (apólices, OCR local só nos PDFs de imagem; propostas) com aplicação no ERP só do que está vazio e confere → datas de emissão/vencimentos/tabelas prontas → relatório.
// Nunca roda duas vezes ao mesmo tempo (trava) e pula o ciclo se a memória estiver apertada. Nunca usa IA paga.
//   npx tsx scripts/robo-corp/pos-corp.ts [--forcar]     (--forcar ignora o limite de memória)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const RAIZ = process.cwd();
const SAIDA = path.join(RAIZ, "scripts", "robo-corp", "saida"); fs.mkdirSync(SAIDA, { recursive: true });
const TRAVA = path.join(os.homedir(), ".robo-corp", "pos-corp.lock");
const LIMITE_RAM_GB = 1.0;
const inicio = new Date();
const log = (m: string) => { const l = `${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })}  ${m}`; console.log(l); try { fs.appendFileSync(path.join(SAIDA, "pos.log"), l + "\n"); } catch { /* disco */ } };
const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

// trava: nunca duas instâncias
fs.mkdirSync(path.dirname(TRAVA), { recursive: true });
try { fs.mkdirSync(TRAVA); fs.writeFileSync(path.join(TRAVA, "dono.json"), JSON.stringify({ pid: process.pid, desde: Date.now() })); }
catch {
  try { const d = JSON.parse(fs.readFileSync(path.join(TRAVA, "dono.json"), "utf8")) as { pid: number; desde: number }; if (vivo(d.pid) && Date.now() - d.desde < 3 * 3600_000) { log("pós-processamento já está rodando: saindo"); process.exit(0); } } catch { /* trava órfã */ }
  fs.rmSync(TRAVA, { recursive: true, force: true }); fs.mkdirSync(TRAVA); fs.writeFileSync(path.join(TRAVA, "dono.json"), JSON.stringify({ pid: process.pid, desde: Date.now() }));
}
const soltar = () => { try { fs.rmSync(TRAVA, { recursive: true, force: true }); } catch { /* ok */ } };
process.on("exit", soltar);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
type Passo = { nome: string; ok: boolean; codigo: number | null; seg: number };
const passos: Passo[] = [];

function rodar(nome: string, args: string[], timeoutMin = 90): boolean {
  const t0 = Date.now(); log(`passo: ${nome}`);
  const r = spawnSync("cmd.exe", ["/c", "npx.cmd", "tsx", ...args], { cwd: RAIZ, encoding: "utf8", timeout: timeoutMin * 60_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0; passos.push({ nome, ok, codigo: r.status, seg: Math.round((Date.now() - t0) / 1000) });
  try { fs.appendFileSync(path.join(SAIDA, "pos.log"), String(r.stdout ?? "").split("\n").filter((l) => !/sumPrecise|Cannot substitute/.test(l)).slice(-25).join("\n") + "\n"); } catch { /* ok */ }
  if (!ok) log(`  ↳ falhou (código ${r.status}): ${String(r.stderr ?? "").split("\n").filter((l) => l.trim() && !/sumPrecise|Cannot substitute/.test(l)).slice(-2).join(" | ").slice(0, 200)}`);
  return ok;
}
const SEM = ["--require", "./scripts/base-unica/_sem-server-only.cjs"];

async function rpc(nome: string) {
  const t0 = Date.now(); log(`passo: ${nome}`);
  const { error } = await sb.rpc(nome);
  passos.push({ nome, ok: !error, codigo: error ? 1 : 0, seg: Math.round((Date.now() - t0) / 1000) });
  if (error) log(`  ↳ ${nome}: ${error.message.slice(0, 120)}`);
}

async function ocrDosSemTexto() {
  // PDFs de apólice sem texto (imagem) que ainda não passaram pelo OCR local: baixa (até 60 por ciclo), lê com o OCR do Windows e relê com o leitor
  const { data } = await sb.from("erp_apolice_pdf_campos").select("documento_id,fonte_pdf,seguradora_chave,fonte").eq("situacao", "sem_texto").not("fonte", "ilike", "%OCR%").limit(60);
  if (!data?.length) { log("OCR local: nenhum PDF de imagem pendente"); return; }
  const dir = path.join(os.tmpdir(), "o2-ocr-pdf"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const lista: string[] = [];
  for (const c of data) {
    const [o, ...rest] = String(c.fonte_pdf).split(":"); const p = rest.join(":");
    const { data: f } = await sb.storage.from(o === "corp" ? "corp-anexos" : "anexos-documentos").download(p); if (!f) continue;
    const arq = path.join(dir, `${c.seguradora_chave}__${c.documento_id}.pdf`); fs.writeFileSync(arq, Buffer.from(await f.arrayBuffer())); lista.push(arq);
  }
  fs.writeFileSync(path.join(dir, "lista.txt"), lista.join("\n"));
  const t0 = Date.now(); log(`passo: OCR local de ${lista.length} PDF(s) de imagem`);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(RAIZ, "scripts", "erp", "ocr-pdf-win.ps1"), "-Lista", path.join(dir, "lista.txt"), "-Saida", path.join(dir, "ocr.jsonl")], { cwd: RAIZ, timeout: 40 * 60_000, windowsHide: true });
  passos.push({ nome: "ocr local dos PDFs de imagem", ok: r.status === 0, codigo: r.status, seg: Math.round((Date.now() - t0) / 1000) });
  if (fs.existsSync(path.join(dir, "ocr.jsonl"))) rodar("releitura dos PDFs de imagem (OCR)", ["scripts/erp/ler-apolices-vigentes-pdf.ts", "--refazer", "--ocr-jsonl", path.join(dir, "ocr.jsonl")], 30);
}

async function relatorio(situacao: "ok" | "parcial" | "adiado" | "erro") {
  const desde = inicio.toISOString(); const n = async (tabela: string, filtro: (q: any) => any) => { try { const { count } = await filtro(sb.from(tabela).select("*", { count: "exact", head: true })); return count ?? 0; } catch { return 0; } };
  const por = async (tabela: string, col: string, dataCol: string) => { const { data } = await sb.from(tabela).select(col).gte(dataCol, desde).limit(20000); const m: Record<string, number> = {}; for (const x of (data ?? []) as unknown as Record<string, string>[]) m[x[col]] = (m[x[col]] ?? 0) + 1; return m; };
  const resumo = {
    anexos_baixados: await n("corp_anexos", (q) => q.gte("gravado_em", desde)),
    apolices_lidas: await por("erp_apolice_pdf_campos", "situacao", "lido_em"),
    propostas_lidas: await por("erp_proposta_pdf_campos", "situacao", "lido_em"),
    propostas_com_campos_aplicados: await n("erp_proposta_pdf_campos", (q) => q.gte("aplicado_em", desde)),
    divergencias_novas: (await n("erp_apolice_pdf_campos", (q) => q.gte("lido_em", desde).eq("situacao", "divergente"))) + (await n("erp_proposta_pdf_campos", (q) => q.gte("lido_em", desde).eq("situacao", "divergente"))),
    telas_novas: await n("erp_corp_telas_documento", (q) => q.gte("created_at", desde)),
    passos_com_erro: passos.filter((p) => !p.ok).map((p) => p.nome),
  };
  const soma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const texto = [
    `Ciclo dos robôs do Corp — ${inicio.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (${Math.round((Date.now() - inicio.getTime()) / 60000)} min) — ${situacao.toUpperCase()}`,
    `• Arquivos baixados e enviados ao Workspace: ${resumo.anexos_baixados}`,
    `• PDFs de apólice lidos: ${soma(resumo.apolices_lidas)} ${JSON.stringify(resumo.apolices_lidas)}`,
    `• PDFs de proposta lidos: ${soma(resumo.propostas_lidas)} ${JSON.stringify(resumo.propostas_lidas)}; documentos com campos preenchidos no ERP: ${resumo.propostas_com_campos_aplicados}`,
    `• Divergências novas (lista: erp_pdf_divergencias_pendentes): ${resumo.divergencias_novas}`,
    `• Telas de documento novas: ${resumo.telas_novas}`,
    resumo.passos_com_erro.length ? `• Passos com erro: ${resumo.passos_com_erro.join("; ")}` : "• Nenhum passo com erro",
  ].join("\n");
  fs.writeFileSync(path.join(SAIDA, `relatorio-pos-${inicio.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`), texto + "\n");
  const { error } = await sb.from("erp_robo_corp_relatorio").insert({ ciclo_inicio: desde, situacao, resumo, texto, passos });
  if (error) log("relatório no banco: " + error.message.slice(0, 100));
  log("relatório:\n" + texto);
}

(async () => {
  const livre = os.freemem() / 1024 ** 3;
  if (livre < LIMITE_RAM_GB && !process.argv.includes("--forcar")) {
    log(`memória apertada (${livre.toFixed(1)} GB livres < ${LIMITE_RAM_GB}): ciclo adiado para o próximo horário`);
    passos.push({ nome: "memória apertada", ok: false, codigo: null, seg: 0 }); await relatorio("adiado"); return;
  }
  rodar("junta o estado dos robôs", ["scripts/robo-corp/merge-estado.ts"], 5);
  rodar("envia as telas ao bucket", [...SEM, "scripts/robo-corp/enviar-telas.ts"]);
  rodar("OCR local das telas", [...SEM, "scripts/robo-corp/ocr-telas.ts"], 120);
  rodar("lê as telas e grava os campos", [...SEM, "scripts/robo-corp/ler-telas.ts", "--gravar"]);
  rodar("envia os anexos baixados ao Workspace", [...SEM, "scripts/robo-corp/enviar-anexos.ts"], 120);
  rodar("confere cada anexo novo com o documento (seguradora/nº/titular no PDF)", [...SEM, "scripts/robo-corp/conferir-anexos.ts", "--todos", "--gravar"], 120);
  rodar("vincula as telas ao ERP", [...SEM, "scripts/robo-corp/vincular-telas.ts", "--gravar"]);
  rodar("limpa as fotos já enviadas", [...SEM, "scripts/robo-corp/limpar-telas.ts", "--gravar"]);
  rodar("lê os PDFs de apólice novos (texto nativo)", ["scripts/erp/ler-apolices-vigentes-pdf.ts"], 120);
  await ocrDosSemTexto();
  rodar("lê os PDFs de proposta novos", ["scripts/erp/ler-propostas-pdf.ts"], 120);
  rodar("aplica no ERP o que está vazio e confere (propostas)", ["scripts/erp/ler-propostas-pdf.ts", "--aplicar"], 30);
  await rpc("erp_preencher_dt_emissao");
  await rpc("erp_atualizar_vencimentos");
  await rpc("erp_cobranca_atualizar");
  await relatorio(passos.some((p) => !p.ok) ? "parcial" : "ok");
})().catch(async (e) => { log("ERRO no pós-processamento: " + (e as Error).message); try { await relatorio("erro"); } catch { /* ok */ } process.exit(1); });
