// 28/10/2026 — Exporta Documentos → Renovações do Corp (fim de vigência 01/01/2027 a 31/01/2027, ramo TODOS)
// nos modelos Simplificado c/ Produtor e Simplificado. Só leitura no Corp. Espera a vez do login (outro robô pode estar usando).
// uso: SP=<pasta> npx tsx scripts/renovacoes-re/_explorar/extrair-jan2027.ts [modelo...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { chromium, type Page } from "playwright";
import { pegarVezDoCorp } from "../../robo-corp/_corp";

const SP = process.env.SP!;
const FOTOS = path.join(SP, "fotos2");
const DOWN = path.join(SP, "downloads");
const MODELOS = path.resolve("scripts/robo-corp/modelos");
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);
let n = 0;
let page: Page;
const foto = async (nome: string) => page.screenshot({ path: path.join(FOTOS, `${String(++n).padStart(2, "0")}-${nome}.png`) });

// Posições do rádio de cada Modelo na tela do relatório (viewport 1366×768).
const POS: Record<string, [number, number]> = {
  simplificado: [290, 212],
  "simplificado-produtor": [290, 237],
  "apresentando-itens": [290, 262],
  "itens-garantias": [600, 212],
  "proposta-renovacao": [600, 237],
  "extrato-completo": [600, 262],
};

async function acharNaTela(modelo: string, tolerancia = 12) {
  const tela = await sharp(await page.screenshot()).greyscale().raw().toBuffer({ resolveWithObject: true });
  const mod = await sharp(path.join(MODELOS, `${modelo}.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = tela.info;
  const { width: w, height: h } = mod.info;
  let melhor: { x: number; y: number; dif: number } | null = null;
  for (let y = 0; y <= H - h; y++)
    for (let x = 0; x <= W - w; x++) {
      let soma = 0, k = 0;
      for (let j = 0; j < h; j += 2) {
        const lt = (y + j) * W + x, lm = j * w;
        for (let i = 0; i < w; i += 2) {
          soma += Math.abs(tela.data[lt + i] - mod.data[lm + i]);
          k++;
          if (soma / k > tolerancia * 3 && k > 16) break;
        }
        if (soma / k > tolerancia * 3 && k > 16) break;
      }
      const dif = soma / k;
      if (dif <= tolerancia && (!melhor || dif < melhor.dif)) melhor = { x, y, dif };
    }
  return melhor ? { x: melhor.x + w / 2, y: melhor.y + h / 2 } : null;
}

async function digitarDevagar(texto: string) {
  for (const ch of texto) {
    await page.keyboard.type(ch);
    await espera(300);
  }
}

async function main() {
  const lista = process.argv.slice(2).length ? process.argv.slice(2) : ["simplificado-produtor", "simplificado"];
  await pegarVezDoCorp("renovacoes-jan2027", 240);
  fs.mkdirSync(FOTOS, { recursive: true });
  fs.mkdirSync(DOWN, { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".robo-corp", "config.json"), "utf8"));
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true, locale: "pt-BR" });
  // O PDF do Corp pode abrir numa aba em vez de baixar: guarda toda resposta PDF.
  ctx.on("page", (p) => log(`aba nova: ${p.url()}`));
  ctx.on("response", async (r) => {
    const tipo = r.headers()["content-type"] ?? "";
    if (!/pdf|spreadsheet|excel|octet-stream/i.test(tipo)) return;
    const corpo = await r.body().catch(() => null);
    if (!corpo) return;
    const arq = path.join(DOWN, `resposta-${Date.now()}.${/pdf/i.test(tipo) ? "pdf" : "bin"}`);
    fs.writeFileSync(arq, corpo);
    log(`resposta ${tipo} ${Math.round(corpo.length / 1024)} KB → ${arq} (${r.url().slice(0, 120)})`);
  });
  try {
    const login = await ctx.newPage();
    await login.goto(cfg.url, { waitUntil: "domcontentloaded" });
    await login.fill('input[placeholder="Usuário"]', cfg.corretora.usuario);
    await login.fill('input[placeholder="Senha"]', cfg.corretora.senha);
    await login.getByRole("button", { name: /entrar/i }).click({ timeout: 10_000 }).catch(() => login.press('input[placeholder="Senha"]', "Enter"));
    await login.getByText("Clique para acessar").waitFor({ timeout: 30_000 });
    const [app] = await Promise.all([ctx.waitForEvent("page", { timeout: 60_000 }).catch(() => null), login.getByText("O2", { exact: true }).first().click()]);
    page = app ?? login;
    await page.waitForLoadState("domcontentloaded");
    await page.bringToFront();
    let rot = null;
    for (const fim = Date.now() + 120_000; Date.now() < fim && !(rot = await acharNaTela("login-usuario-rotulo")); ) await espera(2000);
    if (!rot) throw new Error("janela de login do Corp não apareceu");
    await foto("login");
    await page.mouse.click(rot.x + 110, rot.y);
    await espera(1200);
    await page.keyboard.press("Control+a");
    await page.keyboard.type(cfg.unidade.usuario, { delay: 110 });
    await espera(1000);
    await page.keyboard.press("Tab");
    await espera(1200);
    await page.keyboard.press("Control+a");
    await page.keyboard.type(cfg.unidade.senha, { delay: 110 });
    await espera(1000);
    await foto("login-preenchido");
    await page.keyboard.press("Enter");
    for (const fim = Date.now() + 90_000; Date.now() < fim && (await acharNaTela("login-usuario-rotulo")); ) await espera(2000);
    if (await acharNaTela("login-usuario-rotulo")) throw new Error("login da unidade não passou");
    await espera(8000);
    await foto("menu");

    await page.keyboard.press("Alt+c");
    await espera(800);
    await page.keyboard.press("g");
    await espera(3500);
    await page.mouse.click(12, 62); // + Documentos
    await espera(1200);
    await page.mouse.click(76, 158); // Renovações
    await espera(4000);
    await foto("renovacoes");

    // Período por Fim de Vigência: 01/12/2026 a 31/12/2026, um número por vez.
    for (const [x, data] of [[330, "01012027"], [440, "31012027"]] as const) {
      await page.mouse.click(x, 333);
      await espera(1000);
      await page.keyboard.press("End");
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Backspace");
        await espera(120);
      }
      await page.keyboard.press("Home");
      await espera(500);
      await digitarDevagar(data);
      await espera(800);
    }
    await page.mouse.click(1100, 600); // tira o foco
    await espera(1000);
    await foto("periodo");

    for (const m of lista) {
      const [x, y] = POS[m];
      await page.mouse.click(x, y);
      await espera(2000);
      await foto(`filtros-${m}`);
      log(`${m}: exportando…`);
      const download = await Promise.all([page.waitForEvent("download", { timeout: 15 * 60_000 }), page.mouse.click(process.env.BOTAO === "pdf" ? 1078 : 1020, 745)])
        .then(([d]) => d)
        .catch(async (e) => {
          await foto(`erro-${m}`);
          log(`${m}: sem download (${String(e.message).split("\n")[0]})`);
          return null;
        });
      if (download) {
        const destino = path.join(DOWN, `${m}__${download.suggestedFilename()}`);
        await download.saveAs(destino);
        log(`${m}: ${download.suggestedFilename()} → ${Math.round(fs.statSync(destino).size / 1024)} KB`);
      }
      await espera(3000);
      await foto(`depois-${m}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
