// Robô de baixa — Tokio Marine (Portal Parceiros). Baixa o "Extrato do Corretor" (PDF com todos os extratos do período)
// de cada código da O2 e grava no ERP (erp_extratos_seguradora origem 'portal' → erp_cruzar_extratos → /erp/baixas).
// NÃO escreve nada no Corp nem no portal: só pesquisa e exporta o PDF.
//
// Caminho mapeado em 25/10/2026 (sessão logada do Matheus, só leitura):
//   Financeiro → Extrato Comissão = /gestaoapolice/emissao/view/BackOfficeViewCorretor/extrato-comissao
//   código do corretor = seletor "Código/Corretor" no topo da home (55002 e 195354 = O2 Corretora; 70145 = O2 Cap)
//   Período inicial / final → Pesquisar (o portal leva 10–40 s) → botão "Exportar em PDF" (gera o PDF no navegador).
//
// Login: perfil próprio do navegador do robô em %USERPROFILE%\.robo-seguradoras\perfil-tokio (a sessão fica guardada).
// Se a sessão expirou: usa usuário/senha de %USERPROFILE%\.robo-seguradoras\config.json (preenchido pela equipe; NUNCA
// no código/chat/GitHub); sem senha no arquivo, espera alguém entrar à mão na janela do robô (até 10 min).
// Horário (Matheus 25/10): só depois das 20h — tarefa "Robo Seguradoras" do Agendador do Windows às 20:30.
//
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-seguradoras/tokio.ts [--de AAAA-MM-DD] [--ate AAAA-MM-DD] [--sem-gravar] [--manter]
//   padrão: últimos 15 dias até hoje; grava no ERP (sem --sem-gravar).
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { extractText, getDocumentProxy } from "unpdf";
import { createServiceClient } from "@/lib/supabase/service";
import { parseTokioPdfVarios } from "@/lib/erp/extratosPdf";
import { gravarExtratosPortal } from "@/lib/erp/extratosPortal";

type Portal = { url: string; usuario: string; senha: string; dono_do_login?: string; codigos?: string[] };
type Config = { pastaSaida: string; portais: Record<string, Portal> };

const BASE = "https://portalparceiros.tokiomarine.com.br";
const HOME = `${BASE}/group/portal-corretor`;
const EXTRATO = `${BASE}/gestaoapolice/emissao/view/BackOfficeViewCorretor/extrato-comissao`;
const CODIGOS_PADRAO = ["55002", "195354", "70145"];
const DIR = path.join(os.homedir(), ".robo-seguradoras");

const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const GRAVAR = !args.includes("--sem-gravar");
const MANTER = args.includes("--manter");
const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const ATE = arg("--ate") ?? hoje;
const DE = arg("--de") ?? new Date(Date.parse(ATE) - 15 * 864e5).toISOString().slice(0, 10);
const br = (d: string) => d.split("-").reverse().join("/");
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  [tokio] ${m}`);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lerConfig(): Config {
  const f = path.join(DIR, "config.json");
  if (!fs.existsSync(f)) throw new Error(`config não encontrado: ${f} (copie scripts/robo-seguradoras/config.exemplo.json)`);
  return JSON.parse(fs.readFileSync(f, "utf8")) as Config;
}

async function garantirLogin(page: Page, cfg: Portal) {
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await espera(4000);
  const logado = async () => page.url().startsWith(BASE) && (await page.getByText("Código/Corretor").count()) > 0;
  if (await logado()) return;
  log(`sessão expirada (${new URL(page.url()).host})`);
  // Login da Tokio = OpenAM em ssoportais3.tokiomarine.com.br: #idToken1 usuário, #idToken2 senha, #loginButton_0 (sem captcha em 25/10).
  const senha = page.locator('#idToken2, input[type="password"]').first();
  if (cfg.usuario && cfg.senha && (await senha.count())) {
    log("entrando com o login do arquivo de configuração");
    const usuario = page.locator('#idToken1, input[type="text"]').first();
    await usuario.fill(cfg.usuario);
    await senha.fill(cfg.senha);
    const botao = page.locator("#loginButton_0");
    if (await botao.count()) await botao.click();
    else await senha.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 90_000 }).catch(() => {});
    // o SSO redireciona algumas vezes antes de chegar ao portal: espera até 60 s
    for (let i = 0; i < 20 && !(await logado()); i++) {
      await espera(3000);
      if (page.url().startsWith(BASE) && !page.url().includes("portal-corretor")) await page.goto(HOME, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    if (await page.locator('iframe[src*="recaptcha"], iframe[title*="captcha" i]').count()) throw new Error("o portal pediu verificação 'não sou robô' — entrar à mão na janela do robô (rode com --manter)");
  }
  if (await logado()) return;
  // registra por que o login automático não passou (25/10 não passou e não se sabia o motivo)
  const foto = path.join(process.cwd(), "scripts", "robo-seguradoras", "saida", `tokio-login-${hoje}.png`);
  await page.screenshot({ path: foto, fullPage: true }).catch(() => {});
  const aviso = (await page.locator('.alert, [class*="error" i], [class*="erro" i], [role="alert"]').allInnerTexts().catch(() => [])).join(" | ").slice(0, 300);
  log(`login automático não entrou (${new URL(page.url()).host}${new URL(page.url()).pathname})${aviso ? ` — mensagem: ${aviso}` : ""} · foto: ${foto}`);
  log("aguardando alguém entrar à mão na janela do robô (até 10 min)…");
  for (let i = 0; i < 120 && !(await logado()); i++) {
    await espera(5000);
    if (page.url().startsWith(BASE) && !page.url().includes("portal-corretor")) await page.goto(HOME, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  if (!(await logado())) throw new Error("não entrou no portal em 10 min");
}

async function escolherCodigo(page: Page, codigo: string) {
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await espera(3000);
  await page.getByText("Código/Corretor").first().click();
  const linha = page.locator("tr", { hasText: new RegExp(`^\\s*0*${codigo}\\b`) }).first();
  await linha.waitFor({ timeout: 30_000 });
  await linha.click();
  await espera(4000);
}

async function baixarExtrato(page: Page, codigo: string, pasta: string): Promise<string | null> {
  await page.goto(EXTRATO, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByText("Extrato de Comissão").first().waitFor({ timeout: 60_000 });
  const corretor = await page.locator("#mat-input-0").inputValue().catch(() => "");
  if (!corretor.replace(/^0+/, "").startsWith(codigo)) throw new Error(`código no extrato = "${corretor}", esperado ${codigo}`);
  for (const [rotulo, valor] of [["Periodo inicial", br(DE)], ["Periodo final", br(ATE)]] as const) {
    const campo = page.getByLabel(rotulo);
    await campo.click();
    await campo.fill("");
    await campo.pressSequentially(valor, { delay: 40 });
  }
  await page.getByRole("button", { name: "Pesquisar" }).first().click();
  // o portal demora: espera a tabela trazer extratos ou "Nenhum registro encontrado!" depois do carregamento
  for (let i = 0; i < 36; i++) {
    await espera(5000);
    const carregando = await page.locator(".loading, .spinner, mat-spinner, mat-progress-spinner").first().isVisible().catch(() => false);
    if (carregando) continue;
    if (await page.getByText("Total do Pagamento").count()) break;
    if (i >= 6 && (await page.getByText("Nenhum registro encontrado").count())) { log(`código ${codigo}: nenhum extrato de ${br(DE)} a ${br(ATE)}`); return null; }
  }
  if (!(await page.getByText("Total do Pagamento").count())) throw new Error(`código ${codigo}: a pesquisa não terminou em 3 min`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 180_000 }),
    page.locator('button[mattooltip="Exportar em PDF"], button.btn-inicio').first().click(),
  ]);
  const destino = path.join(pasta, `TOKIO_${codigo}_${DE}_a_${ATE}.pdf`);
  await download.saveAs(destino);
  log(`código ${codigo}: PDF salvo (${Math.round(fs.statSync(destino).size / 1024)} KB)`);
  return destino;
}

async function main() {
  const cfg = lerConfig();
  const portal = cfg.portais?.TOKIO ?? { url: HOME, usuario: "", senha: "" };
  const codigos = portal.codigos?.length ? portal.codigos : CODIGOS_PADRAO;
  const pasta = path.join(cfg.pastaSaida || path.join(DIR, "extratos"), "TOKIO");
  fs.mkdirSync(pasta, { recursive: true });
  log(`período ${br(DE)} a ${br(ATE)} · códigos ${codigos.join(", ")} · ${GRAVAR ? "grava no ERP" : "sem gravar"}`);

  const ctx = await chromium.launchPersistentContext(path.join(DIR, "perfil-tokio"), { channel: "chrome", headless: false, acceptDownloads: true, viewport: { width: 1366, height: 768 } });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const arquivos: string[] = [];
  const falhas: string[] = [];
  try {
    await garantirLogin(page, portal);
    for (const codigo of codigos) {
      // portal instável: até 3 tentativas por código
      for (let t = 1; t <= 3; t++) {
        try {
          await escolherCodigo(page, codigo);
          const f = await baixarExtrato(page, codigo, pasta);
          if (f) arquivos.push(f);
          break;
        } catch (e) {
          log(`código ${codigo}, tentativa ${t}: ${(e as Error).message}`);
          if (t === 3) falhas.push(`${codigo}: ${(e as Error).message}`);
          else await espera(10_000);
        }
      }
    }
  } finally {
    if (!MANTER) await ctx.close();
  }

  const sb = createServiceClient();
  for (const f of arquivos) {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(f)));
    const { text } = await extractText(pdf, { mergePages: true });
    const extratos = parseTokioPdfVarios(text as string);
    const r = await gravarExtratosPortal(sb, "TOKI", extratos, { arquivo: path.basename(f), gravar: GRAVAR });
    log(`${path.basename(f)}: ${extratos.length} extratos · novos ${r.novos} (${r.linhas} linhas, R$ ${r.bruto.toFixed(2)}) · já existiam ${r.ja_existiam}${r.erros.length ? ` · ERROS: ${r.erros.join("; ")}` : ""}`);
  }
  if (GRAVAR && arquivos.length) {
    const { data, error } = await sb.rpc("erp_cruzar_extratos");
    log(`cruzamento: ${error ? error.message : JSON.stringify(data)}`);
  }
  if (falhas.length) { log(`FALHAS: ${falhas.join(" | ")}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
