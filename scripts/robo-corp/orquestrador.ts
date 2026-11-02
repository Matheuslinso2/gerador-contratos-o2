// ORQUESTRADOR DO CORP — 24 horas, N logins, um robô por login (Matheus 02/11/2026).
// Cada login do Corp é um robô independente (CORP_LOGIN=<id>); nunca dois robôs no mesmo login (trava por login em ~/.robo-corp). Este processo único decide, pela grade
// (grade-24h.json), o que cada login faz em cada minuto e faz a passagem de vez SEM matar ninguém no meio do documento: pede a pausa por arquivo
// (pausar-docs[-<login>].flag / pausar-baixa[-<login>].flag), espera o robô terminar o documento/linha em andamento e só então libera.
// Compromissos fixos (Robo Corp 12:00/20:00 e ciclo de comissões) rodam no login principal e têm prioridade. Os demais logins ficam sempre nos documentos
// (e o login da baixa, quando a baixa em blocos estiver ligada e SEM o que baixar, também ajuda nos documentos).
//   npx tsx scripts/robo-corp/orquestrador.ts              roda para sempre (tarefa do Windows)
//   npx tsx scripts/robo-corp/orquestrador.ts --simular    imprime o que cada login faria nas próximas 24 h (não executa nada)
// Log: scripts/robo-corp/saida/orquestrador.log. NUNCA lê nem grava senha: só inicia os scripts existentes com CORP_LOGIN=<id>.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const RAIZ = path.resolve(process.cwd());
const PASTA = path.join(RAIZ, "scripts", "robo-corp");
const SAIDA = path.join(PASTA, "saida"); fs.mkdirSync(SAIDA, { recursive: true });
const HOME = path.join(os.homedir(), ".robo-corp"); fs.mkdirSync(HOME, { recursive: true });
const LIGA_BAIXA = path.join(HOME, "baixa-ligada.flag"); // só existe quando o Matheus liga o robô de baixa em blocos (ver ORQUESTRADOR.md)
const GRADE_ARQ = process.env.GRADE_ARQ ?? path.join(PASTA, "grade-24h.json");
const cam = (c: string) => (path.isAbsolute(c) ? c : path.join(PASTA, c));

type Fixo = { nome: string; cmd: string; horas: string[]; duracaoMin: number; dias: "todos" | "uteis" | "fds" };
type Faixa = { dias: "todos" | "uteis" | "fds"; de: string; ate: string; robo: "docs" | "baixa" };
type Worker = { id: string; fixos?: boolean; agenda?: Faixa[] };
type Grade = { fixos: Fixo[]; workers: Worker[]; baixaComando: string | null; docsComando: string; posProcessamento: { cmd: string; horas: string[] }; folgaPassagemMin: number; esperaLoginMin: number; retentarMin: number; semPermissaoPausaMin: number; baixaSemTrabalhoMin: number };
const grade: Grade = JSON.parse(fs.readFileSync(GRADE_ARQ, "utf8"));
const min = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const agoraSP = (t = new Date()) => { const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(t); const g = (k: string) => p.find((x) => x.type === k)!.value; return { data: `${g("year")}-${g("month")}-${g("day")}`, minutos: +g("hour") * 60 + +g("minute"), dow: g("weekday") }; };
const ehUtil = (dow: string) => !/^(s[áa]b|dom|sat|sun)/i.test(dow);
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const log = (m: string) => { const l = `${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })}  ${m}`; console.log(l); try { fs.appendFileSync(path.join(SAIDA, "orquestrador.log"), l + "\n"); } catch { /* disco */ } };
const flagDocs = (id: string) => path.join(HOME, id === "principal" ? "pausar-docs.flag" : `pausar-docs-${id}.flag`);
const flagBaixa = (id: string) => path.join(HOME, id === "principal" ? "pausar-baixa.flag" : `pausar-baixa-${id}.flag`);

type Quem = { robo: "docs" | "baixa" | "fixo"; nome: string; ate: number; fixo?: Fixo; chave?: string };
const diaOk = (d: "todos" | "uteis" | "fds", util: boolean) => d === "todos" || (d === "uteis" && util) || (d === "fds" && !util);

/** O que este login deve fazer neste minuto (t = minutos do dia). */
export function quemTem(w: Worker, t: number, util: boolean, data: string, jaFeitos: Set<string>): Quem {
  if (w.fixos) {
    for (const f of grade.fixos) {
      if (!diaOk(f.dias, util)) continue;
      for (const h of f.horas) {
        const ini = min(h); const chave = `${data} ${f.nome} ${h}`;
        if (!jaFeitos.has(chave) && t >= ini - grade.folgaPassagemMin && t < ini + f.duracaoMin) return { robo: "fixo", nome: `${f.nome} ${h}`, ate: ini + f.duracaoMin, fixo: f, chave };
      }
    }
  }
  for (const b of w.agenda ?? []) {
    if (!diaOk(b.dias, util)) continue;
    const de = min(b.de), ate = b.ate === "24:00" ? 1440 : min(b.ate);
    if (t >= de && t < ate) return { robo: b.robo, nome: b.robo, ate };
  }
  return { robo: "docs", nome: "docs", ate: 1440 };
}
/** Próximo compromisso fixo (menos a folga de passagem) depois do minuto t: até lá o robô de bloco pode ir. */
function proximoFixo(w: Worker, t: number, util: boolean, data: string, jaFeitos: Set<string>): number {
  let melhor = 1440 + 24 * 60; if (!w.fixos) return melhor;
  for (const f of grade.fixos) { if (!diaOk(f.dias, util)) continue; for (const h of f.horas) { const ini = min(h) - grade.folgaPassagemMin; if (ini > t && !jaFeitos.has(`${data} ${f.nome} ${h}`)) melhor = Math.min(melhor, ini); } }
  return melhor;
}

if (process.argv.includes("--simular")) {
  const t0 = new Date(); const baixaLigada = !!grade.baixaComando && process.argv.includes("--com-baixa");
  for (const w of grade.workers) {
    console.log(`\n== login "${w.id}"${w.fixos ? " (compromissos fixos)" : ""}`);
    const feitos = new Set<string>(); let ant = ""; let ini = "";
    for (let k = 0; k <= 24 * 60; k++) {
      const d = new Date(t0.getTime() + k * 60_000); const a = agoraSP(d); const q = quemTem(w, a.minutos, ehUtil(a.dow), a.data, feitos);
      const rot = q.robo === "baixa" && !baixaLigada ? "docs (vez da baixa: robô de baixa ainda não ligado)" : q.nome;
      if (rot !== ant) { if (ant) console.log(`  ${ini} → ${hhmm(a.minutos)}  ${ant}`); ant = rot; ini = hhmm(a.minutos); }
    }
    console.log(`  ${ini} → ...  ${ant}`);
  }
  process.exit(0);
}

// ------------------------------------------------------------ execução (um estado por login)
type Estado = { w: Worker; filho: ChildProcess | null; nome: string; robo: Quem["robo"] | ""; desde: number; ultimaFalha: number; pausaAte: number; baixaSemTrabalhoAte: number };
const est = new Map<string, Estado>(grade.workers.map((w) => [w.id, { w, filho: null, nome: "", robo: "", desde: 0, ultimaFalha: 0, pausaAte: 0, baixaSemTrabalhoAte: 0 }]));
const recusas = new Map<string, number>(); const jaFeitos = new Set<string>(); let posFeito = "";

function iniciar(e: Estado, q: Quem, ateMin: number) {
  const env = { ...process.env, CORP_VEZ_ESPERA_MIN: String(grade.esperaLoginMin), CORP_LOGIN: e.w.id === "principal" ? "" : e.w.id };
  let args: string[];
  if (q.robo === "fixo") args = ["/c", cam(q.fixo!.cmd)];
  else if (q.robo === "docs") args = ["/c", cam(grade.docsComando), hhmm(ateMin)];
  else args = ["/c", cam(grade.baixaComando!), hhmm(ateMin)];
  for (const f of [flagDocs(e.w.id), flagBaixa(e.w.id)]) { try { fs.unlinkSync(f); } catch { /* não existe */ } }
  const filho = spawn("cmd.exe", args, { cwd: RAIZ, env, stdio: "ignore", windowsHide: true });
  e.filho = filho; e.nome = q.nome; e.robo = q.robo; e.desde = Date.now();
  log(`[${e.w.id}] ASSUMIU o Corp: ${q.nome} (até ${hhmm(ateMin)})`);
  filho.on("exit", (c) => {
    if (e.filho !== filho) return;
    const dur = Date.now() - e.desde;
    log(`[${e.w.id}] LIBEROU o Corp: ${e.nome} terminou (código ${c}) após ${Math.round(dur / 60000)} min`);
    if (c === 0) recusas.set(e.w.id, 0);
    if (c === 3) { e.pausaAte = Date.now() + grade.semPermissaoPausaMin * 60_000; log(`[${e.w.id}] LOGIN SEM PERMISSÃO: o Matheus precisa copiar as permissões desse login. Pauso este login por ${grade.semPermissaoPausaMin} min.`); }
    else if (c === 4) { recusas.set(e.w.id, (recusas.get(e.w.id) ?? 0) + 1); const n = recusas.get(e.w.id)!; if (n >= 3) { e.pausaAte = Date.now() + grade.semPermissaoPausaMin * 60_000; log(`[${e.w.id}] LOGIN RECUSADO ${n}x seguidas pelo Corp (nome/senha). Pauso este login por ${grade.semPermissaoPausaMin} min para não gerar bloqueio; avisar o Matheus.`); } else { e.ultimaFalha = Date.now(); log(`[${e.w.id}] login não entrou (${n}/3): tento de novo em ${grade.retentarMin} min (pode ser disputa da tela de login entre robôs)`); } }
    else if (c === 10 && e.robo === "baixa") { e.baixaSemTrabalhoAte = Date.now() + grade.baixaSemTrabalhoMin * 60_000; log(`[${e.w.id}] baixa sem o que baixar: ajuda nos documentos por ${grade.baixaSemTrabalhoMin} min`); }
    else if ((c !== 0 || dur < 2 * 60_000) && dur < 3 * 60_000) { e.ultimaFalha = Date.now(); log(`[${e.w.id}] saída rápida (${Math.round(dur / 1000)} s): espero ${grade.retentarMin} min antes de tentar de novo (ver o log do robô)`); }
    e.filho = null; e.robo = "";
  });
}
async function pedirPassagem(e: Estado): Promise<void> {
  if (!e.filho || e.robo === "fixo") return; // fixo (robo-corp / ciclo) termina sozinho; nunca é interrompido
  const flag = e.robo === "baixa" ? flagBaixa(e.w.id) : flagDocs(e.w.id);
  fs.writeFileSync(flag, `passagem de vez pedida pelo orquestrador ${new Date().toISOString()}`);
  log(`[${e.w.id}] passagem de vez: pedi pausa a ${e.nome} (termina o documento/linha em andamento)`);
  const limite = Date.now() + 12 * 60_000;
  while (e.filho && Date.now() < limite) await new Promise((r) => setTimeout(r, 5000));
  if (e.filho) { log(`[${e.w.id}] ${e.nome} não liberou em 12 min: encerrando o processo`); spawnSync("taskkill", ["/PID", String(e.filho.pid), "/T", "/F"]); await new Promise((r) => setTimeout(r, 3000)); e.filho = null; e.robo = ""; }
  try { fs.unlinkSync(flag); } catch { /* ok */ }
}

/** o login extra já foi acrescentado ao config.json pelo Matheus? Só procura o id no texto (não interpreta nem guarda nada do arquivo, muito menos senhas). */
const avisouSemConfig = new Map<string, number>();
function loginConfigurado(id: string): boolean {
  if (id === "principal") return true;
  try { return new RegExp('"id"\\s*:\\s*"' + id + '"').test(fs.readFileSync(path.join(HOME, "config.json"), "utf8")); } catch { return false; }
}
async function cicloDoLogin(e: Estado) {
  const a = agoraSP(); const util = ehUtil(a.dow);
  if (!e.filho && !loginConfigurado(e.w.id)) { if (Date.now() - (avisouSemConfig.get(e.w.id) ?? 0) > 3600_000) { avisouSemConfig.set(e.w.id, Date.now()); log(`[${e.w.id}] login ainda não configurado em config.json (logins.lista): aguardando o Matheus acrescentar; este login fica parado`); } return; }
  // reserva do login para uso avulso (ex.: painel-corp.ts): enquanto reservar-<login>.flag existir (até 90 min) o orquestrador libera o login e não lança nada nele
  const reserva = path.join(HOME, `reservar-${e.w.id}.flag`);
  try { if (fs.existsSync(reserva)) { if (Date.now() - fs.statSync(reserva).mtimeMs > 90 * 60_000) fs.unlinkSync(reserva); else { if (e.filho && e.robo !== "fixo") await pedirPassagem(e); return; } } } catch { /* ok */ }
  if (Date.now() < e.pausaAte || Date.now() - e.ultimaFalha < grade.retentarMin * 60_000) return; // sem permissão / falha rápida: espera antes de tentar de novo
  const q = quemTem(e.w, a.minutos, util, a.data, jaFeitos);
  let efetivo: Quem = q;
  if (q.robo === "baixa" && (!grade.baixaComando || !fs.existsSync(LIGA_BAIXA) || Date.now() < e.baixaSemTrabalhoAte)) efetivo = { ...q, robo: "docs", nome: "docs (vez da baixa: sem baixa ligada ou sem o que baixar)" };
  const mesmo = e.filho && ((e.robo === efetivo.robo && efetivo.robo !== "fixo") || (e.robo === "fixo" && efetivo.robo === "fixo" && e.nome === efetivo.nome));
  if (mesmo) return;
  if (e.filho) { if (e.robo === "fixo") return; await pedirPassagem(e); }
  if (efetivo.robo === "fixo" && efetivo.chave) jaFeitos.add(efetivo.chave);
  // robô de documentos nos logins sem compromissos fixos roda por até 12 h seguidas; no principal vai só até o próximo compromisso fixo
  const doze = a.minutos + 12 * 60;
  const limite = efetivo.robo === "fixo" ? efetivo.ate : !e.w.fixos ? doze : Math.min(efetivo.ate, proximoFixo(e.w, a.minutos, util, a.data, jaFeitos));
  iniciar(e, efetivo, limite);
}

async function ciclo() {
  const a = agoraSP();
  // batimento para o vigia (vigia-corp.ps1): prova de que o orquestrador está vivo e o que cada login está fazendo
  try { fs.writeFileSync(path.join(HOME, "orquestrador-vivo.json"), JSON.stringify({ pid: process.pid, em: Date.now(), logins: [...est.values()].map((e) => ({ id: e.w.id, fazendo: e.filho ? e.nome : "", desde: e.desde, pausaAte: e.pausaAte })) })); } catch { /* disco */ }
  // pós-processamento a cada 6 h (não usa o login do Corp, roda em paralelo; pos-corp.ts tem trava própria e confere a memória)
  const slot = grade.posProcessamento.horas.filter((h) => min(h) <= a.minutos).pop();
  if (slot && posFeito !== a.data + slot) { posFeito = a.data + slot; log("pós-processamento das " + slot + " (anexos e PDFs, sem login do Corp)"); spawn("cmd.exe", ["/c", cam(grade.posProcessamento.cmd)], { cwd: RAIZ, stdio: "ignore", windowsHide: true }); }
  await Promise.all([...est.values()].map((e) => cicloDoLogin(e).catch((err) => log(`[${e.w.id}] erro no ciclo: ${(err as Error).message}`))));
}

(async () => {
  log(`orquestrador iniciado (grade ${GRADE_ARQ}); logins: ${grade.workers.map((w) => w.id).join(", ")}; robô de baixa: ${grade.baixaComando && fs.existsSync(LIGA_BAIXA) ? "LIGADO" : "desligado (a vez da baixa vai para os documentos)"}`);
  for (;;) { try { await ciclo(); } catch (e) { log("erro no ciclo: " + (e as Error).message); } await new Promise((r) => setTimeout(r, 20_000)); }
})();
