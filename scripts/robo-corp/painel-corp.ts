// MAPA DO PAINEL DO CORP (Consultas → Gráficos de Análise e Metas) — SÓ LEITURA.
// Entra num login do orquestrador (passagem de vez: pausar-docs-<login>.flag), abre o painel e fica "ouvindo" comandos em
// ~/.robo-corp/painel-cmd.json (clicar, teclar, fotografar, esperar, rolar), para eu navegar o painel passo a passo sem refazer o login.
// Nada que altere dado é clicado: o painel só consulta. Fotos em saida/painel-corp-<data>/ (fora do git).
//   CORP_LOGIN=R3 npx tsx scripts/robo-corp/painel-corp.ts
// Comando: {"id":N,"acoes":[{"a":"click","x":64,"y":99},{"a":"shot","nome":"produção"},{"a":"wait","ms":3000},{"a":"key","k":"Alt+c"},{"a":"type","t":"2026"},{"a":"scroll","x":600,"y":500,"dy":600},{"a":"fim"}]}
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { LOGIN_ID, VIEWPORT, RAIZ, agora, espera, log, lerConfig, entrar, pegarVezDoCorp, definirPastaFotos, foto } from "./_corp";

const HOME = path.join(os.homedir(), ".robo-corp");
const CMD = path.join(HOME, "painel-cmd.json");
const RES = path.join(HOME, "painel-res.json");
const FLAG = path.join(HOME, LOGIN_ID === "principal" ? "pausar-docs.flag" : `pausar-docs-${LOGIN_ID}.flag`);
const TRAVA = path.join(HOME, LOGIN_ID === "principal" ? "login-em-uso.json" : `login-em-uso-${LOGIN_ID}.json`);
const pasta = path.join(RAIZ, "saida", `painel-corp-${agora().slice(0, 10)}`);
definirPastaFotos(pasta);

const RESERVA = path.join(HOME, `reservar-${LOGIN_ID}.flag`);
const soltarFlag = () => { try { fs.unlinkSync(FLAG); } catch { /* ok */ } try { fs.unlinkSync(RESERVA); } catch { /* ok */ } };
process.on("exit", soltarFlag);

(async () => {
  // passagem de vez: pede ao robô de documentos deste login que termine o documento atual e libere; a flag fica enquanto eu uso o login (o orquestrador só relança os documentos depois)
  fs.writeFileSync(RESERVA, `painel-corp.ts ${new Date().toISOString()}`); // o orquestrador não relança nada neste login enquanto a reserva existir
  fs.writeFileSync(FLAG, `painel-corp.ts ${new Date().toISOString()}`);
  log(`pausa pedida (${path.basename(FLAG)}); esperando o login ${LOGIN_ID} ficar livre`);
  process.env.CORP_VEZ_ESPERA_MIN ??= "15";
  const cfg = lerConfig();
  await pegarVezDoCorp("painel-corp (mapa do painel, só leitura)");
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--start-maximized", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWindowOcclusion"] });
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: "pt-BR" });
  try {
    const page = await entrar(ctx, cfg, "painel-corp");
    log("dentro do Corp; abrindo Consultas → Gráficos de Análise e Metas");
    await page.keyboard.press("Alt+c"); await espera(900);
    await foto(page, "menu-consultas");
    await page.mouse.click(281, 141); await espera(12_000);
    await foto(page, "painel-abertura");
    try { fs.unlinkSync(CMD); } catch { /* ok */ }
    fs.writeFileSync(RES, JSON.stringify({ pronto: true, pasta, em: Date.now() }));
    log(`painel aberto; ouvindo comandos em ${CMD} (fotos em ${pasta})`);
    const limite = Date.now() + 60 * 60_000;
    let ultimo = 0;
    for (;;) {
      if (Date.now() > limite) { log("limite de 60 min: encerrando"); break; }
      if (!fs.existsSync(CMD)) { await espera(1000); continue; }
      let c: { id: number; acoes: Record<string, unknown>[] };
      try { c = JSON.parse(fs.readFileSync(CMD, "utf8")); } catch { await espera(500); continue; }
      fs.unlinkSync(CMD);
      if (c.id === ultimo) continue; ultimo = c.id;
      const fotos: string[] = []; let fim = false; let erro: string | null = null;
      try {
        for (const a of c.acoes) {
          const x = a.x as number, y = a.y as number;
          switch (a.a) {
            case "click": await page.mouse.click(x, y); break;
            case "dblclick": await page.mouse.dblclick(x, y); break;
            case "move": await page.mouse.move(x, y); break;
            case "key": await page.keyboard.press(String(a.k)); break;
            case "type": await page.keyboard.type(String(a.t), { delay: 80 }); break;
            case "scroll": await page.mouse.move(x, y); await page.mouse.wheel(0, (a.dy as number) ?? 500); break;
            case "wait": await espera((a.ms as number) ?? 1000); break;
            case "shot": fotos.push(await foto(page, String(a.nome ?? "tela"))); break;
            case "fim": fim = true; break;
          }
          if (fim) break;
          if (a.a !== "wait" && a.a !== "shot") await espera(a.pausa ? (a.pausa as number) : 700);
        }
      } catch (e) { erro = (e as Error).message; }
      fs.writeFileSync(RES, JSON.stringify({ id: c.id, fotos, erro, fim, em: Date.now() }));
      if (fim) break;
    }
  } finally {
    await browser.close().catch(() => {});
    soltarFlag();
    try { fs.writeFileSync(RES, JSON.stringify({ encerrado: true, em: Date.now() })); } catch { /* ok */ }
  }
})().catch((e) => { log("ERRO: " + (e as Error).message); soltarFlag(); process.exit(1); });
