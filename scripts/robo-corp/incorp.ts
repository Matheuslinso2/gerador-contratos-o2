// Robô do InCorp (Corp → Aplicativos → InCorp → Comissões) — Matheus 26/10/2026: "opere o InCorp dando baixa nas
// comissões". Entra com o usuário dos robôs (respeita a vez do login único: pegarVezDoCorp), abre o InCorp na aba
// Comissões e fica recebendo comandos num arquivo, como o explorar.ts, para cada passo ser conferido pela foto.
// Caminho mapeado em 26/10:
//   "Pasta Comissões" (77,50) → janela "Meus Arquivos" SGCSCorp_O2\InCorp\Comissoes (uma pasta por seguradora;
//   duplo clique entra) → "Enviar Arquivos" abre o seletor de arquivos do navegador (comando "enviar").
//   Ícone da seguradora na barra → linhas que o InCorp leu (branca = apólice apta, laranja = endosso apto,
//   amarela = não encontrada, verde = já baixada, vermelha = estorno); combo "Extrato" (240,702) lista os arquivos.
//   Importar (947,50) grava a baixa (pede Dt. Recebimento e Dt. Prev. Repasse = dia 15 do mês seguinte).
// uso: npx tsx scripts/robo-corp/incorp.ts   (comandos em %TEMP%\corp-incorp\cmd.json; resposta em ok.json)
//   [{"clique":[x,y]},{"duplo":[x,y]},{"tecla":"Enter"},{"texto":"08/09/2026"},{"espera":1500},{"foto":"nome"},
//    {"rolar":[x,y,n]},{"enviar":"C:\\...\\0809.txt","clique":[x,y]},{"baixar":"nome.txt","clique":[x,y]},{"sair":true}]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { entrar, lerConfig, definirPastaFotos, foto, espera, log, VIEWPORT, RAIZ } from "./_corp";

const PASTA = path.join(os.tmpdir(), "corp-incorp");
const CMD = path.join(PASTA, "cmd.json");
const OK = path.join(PASTA, "ok.json");

type Comando = { direito?: [number, number]; clique?: [number, number]; duplo?: [number, number]; tecla?: string; texto?: string; espera?: number; foto?: string; rolar?: [number, number, number]; enviar?: string; baixar?: string; sair?: boolean };

async function main() {
  fs.mkdirSync(PASTA, { recursive: true });
  for (const f of [CMD, OK]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const fotos = path.join(RAIZ, "saida", "incorp", new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "_").replace(/:/g, "-"));
  definirPastaFotos(fotos);
  const cfg = lerConfig();
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true, locale: "pt-BR" });
  try {
    const page = await entrar(ctx, cfg, "baixa-incorp");
    await page.mouse.click(381, 10); // Aplicativos
    await espera(1200);
    await page.mouse.click(397, 35); // InCorp
    await espera(6000);
    await page.mouse.click(295, 95); // aba Comissões
    await espera(4000);
    fs.writeFileSync(OK, JSON.stringify({ pronto: true, fotos: [await foto(page, "incorp")] }));
    log(`pronto; comandos em ${CMD}; fotos em ${fotos}`);
    const fim = Date.now() + 90 * 60_000;
    while (Date.now() < fim) {
      if (!fs.existsSync(CMD)) { await espera(700); continue; }
      let lote: Comando[] = [];
      try { lote = JSON.parse(fs.readFileSync(CMD, "utf8")); } catch { await espera(500); continue; }
      fs.unlinkSync(CMD);
      const feitas: string[] = [];
      let sair = false;
      try {
        for (const c of lote) {
          if (c.sair) { sair = true; break; }
          if (c.enviar && c.clique) {
            // O Corp (programa transmitido pela tela) pede "Após o Upload, clique em OK" e abre o envio pelo navegador:
            // pode ser seletor de arquivos, aba nova ou campo <input type=file> na própria página — procura nos três.
            let entregue = false;
            const naPagina = (p: import("playwright").Page) => p.on("filechooser", async (ch) => { if (!entregue) { entregue = true; await ch.setFiles(c.enviar!); } });
            ctx.pages().forEach(naPagina);
            ctx.on("page", naPagina);
            await page.mouse.click(c.clique[0], c.clique[1]);
            for (let i = 0; i < 20 && !entregue; i++) {
              await espera(1000);
              for (const p of ctx.pages()) {
                for (const fr of p.frames()) {
                  const campo = fr.locator('input[type="file"]').first();
                  if (!entregue && (await campo.count().catch(() => 0))) { await campo.setInputFiles(c.enviar).catch(() => {}); entregue = true; feitas.push(`campo de arquivo em ${new URL(fr.url()).host}`); }
                }
              }
            }
            const paginas = ctx.pages();
            for (const [k, p] of paginas.entries()) if (p !== page) feitas.push(await p.screenshot({ path: path.join(fotos, `aba-${k}.png`) }).then(() => `aba ${k}: ${p.url().slice(0, 80)}`).catch(() => `aba ${k}`));
            feitas.push(entregue ? `enviado: ${path.basename(c.enviar)}` : "NÃO achou onde entregar o arquivo");
            log(`envio ${path.basename(c.enviar)}: ${entregue ? "entregue" : "não entregue"} · abas: ${paginas.length}`);
            await espera(c.espera ?? 5000);
            continue;
          }
          if (c.baixar && c.clique) {
            const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), c.duplo ? page.mouse.dblclick(c.clique[0], c.clique[1]) : page.mouse.click(c.clique[0], c.clique[1])]);
            const destino = path.join(PASTA, c.baixar);
            await dl.saveAs(destino);
            feitas.push(`baixado: ${destino}`);
            continue;
          }
          if (c.direito) await page.mouse.click(c.direito[0], c.direito[1], { button: "right" });
          if (c.clique) await page.mouse.click(c.clique[0], c.clique[1]);
          if (c.duplo) await page.mouse.dblclick(c.duplo[0], c.duplo[1]);
          if (c.tecla) await page.keyboard.press(c.tecla);
          if (c.texto) await page.keyboard.type(c.texto, { delay: 110 });
          if (c.rolar) { await page.mouse.move(c.rolar[0], c.rolar[1]); await page.mouse.wheel(0, 120 * c.rolar[2]); }
          await espera(c.espera ?? 700);
          if (c.foto) feitas.push(await foto(page, c.foto));
        }
      } catch (e) {
        feitas.push(`ERRO no comando: ${(e as Error).message.split("\n")[0]}`);
      }
      if (sair) { fs.writeFileSync(OK, JSON.stringify({ pronto: true, saiu: true, fotos: feitas })); break; }
      await espera(800);
      feitas.push(await foto(page, "estado"));
      fs.writeFileSync(OK, JSON.stringify({ pronto: true, fotos: feitas }));
    }
  } catch (e) {
    fs.writeFileSync(OK, JSON.stringify({ erro: (e as Error).message }));
    throw e;
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
