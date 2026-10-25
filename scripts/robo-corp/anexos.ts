// Robô dos anexos do Corp (24/10/2026, pedido do Matheus): para cada Nosso Nº da
// fila, abre o documento no Corp (Consultar Documentos → Busca), vai na aba Anexos,
// e baixa cada anexo do tipo "Apólice" pelo "Visualizar Anexo" (o Corp abre o PDF
// numa aba em s07.corpnuvem.com/Downloads/..., que baixa sem login).
// Não altera nada no Corp: só busca, abre, olha e fecha a janela.
//
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/anexos.ts [opções]
//   --fila fianca-vigentes   monta a fila no banco (Fiança vigente sem PDF no acervo) e sai
//   --fila fora-faturas      monta a fila de PRIORIDADE (prioridade.json): apólices "fora das últimas faturas" do ERP
//                            (Expan/Tokio primeiro) — a rodada visita a prioridade antes da fila normal
//   --limite N               processa no máximo N documentos nesta rodada
//   --ate HH:MM              para de pegar documento novo nesse horário (rodada da noite)
//   --mapear NN              só fotografa cada passo com o Nosso Nº NN (calibração)
//   --manter                 deixa o navegador aberto no fim
// Fila, estado e PDFs (dados pessoais) ficam FORA do projeto: %TEMP%/o2-apolices-corp.
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createServiceClient } from "@/lib/supabase/service";
import { agora, acharTodos, acharNaTela, definirPastaFotos, entrar, espera, esperarModelo, foto, lerConfig, log, RAIZ, VIEWPORT } from "./_corp";

const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const PDFS = path.join(PASTA, "pdfs");
const FILA = path.join(PASTA, "fila.json");
const ESTADO = path.join(PASTA, "estado.json");
const PRIORIDADE = path.join(PASTA, "prioridade.json");
fs.mkdirSync(PDFS, { recursive: true });

type Item = { nn: string; produto: string; fim_vig: string };
/** por Nosso Nº: resultado da visita ao Corp */
type Estado = Record<string, { quando: string; resultado: "baixado" | "sem_anexo_apolice" | "nao_achou" | "erro"; arquivos?: string[]; erro?: string }>;
const lerJson = <T>(f: string, padrao: T): T => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : padrao);

// ------------------------------------------------------------ fila
async function montarFila(qual: string) {
  if (qual === "fora-faturas") return montarPrioridadeForaFaturas();
  if (qual !== "fianca-vigentes") throw new Error(`fila desconhecida: ${qual}`);
  const sb = createServiceClient();
  const hoje = new Date().toISOString().slice(0, 10);
  const grade: { nosso_numero: number; ramo: string; fim_vig: string; numero_endosso: string | null; tipo: string }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from("corp_grade").select("nosso_numero,ramo,fim_vig,numero_endosso,tipo")
      .in("tipo", ["NOVO", "RENV"]).in("ramo", ["FIAN", "2FIA"]).gte("fim_vig", hoje).gte("ini_vig", "2020-01-01").order("id").range(de, de + 999);
    if (error) throw new Error(error.message);
    grade.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const nns = [...new Set(grade.filter((g) => (g.numero_endosso ?? "0").replace(/^0+/, "") === "").map((g) => String(g.nosso_numero)))];
  const temPdf = new Set<string>();
  for (let i = 0; i < nns.length; i += 300) {
    const { data, error } = await sb.from("apolice_documentos").select("nosso_numero").eq("situacao", "certa").in("nosso_numero", nns.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const x of data ?? []) temPdf.add(x.nosso_numero);
  }
  const fimDe = new Map(grade.map((g) => [String(g.nosso_numero), g.fim_vig]));
  // Mais novos primeiro (Nosso Nº maior): são os que mais vão aparecer em sinistro nos próximos meses.
  const fila: Item[] = nns.filter((nn) => !temPdf.has(nn)).sort((a, b) => Number(b) - Number(a)).map((nn) => ({ nn, produto: "fianca", fim_vig: fimDe.get(nn)! }));
  fs.writeFileSync(FILA, JSON.stringify(fila));
  log(`fila: ${fila.length} Fianças vigentes sem PDF no acervo (de ${nns.length} vigentes) → ${FILA}`);
}

// Prioridade (Matheus 25/10): as apólices que o ERP acusa "fora das últimas faturas" (ex.: 149 Incêndio Tokio da
// Expan) — o PDF da apólice mostra a forma de cobrança e explica se é fatura ou boleto. Maiores grupos primeiro.
async function montarPrioridadeForaFaturas() {
  const sb = createServiceClient();
  const { data, error } = await sb.from("erp_fora_faturas_pronto").select("nosso_numero_corp, imobiliaria, seguradora, produto, vigencia_inicio");
  if (error) throw new Error(error.message);
  const linhas = (data ?? []).filter((l: { nosso_numero_corp: number | null }) => l.nosso_numero_corp) as { nosso_numero_corp: number; imobiliaria: string; seguradora: string; produto: string | null; vigencia_inicio: string | null }[];
  const tamanho = new Map<string, number>();
  for (const l of linhas) tamanho.set(`${l.imobiliaria}|${l.seguradora}`, (tamanho.get(`${l.imobiliaria}|${l.seguradora}`) ?? 0) + 1);
  linhas.sort((a, b) => (tamanho.get(`${b.imobiliaria}|${b.seguradora}`)! - tamanho.get(`${a.imobiliaria}|${a.seguradora}`)!) || b.nosso_numero_corp - a.nosso_numero_corp);
  const nns = [...new Set(linhas.map((l) => String(l.nosso_numero_corp)))];
  const temPdf = new Set<string>();
  for (let i = 0; i < nns.length; i += 300) {
    const { data: ja } = await sb.from("apolice_documentos").select("nosso_numero").eq("situacao", "certa").in("nosso_numero", nns.slice(i, i + 300));
    for (const x of ja ?? []) temPdf.add(x.nosso_numero);
  }
  const fila: Item[] = nns.filter((nn) => !temPdf.has(nn)).map((nn) => ({ nn, produto: linhas.find((l) => String(l.nosso_numero_corp) === nn)?.produto ?? "?", fim_vig: "" }));
  fs.writeFileSync(PRIORIDADE, JSON.stringify(fila));
  log(`prioridade: ${fila.length} apólices fora das faturas sem PDF no acervo (de ${nns.length}) → ${PRIORIDADE}`);
}

// ------------------------------------------------------------ Corp
async function abrirConsultaDocumentos(page: Page) {
  // Seta ao lado do botão de documentos → "Consultar Documentos" → aba Busca.
  await page.mouse.click(131, 47);
  await espera(1200);
  await page.mouse.click(175, 118);
  await espera(4000);
  await page.mouse.click(80, 36);
  await espera(1500);
}

/** A 1ª linha do resultado tem texto? Conta pixels escuros na coluna Início Vig. (a célula do Cliente fica selecionada em azul depois do 1º documento). */
async function temLinhaNoResultado(page: Page): Promise<boolean> {
  const { data } = await sharp(await page.screenshot({ clip: { x: 845, y: 168, width: 68, height: 14 } })).greyscale().raw().toBuffer({ resolveWithObject: true });
  let escuros = 0;
  for (const v of data) if (v < 110) escuros++;
  return escuros > 15;
}

/** O Ctrl+A não seleciona o texto da busca do Corp: apaga com End + Backspace. */
async function limparBusca(page: Page) {
  // O programa é remoto e perde tecla rápida: pausas entre as teclas.
  await espera(600);
  await page.keyboard.press("End");
  await espera(300);
  for (let i = 0; i < 16; i++) { await page.keyboard.press("Backspace"); await espera(90); }
  await espera(300);
}

/** Abre o documento pelo Nosso Nº (aba Busca já aberta). false se a busca não trouxe linha. */
async function abrirDocumento(page: Page, nn: string): Promise<boolean> {
  await page.mouse.click(250, 94);
  await espera(400);
  await limparBusca(page);
  await page.keyboard.type(nn, { delay: 60 });
  await page.keyboard.press("Enter");
  await espera(3000);
  if (process.env.ANEXOS_DEBUG) await foto(page, `busca-${nn}`);
  if (!(await temLinhaNoResultado(page))) return false;
  // Às vezes o Corp responde "Não posso abrir a área de transferência" (o Windows estava com
  // o copiar/colar ocupado): Enter fecha o aviso e tenta abrir de novo, até 3 vezes.
  for (let tentativa = 1; ; tentativa++) {
    await page.mouse.dblclick(370, 175);
    const fim = Date.now() + 12_000;
    while (Date.now() < fim) {
      if (await acharNaTela(page, "doc-aba-anexos")) return true;
      await espera(1000);
    }
    if (tentativa >= 3) break;
    await page.keyboard.press("Enter");
    await espera(1500);
  }
  await esperarModelo(page, "doc-aba-anexos", 8000);
  return true;
}

async function fecharDocumento(page: Page) {
  const x = await acharNaTela(page, "doc-fechar");
  if (x) await page.mouse.click(x.x, x.y);
  else await page.keyboard.press("Escape");
  await espera(1500);
}

/** Na aba Anexos: baixa cada anexo do tipo Apólice. Devolve os arquivos salvos. */
async function baixarApolices(page: Page, nn: string): Promise<string[]> {
  const aba = await esperarModelo(page, "doc-aba-anexos", 10_000);
  await page.mouse.click(aba.x, aba.y);
  await espera(2500);
  // Rótulo "Apólice" na coluna de tipo: a linha selecionada (a 1ª, ao abrir) tem fundo azul-claro.
  const area = { x0: 900, y0: 190, x1: 1150, y1: 610 };
  const rotulos = [...(await acharTodos(page, "anexo-tipo-apolice-sel", 14, area)), ...(await acharTodos(page, "anexo-tipo-apolice", 14, area))]
    .filter((p, i, xs) => xs.findIndex((q) => Math.abs(q.y - p.y) < 10) === i)
    .sort((p, q) => p.y - q.y);
  const salvos: string[] = [];
  for (const [i, r] of rotulos.entries()) {
    await page.mouse.click(r.x - 450, r.y); // nome do arquivo, na mesma linha
    await espera(700);
    const olho = await esperarModelo(page, "anexo-visualizar", 5000);
    const [aba] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 30_000 }),
      page.mouse.click(olho.x, olho.y),
    ]);
    await aba.waitForLoadState("domcontentloaded").catch(() => {});
    const url = aba.url();
    await aba.close();
    if (!/^https:\/\/[\w.-]+\.corpnuvem\.com\/Downloads\//.test(url)) throw new Error(`endereço inesperado do anexo: ${url.slice(0, 60)}`);
    const r2 = await fetch(url);
    if (!r2.ok) throw new Error(`download ${r2.status}`);
    const buf = Buffer.from(await r2.arrayBuffer());
    if (buf.subarray(0, 4).toString() !== "%PDF") throw new Error("anexo não é PDF");
    const arq = path.join(PDFS, `${nn}__${i + 1}.pdf`);
    fs.writeFileSync(arq, buf);
    fs.writeFileSync(arq.replace(/\.pdf$/, ".nome.txt"), decodeURIComponent(url.split("/").pop() ?? ""));
    salvos.push(path.basename(arq));
    await espera(800);
  }
  return salvos;
}

// ------------------------------------------------------------ rodada
async function main() {
  const qualFila = arg("--fila");
  if (qualFila) return montarFila(qualFila);
  const MAPEAR = arg("--mapear");
  const limite = Number(arg("--limite") ?? 1e9);
  const ate = arg("--ate");
  const pararEm = ate ? (() => { const [h, m] = ate.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d; })() : null;

  definirPastaFotos(path.join(RAIZ, "saida", MAPEAR ? "mapa-anexos" : `anexos-${agora()}`));
  const cfg = lerConfig();

  // O Corp é instável: o login trava, a sessão cai, o navegador fecha ("Target page,
  // context or browser has been closed"). Regra do Matheus (25/10): não parar — fechar o
  // navegador, refazer o login do zero e continuar de onde parou, até o horário-limite.
  // O estado (estado.json) é gravado a cada documento, então a retomada é natural.
  const MAX_REINICIOS = 12;
  for (let reinicio = 0; ; reinicio++) {
    const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
    const ctx = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true, locale: "pt-BR" });
    let terminou = false;
    try {
      terminou = await rodada(ctx, cfg, { MAPEAR, limite, ate, pararEm });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      log(`sessão caiu: ${msg}`);
      if (MAPEAR || reinicio >= MAX_REINICIOS) throw e;
    } finally {
      if (args.includes("--manter")) log("navegador mantido aberto (--manter)");
      else await browser.close().catch(() => {});
    }
    if (terminou || MAPEAR) return;
    if (pararEm && new Date() >= pararEm) { log(`horário-limite ${ate}: parando`); return; }
    const pausa = Math.min(60 * (reinicio + 1), 300);
    log(`reinício ${reinicio + 1}/${MAX_REINICIOS} em ${pausa} s (fecha o navegador e refaz o login)`);
    await espera(pausa * 1000);
  }
}

// Uma sessão no Corp: login, busca e varredura da fila. Devolve true quando a fila
// acabou ou o horário-limite chegou; lança erro quando a sessão precisa ser refeita.
async function rodada(
  ctx: BrowserContext,
  cfg: ReturnType<typeof lerConfig>,
  o: { MAPEAR: string | null | undefined; limite: number; ate: string | null | undefined; pararEm: Date | null }
): Promise<boolean> {
  const { MAPEAR, limite, ate, pararEm } = o;
  {
    const page = await entrar(ctx, cfg);
    await abrirConsultaDocumentos(page);
    if (MAPEAR) {
      await foto(page, "busca");
      await page.mouse.click(250, 94);
      await page.keyboard.type(MAPEAR, { delay: 60 });
      await page.keyboard.press("Enter");
      await espera(3000);
      await foto(page, "resultado");
      await page.mouse.dblclick(370, 175);
      await espera(5000);
      await foto(page, "documento");
      const aba = await esperarModelo(page, "doc-aba-anexos", 10_000);
      await page.mouse.click(aba.x, aba.y);
      await espera(2500);
      await foto(page, "anexos");
      await page.mouse.click(700, 262); // seleciona a 2ª linha: a 1ª fica sem destaque
      await espera(1000);
      await foto(page, "anexos-2a-linha");
      await fecharDocumento(page);
      await foto(page, "fechado");
      await page.mouse.click(250, 94);
      await limparBusca(page);
      await page.keyboard.type("987654321", { delay: 60 });
      await page.keyboard.press("Enter");
      await espera(3000);
      await foto(page, "sem-resultado");
      log("mapeamento: recorte os modelos a partir de saida/mapa-anexos");
      return true;
    }
    // a prioridade (--fila fora-faturas) vem antes da fila normal; o mesmo Nosso Nº não entra duas vezes
    const estado0 = lerJson<Estado>(ESTADO, {});
    const prioridade = lerJson<Item[]>(PRIORIDADE, []);
    const naPrioridade = new Set(prioridade.map((i) => i.nn));
    const fila = [...prioridade, ...lerJson<Item[]>(FILA, []).filter((i) => !naPrioridade.has(i.nn))];
    if (!fila.length) throw new Error("fila vazia: rode com --fila fianca-vigentes");
    if (prioridade.length) log(`prioridade: ${prioridade.filter((i) => !estado0[i.nn] || estado0[i.nn].resultado === "erro").length} de ${prioridade.length} ainda a visitar`);
    const estado = estado0;
    const pendentes = fila.filter((i) => !estado[i.nn] || estado[i.nn].resultado === "erro");
    log(`fila: ${fila.length} | já visitados: ${fila.length - pendentes.length} | nesta rodada: até ${Math.min(limite, pendentes.length)}`);
    let feitos = 0, erros = 0, limiteHorario = false;
    for (const item of pendentes.slice(0, limite)) {
      if (pararEm && new Date() >= pararEm) { log(`horário-limite ${ate}: parando`); limiteHorario = true; break; }
      const t0 = Date.now();
      try {
        if (!(await abrirDocumento(page, item.nn))) estado[item.nn] = { quando: new Date().toISOString(), resultado: "nao_achou" };
        else {
          const arquivos = await baixarApolices(page, item.nn);
          estado[item.nn] = { quando: new Date().toISOString(), resultado: arquivos.length ? "baixado" : "sem_anexo_apolice", arquivos };
          await fecharDocumento(page);
        }
        erros = 0;
      } catch (e) {
        estado[item.nn] = { quando: new Date().toISOString(), resultado: "erro", erro: (e as Error).message };
        await foto(page, `erro-${item.nn}`);
        log(`erro no ${item.nn}: ${(e as Error).message}`);
        // volta para um estado conhecido: fecha janelas e reabre a busca
        await page.keyboard.press("Escape").catch(() => {});
        await fecharDocumento(page).catch(() => {});
        fs.writeFileSync(ESTADO, JSON.stringify(estado));
        // 5 erros seguidos = a tela saiu do lugar conhecido: refaz a sessão inteira (login do zero)
        if (++erros >= 5) throw new Error("5 erros seguidos: refazendo o login do zero");
        await abrirConsultaDocumentos(page).catch(() => {});
      }
      fs.writeFileSync(ESTADO, JSON.stringify(estado));
      feitos++;
      log(`${item.nn}: ${estado[item.nn].resultado}${estado[item.nn].arquivos?.length ? ` (${estado[item.nn].arquivos!.length})` : ""} em ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    const r: Record<string, number> = {};
    for (const v of Object.values(estado)) r[v.resultado] = (r[v.resultado] ?? 0) + 1;
    log(`rodada: ${feitos} documento(s) | acumulado: ${JSON.stringify(r)}`);
    return limiteHorario || feitos >= Math.min(limite, pendentes.length);
  }
}

main().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
