// Peças comuns dos robôs do Corp: config, login e busca de modelos de imagem na tela.
// O Corp é um programa transmitido como imagem (canvas): não há DOM, só teclado,
// mouse e comparação de imagens (modelos/*.png). Mesma lógica de exportar.ts
// (que continua com a sua cópia, para não mexer no robô agendado das 12h/20h).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { BrowserContext, Page } from "playwright";

export type ConfigCorp = {
  url: string;
  corretora: { usuario: string; senha: string };
  unidade: { usuario: string; senha: string };
  /** vários logins de robô (cada um = um robô independente). senha única compartilhada (opcional: cai em unidade.senha). Quem preenche é o Matheus; nenhum script lê a senha em voz alta nem a registra. */
  logins?: { senha?: string; lista: { id: string; usuario: string; senha?: string }[] };
};
/** id do login deste processo: CORP_LOGIN (o orquestrador define); sem ele é o login principal ("unidade") */
export const LOGIN_ID = process.env.CORP_LOGIN || "principal";

export const RAIZ = path.resolve(process.cwd(), "scripts", "robo-corp");
export const MODELOS = path.join(RAIZ, "modelos");
const CONFIG = path.join(os.homedir(), ".robo-corp", "config.json");
export const VIEWPORT = { width: 1366, height: 768 };

export const agora = () => new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "_").replace(/:/g, "-");
export const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);
export const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function lerConfig(): ConfigCorp {
  if (!fs.existsSync(CONFIG)) throw new Error(`config não encontrado: ${CONFIG}`);
  const c = JSON.parse(fs.readFileSync(CONFIG, "utf8")) as ConfigCorp;
  if (LOGIN_ID !== "principal") {
    const l = c.logins?.lista.find((x) => x.id === LOGIN_ID);
    if (!l) throw new Error(`login "${LOGIN_ID}" não configurado em config.json (logins.lista): o Matheus precisa acrescentar`);
    c.unidade = { usuario: l.usuario, senha: l.senha ?? c.logins?.senha ?? c.unidade?.senha }; // senha do próprio login > senha compartilhada > senha do principal
  }
  for (const [k, v] of [["corretora", c.corretora], ["unidade", c.unidade]] as const)
    if (!v?.usuario || !v?.senha || v.senha === "PREENCHER") throw new Error(`config: preencha ${k}.usuario/senha`);
  return c;
}

// ------------------------------------------------------------ fotos e modelos
let pastaFotos = "";
let nFoto = 0;
export function definirPastaFotos(p: string) {
  pastaFotos = p;
  fs.mkdirSync(p, { recursive: true });
}
export async function foto(page: Page, nome: string): Promise<string> {
  const arq = path.join(pastaFotos, `${String(++nFoto).padStart(3, "0")}-${nome}.png`);
  await page.screenshot({ path: arq });
  return arq;
}

type Ponto = { x: number; y: number };
/** Todas as posições onde o modelo aparece na tela (centros), da mais parecida para a menos.
 * Tons de cinza, tolerância média de `tolerancia`/255; posições a menos de meia largura/altura
 * de uma já achada contam como a mesma. `area` limita a busca a um retângulo. */
export async function acharTodos(page: Page, modelo: string, tolerancia = 12, area?: { x0: number; y0: number; x1: number; y1: number }): Promise<Ponto[]> {
  const arqModelo = path.join(MODELOS, `${modelo}.png`);
  if (!fs.existsSync(arqModelo)) throw new Error(`modelo não existe: ${arqModelo}`);
  const tela = await sharp(await page.screenshot()).greyscale().raw().toBuffer({ resolveWithObject: true });
  const mod = await sharp(arqModelo).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = tela.info;
  const { width: w, height: h } = mod.info;
  const a = area ?? { x0: 0, y0: 0, x1: W, y1: H };
  const achados: { x: number; y: number; dif: number }[] = [];
  for (let y = Math.max(0, a.y0); y <= Math.min(H, a.y1) - h; y++) {
    for (let x = Math.max(0, a.x0); x <= Math.min(W, a.x1) - w; x++) {
      let soma = 0, n = 0;
      for (let j = 0; j < h; j += 2) {
        const lt = (y + j) * W + x, lm = j * w;
        for (let i = 0; i < w; i += 2) {
          soma += Math.abs(tela.data[lt + i] - mod.data[lm + i]);
          n++;
          if (soma / n > tolerancia * 3 && n > 16) break;
        }
        if (soma / n > tolerancia * 3 && n > 16) break;
      }
      const dif = soma / n;
      if (dif <= tolerancia) achados.push({ x, y, dif });
    }
  }
  achados.sort((p, q) => p.dif - q.dif);
  const unicos: { x: number; y: number }[] = [];
  for (const p of achados) if (!unicos.some((u) => Math.abs(u.x - p.x) < w / 2 && Math.abs(u.y - p.y) < h / 2)) unicos.push(p);
  return unicos.map((p) => ({ x: p.x + w / 2, y: p.y + h / 2 }));
}

export async function acharNaTela(page: Page, modelo: string, tolerancia = 12): Promise<Ponto | null> {
  return (await acharTodos(page, modelo, tolerancia))[0] ?? null;
}

export async function esperarModelo(page: Page, modelo: string, timeoutMs: number): Promise<Ponto> {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    const p = await acharNaTela(page, modelo);
    if (p) return p;
    await espera(1500);
  }
  await foto(page, `erro-esperando-${modelo}`);
  throw new Error(`"${modelo}" não apareceu em ${Math.round(timeoutMs / 1000)} s`);
}

// ------------------------------------------------------------ vez no login (um robô por vez)
// O Corp terá um único login para os robôs (Matheus 25/10/2026): dois robôs logados ao mesmo tempo derrubam um ao
// outro. Antes de entrar, cada robô pega a "vez" (arquivo de trava com o número do processo); se outro robô vivo
// estiver com ela, espera até `maxEsperaMin` e desiste com mensagem clara. A vez é devolvida quando o processo termina
// (normal, erro ou Ctrl+C). Trava de processo morto ou com mais de 12 h é considerada abandonada.
const TRAVA = path.join(os.homedir(), ".robo-corp", LOGIN_ID === "principal" ? "login-em-uso.json" : `login-em-uso-${LOGIN_ID}.json`); // uma trava por login: nunca dois robôs no mesmo login
type Trava = { pid: number; robo: string; desde: string };
const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};
function lerTrava(): Trava | null {
  try {
    const t = JSON.parse(fs.readFileSync(TRAVA, "utf8")) as Trava;
    const velha = Date.now() - new Date(t.desde).getTime() > 12 * 3600_000;
    return t.pid !== process.pid && vivo(t.pid) && !velha ? t : null;
  } catch {
    return null;
  }
}
let temVez = false;
export async function pegarVezDoCorp(robo: string, maxEsperaMin = 60): Promise<void> {
  if (temVez) return;
  const espera_max = Number(process.env.CORP_VEZ_ESPERA_MIN ?? maxEsperaMin); // o orquestrador usa poucos minutos e tenta de novo depois
  const limite = Date.now() + espera_max * 60_000;
  let avisou = false;
  for (;;) {
    const outro = lerTrava();
    if (!outro) break;
    if (Date.now() > limite) throw new Error(`login do Corp ocupado pelo robô "${outro.robo}" desde ${outro.desde} (esperei ${espera_max} min)`);
    if (!avisou) log(`login do Corp em uso pelo robô "${outro.robo}" (desde ${outro.desde}); esperando a vez…`);
    avisou = true;
    await espera(30_000);
  }
  fs.mkdirSync(path.dirname(TRAVA), { recursive: true });
  fs.writeFileSync(TRAVA, JSON.stringify({ pid: process.pid, robo, desde: new Date().toISOString() } satisfies Trava));
  temVez = true;
  const devolver = () => {
    try {
      const t = JSON.parse(fs.readFileSync(TRAVA, "utf8")) as Trava;
      if (t.pid === process.pid) fs.unlinkSync(TRAVA);
    } catch {}
  };
  process.on("exit", devolver);
  for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(s, () => process.exit(130));
}

// ------------------------------------------------------------ login
/** Vários robôs, cada um na sua janela: o Corp só aceita teclado na janela "em foco". Com a emulação de foco (CDP) cada página se acha em foco e recebe as teclas do seu robô, mesmo coberta por outra janela. */
async function emularFoco(ctx: BrowserContext, p: Page) {
  try { const s = await ctx.newCDPSession(p); await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }); } catch { /* navegador sem CDP: segue sem */ }
}
// Vários robôs: a TELA DE LOGIN do Corp só aceita teclado de um robô por vez (os outros ficam com os campos vazios). Por isso a fase de login é sequencial:
// um arquivo de trava (fase-login.lock) é segurado só durante o login (cerca de 1 min); depois cada robô trabalha em paralelo na sua própria janela.
const FASE = path.join(os.homedir(), ".robo-corp", "fase-login.lock");
export async function pegarFaseLogin(): Promise<() => void> {
  fs.mkdirSync(path.dirname(FASE), { recursive: true });
  const limite = Date.now() + 15 * 60_000; let avisou = false;
  for (;;) {
    try { fs.mkdirSync(FASE); fs.writeFileSync(path.join(FASE, "dono.json"), JSON.stringify({ pid: process.pid, login: LOGIN_ID, desde: Date.now() })); break; } catch { /* ocupada */ }
    try {
      const d = JSON.parse(fs.readFileSync(path.join(FASE, "dono.json"), "utf8")) as { pid: number; desde: number };
      if (!vivo(d.pid) || Date.now() - d.desde > 180_000) { log(`trava de login velha liberada (dono: ${(d as { login?: string }).login ?? "?"}, pid ${d.pid}, ${vivo(d.pid) ? "vivo há " + Math.round((Date.now() - d.desde) / 1000) + " s" : "morto"})`); fs.rmSync(FASE, { recursive: true, force: true }); continue; }
    } catch { try { if (Date.now() - fs.statSync(FASE).mtimeMs > 30_000) fs.rmSync(FASE, { recursive: true, force: true }); } catch { /* sumiu */ } }
    if (Date.now() > limite) throw new Error("fila de login do Corp: esperei 15 min pela vez de digitar");
    if (!avisou) { log("esperando a vez de digitar o login (outro robô está entrando)…"); avisou = true; }
    await espera(2000 + Math.floor(Math.random() * 1500));
  }
  return () => { try { fs.rmSync(FASE, { recursive: true, force: true }); } catch { /* ok */ } };
}
export async function entrar(ctx: BrowserContext, cfg: ConfigCorp, robo = path.basename(process.argv[1] ?? "robo")): Promise<Page> {
  await pegarVezDoCorp(robo);
  // até 3 tentativas; cada uma com limite de 150 s e trava de digitação própria. Falhou: fecha só as páginas DESTE login e recomeça (não mexe nos outros robôs)
  for (let tent = 1; ; tent++) {
    const soltar = await pegarFaseLogin();
    log(`login [${LOGIN_ID}] tentativa ${tent}: tenho a vez de digitar`);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([entrarSemFila(ctx, cfg), new Promise<Page>((_, rej) => { timer = setTimeout(() => rej(new Error("login passou de 150 s")), 150_000); })]);
    } catch (e) {
      log(`login [${LOGIN_ID}] tentativa ${tent} falhou: ${(e as Error).message}`);
      if (/não aceitou o login|Acesso Negado/i.test((e as Error).message) || tent >= 3) throw e;
      for (const p of ctx.pages()) await p.close().catch(() => {});
    } finally { if (timer) clearTimeout(timer); soltar(); }
  }
}
async function entrarSemFila(ctx: BrowserContext, cfg: ConfigCorp): Promise<Page> {
  log(`login [${LOGIN_ID}]: 1/5 abrindo a tela de login`);
  const login = await ctx.newPage();
  await login.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  log(`login [${LOGIN_ID}]: 2/5 digitando usuário e senha da corretora`);
  await login.fill('input[placeholder="Usuário"]', cfg.corretora.usuario);
  await login.fill('input[placeholder="Senha"]', cfg.corretora.senha);
  await login
    .getByRole("button", { name: /entrar/i })
    .click({ timeout: 10_000 })
    .catch(() => login.press('input[placeholder="Senha"]', "Enter"));
  await login.getByText("Clique para acessar").waitFor({ timeout: 30_000 });
  log(`login [${LOGIN_ID}]: 3/5 abrindo o aplicativo do Corp`);
  const [app] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 60_000 }).catch(() => null),
    login.getByText("O2", { exact: true }).first().click(),
  ]);
  const page = app ?? login;
  await page.waitForLoadState("domcontentloaded");
  await page.bringToFront();
  log(`login [${LOGIN_ID}]: 4/5 digitando o login da unidade`);
  const rotulo = await esperarModelo(page, "login-usuario-rotulo", 90_000);
  await page.mouse.click(rotulo.x + 110, rotulo.y);
  await espera(1200);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(cfg.unidade.usuario, { delay: 110 });
  await espera(1000);
  await page.keyboard.press("Tab");
  await espera(1200);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(cfg.unidade.senha, { delay: 110 });
  await espera(1000);
  await page.keyboard.press("Enter");
  const fim = Date.now() + 90_000;
  while (Date.now() < fim && (await acharNaTela(page, "login-usuario-rotulo"))) await espera(2000);
  if (await acharNaTela(page, "login-usuario-rotulo")) {
    await foto(page, "erro-login-unidade");
    throw new Error("o Corp não aceitou o login da unidade (confira config.json)");
  }
  log(`login [${LOGIN_ID}]: 5/5 dentro do Corp`);
  await espera(8000);
  return page;
}
