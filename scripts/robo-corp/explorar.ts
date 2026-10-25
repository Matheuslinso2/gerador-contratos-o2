// Robô de EXPLORAÇÃO do Corp (25/10/2026): entra com o usuário do robô (config.json fora do projeto),
// abre Consultas → Gerenciador de Relatórios e fica esperando comandos num arquivo, para mapear
// relatórios novos (ex.: Comissões / baixa de comissão) vendo as fotos. Só lê telas: nenhum comando
// de gravação é enviado de propósito; quem dirige decide cada clique.
// uso: npx tsx scripts/robo-corp/explorar.ts            (fica rodando; Ctrl+C ou comando "sair" encerra)
// comandos: escrever em %TEMP%\corp-explorar\cmd.json uma lista, ex.:
//   [{"clique":[12,126]},{"duplo":[127,94]},{"tecla":"Alt+c"},{"texto":"01/09/2026"},{"espera":1500},{"foto":"arvore"},{"rolar":[200,300,3]},{"baixar":"nome.xlsx","clique":[x,y]},{"sair":true}]
// cada lote termina com uma foto automática; o resultado vai para %TEMP%\corp-explorar\ok.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { entrar, lerConfig, definirPastaFotos, foto, espera, log, VIEWPORT, RAIZ } from "./_corp";

const PASTA = path.join(os.tmpdir(), "corp-explorar");
const CMD = path.join(PASTA, "cmd.json");
const OK = path.join(PASTA, "ok.json");

type Comando = { clique?: [number, number]; duplo?: [number, number]; tecla?: string; texto?: string; espera?: number; foto?: string; rolar?: [number, number, number]; baixar?: string; sair?: boolean };

async function main() {
  fs.mkdirSync(PASTA, { recursive: true });
  for (const f of [CMD, OK]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const fotos = path.join(RAIZ, "saida", "explorar");
  definirPastaFotos(fotos);
  const cfg = lerConfig();
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true, locale: "pt-BR" });
  try {
    const page = await entrar(ctx, cfg);
    await page.keyboard.press("Alt+c");
    await espera(800);
    await page.keyboard.press("g");
    await espera(3000);
    const primeira = await foto(page, "gerenciador");
    fs.writeFileSync(OK, JSON.stringify({ pronto: true, fotos: [primeira] }));
    log(`pronto; comandos em ${CMD}`);
    const fim = Date.now() + 90 * 60_000; // no máximo 1h30
    while (Date.now() < fim) {
      if (!fs.existsSync(CMD)) { await espera(700); continue; }
      let lote: Comando[] = [];
      try { lote = JSON.parse(fs.readFileSync(CMD, "utf8")); } catch { await espera(500); continue; }
      fs.unlinkSync(CMD);
      const feitas: string[] = [];
      let sair = false;
      for (const c of lote) {
        if (c.sair) { sair = true; break; }
        if (c.baixar && c.clique) {
          const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.mouse.click(c.clique[0], c.clique[1])]);
          const destino = path.join(PASTA, c.baixar);
          await dl.saveAs(destino);
          feitas.push(`baixado: ${destino}`);
          continue;
        }
        if (c.clique) await page.mouse.click(c.clique[0], c.clique[1]);
        if (c.duplo) await page.mouse.dblclick(c.duplo[0], c.duplo[1]);
        if (c.tecla) await page.keyboard.press(c.tecla);
        if (c.texto) await page.keyboard.type(c.texto, { delay: 110 });
        if (c.rolar) { await page.mouse.move(c.rolar[0], c.rolar[1]); await page.mouse.wheel(0, 120 * c.rolar[2]); }
        await espera(c.espera ?? 700);
        if (c.foto) feitas.push(await foto(page, c.foto));
      }
      if (sair) break;
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
