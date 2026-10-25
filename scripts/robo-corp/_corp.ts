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
};

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
const TRAVA = path.join(os.homedir(), ".robo-corp", "login-em-uso.json");
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
  const limite = Date.now() + maxEsperaMin * 60_000;
  let avisou = false;
  for (;;) {
    const outro = lerTrava();
    if (!outro) break;
    if (Date.now() > limite) throw new Error(`login do Corp ocupado pelo robô "${outro.robo}" desde ${outro.desde} (esperei ${maxEsperaMin} min)`);
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
export async function entrar(ctx: BrowserContext, cfg: ConfigCorp, robo = path.basename(process.argv[1] ?? "robo")): Promise<Page> {
  await pegarVezDoCorp(robo);
  const login = await ctx.newPage();
  await login.goto(cfg.url, { waitUntil: "domcontentloaded" });
  await login.fill('input[placeholder="Usuário"]', cfg.corretora.usuario);
  await login.fill('input[placeholder="Senha"]', cfg.corretora.senha);
  await login
    .getByRole("button", { name: /entrar/i })
    .click({ timeout: 10_000 })
    .catch(() => login.press('input[placeholder="Senha"]', "Enter"));
  await login.getByText("Clique para acessar").waitFor({ timeout: 30_000 });
  const [app] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 60_000 }).catch(() => null),
    login.getByText("O2", { exact: true }).first().click(),
  ]);
  const page = app ?? login;
  await page.waitForLoadState("domcontentloaded");
  await page.bringToFront();
  const rotulo = await esperarModelo(page, "login-usuario-rotulo", 120_000);
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
  await espera(8000);
  return page;
}
