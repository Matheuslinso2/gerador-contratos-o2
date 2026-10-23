// Robô do Corp (Agger) → Excel → pasta sincronizada do SharePoint. Ver README.md.
// O Corp é um programa transmitido como imagem (canvas) no navegador: o robô usa
// teclado (Alt+letra dos menus, Tab, digitação) e procura modelos de imagem
// (modelos/*.png) para clicar onde o teclado não alcança.
// uso: npx tsx scripts/robo-corp/exportar.ts [--mapear] [--so <id>] [--manter] [--todos] [--listar]
//   --mapear  entra no Corp, abre o Gerenciador de Relatórios e fotografa cada
//             passo em saida/mapa/ (calibração e diagnóstico); não exporta.
//   --so id   exporta só o relatório com esse id do config.json.
//   --manter  deixa o navegador aberto no fim (para olhar).
//   --todos   exporta também as grades dos anos já fechados (ver gradesEmUso).
//   --listar  só mostra quais relatórios seriam exportados hoje; não abre o Corp
//             (com --hoje AAAA-MM-DD simula outra data).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { chromium, type BrowserContext, type Page } from "playwright";

type Relatorio = { id: string; tipo: "grade" | "clientes" | "sinistros"; de?: string; ate?: string; pasta: string };
type Config = {
  url: string;
  corretora: { usuario: string; senha: string };
  unidade: { usuario: string; senha: string };
  pastaSaida: string;
  pastaSharepoint: string | null;
  relatorios: Relatorio[];
};

const args = process.argv.slice(2);
const MAPEAR = args.includes("--mapear");
const MANTER = args.includes("--manter");
// --painel: depois de exportar, fotografa o painel do próprio Corp (Consultas →
// Gráficos de Análise e Metas), para conferir os números no mesmo instante.
const PAINEL = args.includes("--painel");
const SO = args.includes("--so") ? args[args.indexOf("--so") + 1] : null;
const TODOS = args.includes("--todos");
const LISTAR = args.includes("--listar");
// Rodar a partir da pasta do projeto (ver README).
const RAIZ = path.resolve(process.cwd(), "scripts", "robo-corp");
const MODELOS = path.join(RAIZ, "modelos");
const CONFIG = path.join(os.homedir(), ".robo-corp", "config.json");
const VIEWPORT = { width: 1366, height: 768 };

// Caminho na árvore do Gerenciador de Relatórios: grupo → item (texto como aparece).
const ARVORE: Record<Relatorio["tipo"], { grupo: string; item: string }> = {
  grade: { grupo: "Documentos", item: "Propostas Grade por Produtor" },
  clientes: { grupo: "Clientes", item: "com Documentos" },
  sinistros: { grupo: "Sinistros", item: "Geral - Grade" },
};

const agora = () => new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "_").replace(/:/g, "-");
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lerConfig(): Config {
  if (!fs.existsSync(CONFIG)) throw new Error(`config não encontrado: ${CONFIG} (copie scripts/robo-corp/config.exemplo.json e preencha)`);
  const c = JSON.parse(fs.readFileSync(CONFIG, "utf8")) as Config;
  for (const [k, v] of [["corretora", c.corretora], ["unidade", c.unidade]] as const)
    if (!v?.usuario || !v?.senha || v.senha === "PREENCHER") throw new Error(`config: preencha ${k}.usuario/senha`);
  return c;
}

// ------------------------------------------------------------ fotos e modelos
let pastaFotos = "";
let nFoto = 0;
async function foto(page: Page, nome: string): Promise<string> {
  const arq = path.join(pastaFotos, `${String(++nFoto).padStart(2, "0")}-${nome}.png`);
  await page.screenshot({ path: arq });
  return arq;
}

// Procura o modelo (png pequeno) na foto da tela; devolve o centro ou null.
// Comparação em tons de cinza, passo 1 px, tolerância média de 12/255.
async function acharNaTela(page: Page, modelo: string, tolerancia = 12): Promise<{ x: number; y: number } | null> {
  const arqModelo = path.join(MODELOS, `${modelo}.png`);
  if (!fs.existsSync(arqModelo)) return null;
  const tela = await sharp(await page.screenshot()).greyscale().raw().toBuffer({ resolveWithObject: true });
  const mod = await sharp(arqModelo).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = tela.info;
  const { width: w, height: h } = mod.info;
  let melhor: { x: number; y: number; dif: number } | null = null;
  // amostra 1 pixel em cada 2 do modelo para acelerar; confere por inteiro só o melhor.
  for (let y = 0; y <= H - h; y++) {
    for (let x = 0; x <= W - w; x++) {
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
      if (dif <= tolerancia && (!melhor || dif < melhor.dif)) melhor = { x, y, dif };
    }
  }
  return melhor ? { x: melhor.x + w / 2, y: melhor.y + h / 2 } : null;
}

async function clicarModelo(page: Page, modelo: string, descricao: string) {
  const p = await acharNaTela(page, modelo);
  if (!p) {
    await foto(page, `erro-nao-achei-${modelo}`);
    throw new Error(`não achei "${descricao}" na tela (modelo ${modelo}.png)`);
  }
  await page.mouse.click(p.x, p.y);
  log(`cliquei em ${descricao} (${Math.round(p.x)},${Math.round(p.y)})`);
}

// ------------------------------------------------------------ Corp
async function entrar(ctx: BrowserContext, cfg: Config): Promise<Page> {
  const login = await ctx.newPage();
  await login.goto(cfg.url, { waitUntil: "domcontentloaded" });
  await login.fill('input[placeholder="Usuário"]', cfg.corretora.usuario);
  await login.fill('input[placeholder="Senha"]', cfg.corretora.senha);
  await foto(login, "login-corretora");
  // O botão não tem texto no HTML (nome só pela acessibilidade): clica pelo papel/nome e, se não achar, Enter no campo da senha.
  await login
    .getByRole("button", { name: /entrar/i })
    .click({ timeout: 10_000 })
    .catch(() => login.press('input[placeholder="Senha"]', "Enter"));
  // Tela intermediária "Clique para acessar" com o quadro da corretora ("O2"):
  // o clique abre o programa numa aba nova (/software/html5.html).
  await login.getByText("Clique para acessar").waitFor({ timeout: 30_000 });
  await foto(login, "escolher-corretora");
  const [app] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 60_000 }).catch(() => null),
    login.getByText("O2", { exact: true }).first().click(),
  ]);
  const page = app ?? login;
  await page.waitForLoadState("domcontentloaded");
  await page.bringToFront();
  // O programa demora para carregar (nuvem girando): espera a janela de login
  // do Corp (rótulo "Usuário") aparecer, até 2 minutos.
  const rotulo = await esperarModelo(page, "login-usuario-rotulo", 120_000);
  await foto(page, "app-aberto");
  // 2º login (unidade/pessoa). O programa é remoto: cada clique/tecla leva um
  // instante para chegar, por isso as pausas e a digitação lenta (na 1ª
  // tentativa as primeiras letras se perderam). Campo Usuário à direita do
  // rótulo; Senha uma linha abaixo (o campo tem autocompletar, então não usa Tab).
  await page.mouse.click(rotulo.x + 110, rotulo.y);
  await espera(1200);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(cfg.unidade.usuario, { delay: 110 });
  await espera(1000);
  // O campo autocompleta e abre uma lista por cima da Senha: Tab fecha a lista e vai para a Senha.
  await page.keyboard.press("Tab");
  await espera(1200);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(cfg.unidade.senha, { delay: 110 });
  await espera(1000);
  await foto(page, "login-unidade");
  // Enter confirma (o botão Entrar muda de cor quando habilita, então não serve de modelo).
  await page.keyboard.press("Enter");
  // Espera a janela de login sumir (até 90 s) e o menu carregar.
  const fim = Date.now() + 90_000;
  while (Date.now() < fim && (await acharNaTela(page, "login-usuario-rotulo"))) await espera(2000);
  if (await acharNaTela(page, "login-usuario-rotulo")) {
    await foto(page, "erro-login-unidade");
    throw new Error("o Corp não aceitou o login da unidade (confira usuário/senha em config.json)");
  }
  await espera(8000);
  await foto(page, "menu-principal");
  return page;
}

// Espera um modelo aparecer na tela (foto a cada 2 s).
async function esperarModelo(page: Page, modelo: string, timeoutMs: number): Promise<{ x: number; y: number }> {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    const p = await acharNaTela(page, modelo);
    if (p) return p;
    await espera(2000);
  }
  await foto(page, `erro-esperando-${modelo}`);
  throw new Error(`"${modelo}" não apareceu em ${Math.round(timeoutMs / 1000)} s`);
}

async function abrirGerenciador(page: Page) {
  // Menu Consultas (Alt+C) → Gerenciador de Relatórios (G).
  await page.keyboard.press("Alt+c");
  await espera(800);
  await foto(page, "menu-consultas");
  await page.keyboard.press("g");
  await espera(2500);
  await foto(page, "gerenciador");
}

// Clica o primeiro modelo que aparecer (ex.: item selecionado × normal).
async function clicarUmDe(page: Page, modelos: string[], descricao: string) {
  for (const m of modelos) {
    const p = await acharNaTela(page, m);
    if (p) {
      await page.mouse.click(p.x, p.y);
      log(`cliquei em ${descricao} (${Math.round(p.x)},${Math.round(p.y)})`);
      return p;
    }
  }
  await foto(page, `erro-nao-achei-${modelos[0]}`);
  throw new Error(`não achei "${descricao}" na tela (modelos ${modelos.join(", ")})`);
}

async function selecionarRelatorio(page: Page, r: Relatorio) {
  const a = ARVORE[r.tipo];
  // Relatório já aberto (ex.: 2º ano da grade): só troca o período.
  if (r.tipo === "grade" && (await acharNaTela(page, "titulo-propostas-grade"))) {
    log("relatório já aberto");
    return;
  }
  const g = slug(a.grupo);
  await clicarUmDe(page, [`arvore-${g}`, `arvore-${g}-sel`], `grupo "${a.grupo}"`);
  await espera(600);
  if (!(await acharNaTela(page, `arvore-${slug(a.item)}`))) {
    await page.keyboard.press("ArrowRight"); // expande o grupo
    await espera(900);
  }
  await clicarUmDe(page, [`arvore-${slug(a.item)}`], `relatório "${a.item}"`);
  await espera(3000);
  await foto(page, `filtros-${r.id}`);
}

// A caixa de marcar à esquerda do rótulo está marcada? (compara com modelos/caixa-marcada.png)
// O Corp lembra os filtros do usuário entre sessões, então a caixa pode já vir
// marcada: compara a região (com folga de 4 px, porque a posição é estimada a
// partir do rótulo) com os modelos de caixa marcada E vazia, e fica com o mais parecido.
async function caixaMarcada(page: Page, x: number, y: number): Promise<boolean> {
  const marcada = await sharp(path.join(MODELOS, "caixa-marcada.png")).greyscale().raw().toBuffer({ resolveWithObject: true });
  const vazia = await sharp(path.join(MODELOS, "caixa-vazia.png")).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = marcada.info;
  const folga = 4;
  const tela = await sharp(await page.screenshot())
    .extract({ left: Math.round(x - w / 2) - folga, top: Math.round(y - h / 2) - folga, width: w + 2 * folga, height: h + 2 * folga })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = tela.info.width;
  const dif = (mod: Buffer, ox: number, oy: number) => {
    let s = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) s += Math.abs(tela.data[(oy + j) * W + ox + i] - mod[j * w + i]);
    return s / (w * h);
  };
  let melhorMarcada = Infinity, melhorVazia = Infinity;
  for (let oy = 0; oy <= 2 * folga; oy++)
    for (let ox = 0; ox <= 2 * folga; ox++) {
      melhorMarcada = Math.min(melhorMarcada, dif(marcada.data, ox, oy));
      melhorVazia = Math.min(melhorVazia, dif(vazia.data, ox, oy));
    }
  log(`caixa em (${Math.round(x)},${Math.round(y)}): marcada=${melhorMarcada.toFixed(1)} vazia=${melhorVazia.toFixed(1)}`);
  return melhorMarcada < melhorVazia;
}

// Filtros da grade, iguais à tela do Matheus (21/10/2026): período do arquivo,
// Prêmio = Líquido, comissão da corretora + dos produtores + percentual.
// O usuário do robô começa com período vazio e Prêmio "Base de Comissão".
const digitos = (d: string) => d.replace(/\D/g, "");
async function preencherFiltrosGrade(page: Page, r: Relatorio) {
  if (!r.de || !r.ate) return;
  const ini = await acharNaTela(page, "rotulo-inicial");
  if (!ini) throw new Error("não achei o campo Inicial do período");
  for (const [dx, valor] of [[0, r.de], [114, r.ate]] as const) {
    await page.mouse.click(ini.x, ini.y + 23);
    await page.mouse.click(ini.x + dx, ini.y + 23);
    await espera(600);
    await page.keyboard.press("Home");
    await page.keyboard.type(digitos(valor), { delay: 90 }); // máscara  /  /  já tem as barras
    await espera(400);
  }
  const pr = await acharNaTela(page, "rotulo-premio");
  if (!pr) throw new Error("não achei o campo Prêmio");
  await page.mouse.click(pr.x + 190, pr.y + 24); // seta da lista
  await espera(700);
  await page.keyboard.press("l"); // Líquido
  await espera(400);
  await page.keyboard.press("Enter");
  await espera(600);
  const corretora = await acharNaTela(page, "rotulo-comissao-corretora");
  if (!corretora) throw new Error("não achei a caixa Comissão da Corretora");
  const esquerda = corretora.x - 67 - 11; // centro da caixa: 11 px à esquerda do rótulo
  for (const dy of [0, 22, 44]) {
    if (!(await caixaMarcada(page, esquerda, corretora.y + dy))) {
      await page.mouse.click(esquerda, corretora.y + dy);
      await espera(500);
    }
  }
  await foto(page, `filtros-prontos-${r.id}`);
}

// Clientes com Documentos, como o arquivo do SharePoint (conferido 21/10/2026):
// período 01/01/2020 → hoje por Início de Vigência e "Mostrar Documentos
// Cancelados" marcado (sem o período vêm 127 mil linhas; sem a caixa, 89 mil).
async function preencherFiltrosClientes(page: Page, r: Relatorio) {
  await preencherPeriodo(page, r);
  const rot = await acharNaTela(page, "rotulo-mostrar-cancelados");
  if (!rot) throw new Error("não achei a caixa Mostrar Documentos Cancelados");
  const cx = rot.x - 93 - 11;
  if (!(await caixaMarcada(page, cx, rot.y))) {
    await page.mouse.click(cx, rot.y);
    await espera(500);
  }
  await foto(page, `filtros-prontos-${r.id}`);
}

// Sinistros Geral - Grade: período por data de ocorrência de 01/01/2020 até hoje
// (como o arquivo do SharePoint; sem período o Corp traz desde 2015).
async function preencherPeriodo(page: Page, r: Relatorio) {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const de = r.de ?? "01/01/2020";
  const ate = r.ate && r.ate !== "hoje" ? r.ate : hoje;
  const ini = await acharNaTela(page, "rotulo-inicial");
  if (!ini) throw new Error("não achei o campo Inicial do período");
  for (const [dx, valor] of [[0, de], [114, ate]] as const) {
    await page.mouse.click(ini.x + dx, ini.y + 23);
    await espera(600);
    await page.keyboard.press("Home");
    await page.keyboard.type(digitos(valor), { delay: 90 });
    await espera(400);
  }
  await foto(page, `filtros-prontos-${r.id}`);
}

async function exportarExcel(page: Page, r: Relatorio, cfg: Config): Promise<string> {
  const destino = path.join(cfg.pastaSaida, `${r.id}.xlsx`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15 * 60_000 }),
    clicarModelo(page, "botao-excel", "botão Exportar para Excel"),
  ]);
  log(`baixando ${download.suggestedFilename()}…`);
  await download.saveAs(destino);
  const kb = Math.round(fs.statSync(destino).size / 1024);
  log(`salvo ${destino} (${kb} KB)`);
  await foto(page, `exportado-${r.id}`);
  if (cfg.pastaSharepoint) {
    const pastaSp = path.join(cfg.pastaSharepoint, r.pasta);
    if (!fs.existsSync(pastaSp)) throw new Error(`pasta do SharePoint não existe: ${pastaSp}`);
    fs.copyFileSync(destino, path.join(pastaSp, `${r.id}.xlsx`));
    log(`copiado para o SharePoint: ${path.join(r.pasta, `${r.id}.xlsx`)}`);
  }
  return destino;
}

async function fecharRelatorio(page: Page) {
  // Botão SAIR da janela Relatórios; se não achar, Esc.
  const p = await acharNaTela(page, "botao-sair");
  if (p) await page.mouse.click(p.x, p.y);
  else await page.keyboard.press("Escape");
  await espera(1000);
}

// Painel do Corp: Consultas → Gráficos de Análise e Metas (5º item do menu).
// Abre em tela cheia, no mês atual. Fotografa "Produção Total" nas três abas
// do topo (Prêmio Base, Comissão, Qtde de Docs), para conferir os números com
// o que acabou de ser exportado (mesmo instante).
async function fotografarPainel(page: Page) {
  await page.keyboard.press("Alt+c");
  await espera(900);
  await page.mouse.click(281, 141);
  await espera(12_000);
  await page.mouse.click(64, 99); // sub-aba Produção Total
  await espera(3000);
  for (const [x, nome] of [[79, "premio"], [218, "comissao"], [358, "qtde-docs"]] as const) {
    await page.mouse.click(x, 20);
    await espera(7000);
    await foto(page, `painel-corp-${nome}`);
  }
  log("painel do Corp fotografado (prêmio, comissão, qtde de docs)");
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Grades em uso (decisão do Matheus, 23/10/2026): os anos fechados já estão na
// base e congelados (mês fechado não muda), então o robô só baixa a grade do ano
// que cobre o período ainda aberto: do mês anterior (só até o dia 15, regra do
// fechamento do Workspace) até o mês seguinte (renovações com vigência adiantada).
// Na prática é a grade do ano corrente; em dezembro entra também a do ano
// seguinte e, de 1º a 15 de janeiro, a do ano anterior. Ano sem linha no
// config.json ganha uma no padrão do arquivo do ano (grade_prods_AAAA, 01/01 a
// 31/12, mesma pasta). Com --todos (ou --so) baixa o que o config manda.
const dataBr = (s: string) => {
  const [d, m, a] = s.split("/").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};
export function gradesEmUso(relatorios: Relatorio[], hoje = new Date()): Relatorio[] {
  const [a, m, d] = hoje.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).split("-").map(Number);
  const inicio = new Date(Date.UTC(a, m - 1 - (d <= 15 ? 1 : 0), 1));
  const fim = new Date(Date.UTC(a, m + 1, 0)); // último dia do mês seguinte
  const grades = relatorios.filter((r) => r.tipo === "grade");
  const pasta = grades[0]?.pasta ?? "CORP_01.02 - Propostas Grade por Produtor";
  const escolhidas = grades.filter((r) => r.de && r.ate && dataBr(r.de) <= fim && dataBr(r.ate) >= inicio);
  for (let ano = inicio.getUTCFullYear(); ano <= fim.getUTCFullYear(); ano++) {
    const coberto = grades.some((r) => r.de && r.ate && dataBr(r.de) <= new Date(Date.UTC(ano, 0, 1)) && dataBr(r.ate) >= new Date(Date.UTC(ano, 11, 31)));
    if (!coberto) escolhidas.push({ id: `grade_prods_${ano}`, tipo: "grade", de: `01/01/${ano}`, ate: `31/12/${ano}`, pasta });
  }
  return [...escolhidas, ...relatorios.filter((r) => r.tipo !== "grade")];
}

async function main() {
  const cfg = lerConfig();
  if (LISTAR) {
    // --hoje AAAA-MM-DD simula outra data (conferir dezembro/janeiro).
    const hoje = args.includes("--hoje") ? new Date(`${args[args.indexOf("--hoje") + 1]}T12:00:00-03:00`) : new Date();
    const lista = TODOS ? cfg.relatorios : gradesEmUso(cfg.relatorios, hoje);
    for (const r of lista) log(`${r.id} (${r.de ?? "—"} a ${r.ate ?? "—"})`);
    return;
  }
  fs.mkdirSync(cfg.pastaSaida, { recursive: true });
  pastaFotos = path.join(RAIZ, "saida", MAPEAR ? "mapa" : agora());
  fs.mkdirSync(pastaFotos, { recursive: true });
  log(`fotos em ${pastaFotos}`);

  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true, locale: "pt-BR" });
  try {
    const page = await entrar(ctx, cfg);
    await abrirGerenciador(page);
    if (MAPEAR) {
      // Fotografa a árvore expandida e o relatório da grade, para recortar os modelos
      // (posições do "+" de baixo para cima, para os de cima não se deslocarem).
      for (const [x, y] of [[12, 126], [12, 78], [12, 62]]) {
        await page.mouse.click(x, y);
        await espera(700);
      }
      await foto(page, "arvore-expandida");
      await page.mouse.click(127, 94); // Propostas Grade por Produtor
      await espera(3000);
      await foto(page, "filtros-grade");
      await fecharRelatorio(page);
      await foto(page, "apos-sair");
      log("mapeamento feito — recorte os modelos a partir das fotos em saida/mapa/ (ver README)");
    } else {
      const lista = SO ? cfg.relatorios.filter((r) => r.id === SO) : TODOS ? cfg.relatorios : gradesEmUso(cfg.relatorios);
      if (!lista.length) throw new Error(`nenhum relatório com id "${SO}" no config`);
      const feitos: string[] = [];
      for (const r of lista) {
        log(`--- ${r.id}`);
        await selecionarRelatorio(page, r);
        if (r.tipo === "grade") await preencherFiltrosGrade(page, r);
        if (r.tipo === "clientes") await preencherFiltrosClientes(page, r);
        if (r.tipo === "sinistros") await preencherPeriodo(page, r);
        feitos.push(await exportarExcel(page, r, cfg));
      }
      await fecharRelatorio(page);
      log(`pronto: ${feitos.length} arquivo(s)`);
      if (PAINEL) await fotografarPainel(page);
    }
  } finally {
    if (MANTER) log("navegador mantido aberto (--manter); feche à mão quando terminar");
    else await browser.close();
  }
}

main().catch(async (e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
