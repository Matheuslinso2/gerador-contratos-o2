// Robô de baixa — Porto Seguro (Corretor Online). Baixa a "planilha XLS" de cada pagamento de comissão do mês atual e do
// anterior, por SUSEP favorecida (LI7PMJ = O2 Corretora; G0852J = O2 Capitalização), e grava no ERP (origem 'portal').
// NÃO escreve nada no Corp nem no portal: só pesquisa e baixa.
//
// Caminho mapeado em 25/10/2026 (sessão logada do Matheus, só leitura):
//   topo: botão do usuário → lista de SUSEPs (CFU15J, G0852J, LI7PMJ, M48IGJ). Favorecida LI7PMJ aparece com a SUSEP CFU15J;
//   G0852J com a própria G0852J.
//   Comissões → quadro wwws.portoseguro.com.br/demonstrativocomissaocorretor/iniext.do: Empresa (99 = TODAS), Favorecida,
//   Tipo PG (Pagamentos), critério 3 = Mês (mesOrigem MM/AAAA) → Pesquisar → uma linha por ordem de pagamento com ícones
//   PDF e XLS (a "XLS" é tabela HTML, lida por parsePortoHtml). Linha "Processando" = pagamento ainda não liberado (pula).
//   O débito do empréstimo aparece na coluna Déb/Créd do pagamento grande do mês (set e out/26: −25.949,64).
//
// Login: a Porto usa rastreamento de dispositivo e um passo "ACESSAR O CORRETOR ONLINE" antes do SSO → o robô NÃO digita
// senha; usa a sessão guardada no perfil próprio (%USERPROFILE%\.robo-seguradoras\perfil-porto). Sessão expirada = espera
// alguém entrar à mão na janela do robô (até 10 min) e registra no log.
//
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-seguradoras/porto.ts [--meses 10/2026,09/2026] [--sem-gravar] [--manter]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Frame, type Page } from "playwright";
import { createServiceClient } from "@/lib/supabase/service";
import { parsePortoHtml } from "@/lib/erp/extratosPdf";
import { gravarExtratosPortal } from "@/lib/erp/extratosPortal";

const HOME = "https://corretor.portoseguro.com.br/novocol/homepage";
const DIR = path.join(os.homedir(), ".robo-seguradoras");
// favorecida → SUSEP que precisa estar escolhida no topo para a favorecida aparecer
const FAVORECIDAS: Record<string, string> = { LI7PMJ: "CFU15J", G0852J: "G0852J" };

const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const GRAVAR = !args.includes("--sem-gravar");
const MANTER = args.includes("--manter");
const mesStr = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const MESES = arg("--meses")?.split(",") ?? [mesStr(agora), mesStr(new Date(agora.getFullYear(), agora.getMonth() - 1, 1))];
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  [porto] ${m}`);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A home do Corretor Online abre 1–3 anúncios em sequência (.modal-wrapper) que bloqueiam os cliques (25/10: travou o robô).
async function fecharAnuncios(page: Page) {
  for (let i = 0; i < 6; i++) {
    const modal = page.locator(".modal-wrapper").first();
    if (!(await modal.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => {});
    await espera(500);
    if (!(await modal.isVisible().catch(() => false))) continue;
    const fechar = modal.locator('button[aria-label*="echar" i], button[class*="close" i], button:has(svg)').first();
    if (await fechar.isVisible().catch(() => false)) await fechar.click({ timeout: 5000 }).catch(() => {});
    await espera(1000);
  }
  // último recurso: tira o anúncio da frente (só a camada do anúncio; nada do portal é alterado)
  await page.evaluate(() => document.querySelectorAll(".modal-wrapper").forEach((m) => m.remove())).catch(() => {});
}

async function garantirLogin(page: Page) {
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await espera(6000);
  const logado = async () => page.url().includes("/novocol/") && (await page.getByRole("link", { name: "Comissões" }).count()) > 0;
  if (await logado()) return;
  log("sessão expirada — aguardando alguém entrar à mão na janela do robô (até 10 min)…");
  for (let i = 0; i < 120 && !(await logado()); i++) await espera(5000);
  if (!(await logado())) throw new Error("não entrou no portal em 10 min");
}

async function escolherSusep(page: Page, susep: string) {
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await espera(5000);
  await fecharAnuncios(page);
  const atual = page.locator("button", { hasText: /CFU15J|G0852J|LI7PMJ|M48IGJ/ }).first();
  if ((await atual.textContent())?.includes(susep)) return;
  await fecharAnuncios(page);
  await atual.click();
  await espera(1500);
  await page.locator("button", { hasText: /CFU15J|G0852J|LI7PMJ|M48IGJ/ }).nth(1).click();
  await espera(1500);
  await page.getByRole("menuitemradio", { name: susep }).click();
  await espera(6000);
}

// Comissões abre um quadro (iframe) de wwws.portoseguro.com.br; o robô abre o endereço do quadro direto na aba
// (mesma sessão) — foi assim que funcionou no mapeamento de 25/10; dentro do quadro a página não carregava a tempo.
async function quadroComissoes(page: Page): Promise<Frame> {
  await fecharAnuncios(page);
  const href = await page.getByRole("link", { name: "Comissões" }).first().getAttribute("href");
  if (!href) throw new Error("link Comissões não encontrado");
  await page.goto(new URL(href, HOME).toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
  let src: string | null = null;
  for (let i = 0; i < 40 && !src; i++) {
    await espera(1000);
    src = await page.locator('iframe[src*="integracaocomissoes"], iframe[src*="demonstrativocomissao"]').first().getAttribute("src").catch(() => null);
  }
  if (!src) throw new Error("quadro de comissões não apareceu");
  await page.goto(src, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator('select[name="susepCorretor"]').waitFor({ timeout: 60_000 });
  return page.mainFrame();
}

async function baixarMes(page: Page, favorecida: string, mes: string, pasta: string, jaTem: Set<string>): Promise<string[]> {
  const fr = await quadroComissoes(page);
  await fr.selectOption('select[name="codigoEmpresa"]', "99");
  await fr.selectOption('select[name="susepCorretor"]', favorecida);
  await fr.selectOption('select[name="tipoPesquisa"]', "PG");
  await fr.check('input[name="criterioPesquisa"][value="3"]');
  const opcoes = await fr.locator('select[name="mesOrigem"] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  if (!opcoes.includes(mes)) { log(`${favorecida} ${mes}: mês não disponível no portal`); return []; }
  await fr.selectOption('select[name="mesOrigem"]', mes);
  await fr.getByRole("button", { name: "Pesquisar" }).click();
  await espera(6000);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const res = page.mainFrame();
  const linhas = res.locator("tr", { has: res.locator('img[src*="xls"]') });
  const n = await linhas.count();
  const salvos: string[] = [];
  for (let i = 0; i < n; i++) {
    const tr = linhas.nth(i);
    const texto = ((await tr.textContent()) ?? "").replace(/\s+/g, " ");
    const ordem = /\b(5\d{7})\b/.exec(texto)?.[1] ?? `linha${i}`;
    if (/Processando/i.test(texto)) { log(`${favorecida} ${mes}: ordem ${ordem} ainda processando — fica para a próxima noite`); continue; }
    if (jaTem.has(ordem)) continue;
    const [download] = await Promise.all([res.page().waitForEvent("download", { timeout: 120_000 }), tr.locator('img[src*="xls"]').first().click()]);
    const destino = path.join(pasta, `PORTO_${favorecida}_${ordem}.xls`);
    await download.saveAs(destino);
    salvos.push(destino);
    await espera(2500);
  }
  log(`${favorecida} ${mes}: ${n} pagamento(s) na tela, ${salvos.length} baixado(s)`);
  return salvos;
}

async function main() {
  const cfgArq = path.join(DIR, "config.json");
  const cfg = fs.existsSync(cfgArq) ? JSON.parse(fs.readFileSync(cfgArq, "utf8")) : {};
  const pasta = path.join(cfg.pastaSaida || path.join(DIR, "extratos"), "PORTO");
  fs.mkdirSync(pasta, { recursive: true });
  const sb = createServiceClient();
  // ordens de pagamento que o ERP já tem (não baixa de novo)
  const { data: seg } = await sb.from("erp_seguradoras").select("id").eq("abreviacao", "PORT").single();
  const { data: ja } = await sb.from("erp_extratos_seguradora").select("numero_extrato").eq("seguradora_id", seg?.id).not("numero_extrato", "is", null).limit(5000);
  const jaTem = new Set((ja ?? []).map((x: { numero_extrato: string }) => x.numero_extrato));
  log(`meses ${MESES.join(", ")} · favorecidas ${Object.keys(FAVORECIDAS).join(", ")} · ${jaTem.size} ordens já no ERP`);

  const ctx = await chromium.launchPersistentContext(path.join(DIR, "perfil-porto"), { channel: "chrome", headless: false, acceptDownloads: true, viewport: { width: 1366, height: 768 } });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const arquivos: string[] = [];
  const falhas: string[] = [];
  try {
    await garantirLogin(page);
    for (const [fav, susepTopo] of Object.entries(FAVORECIDAS)) {
      for (const mes of MESES) {
        for (let t = 1; t <= 3; t++) {
          try {
            await escolherSusep(page, susepTopo);
            arquivos.push(...(await baixarMes(page, fav, mes, pasta, jaTem)));
            break;
          } catch (e) {
            log(`${fav} ${mes}, tentativa ${t}: ${(e as Error).message}`);
            if (t === 3) falhas.push(`${fav} ${mes}: ${(e as Error).message}`);
            else await espera(10_000);
          }
        }
      }
    }
  } finally {
    if (!MANTER) await ctx.close();
  }

  for (const f of arquivos) {
    const ex = parsePortoHtml(new TextDecoder("latin1").decode(fs.readFileSync(f)));
    if (!ex) { log(`${path.basename(f)}: não reconhecido`); continue; }
    const r = await gravarExtratosPortal(sb, "PORT", [ex], { arquivo: path.basename(f), gravar: GRAVAR });
    log(`${path.basename(f)}: ${r.novos ? `novo (${r.linhas} linhas, R$ ${r.bruto.toFixed(2)})` : "já existia"}${r.erros.length ? ` · ERROS: ${r.erros.join("; ")}` : ""}`);
  }
  if (GRAVAR && arquivos.length) {
    const { data, error } = await sb.rpc("erp_cruzar_extratos");
    log(`cruzamento: ${error ? error.message : JSON.stringify(data)}`);
  }
  if (falhas.length) { log(`FALHAS: ${falhas.join(" | ")}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
