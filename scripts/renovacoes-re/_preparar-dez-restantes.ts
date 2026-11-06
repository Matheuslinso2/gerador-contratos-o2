// Prepara os 10 cards de Incêndio Imobiliário de dez/2026 que faltam (Matheus autorizou 06/11): tira apólices já renovadas/canceladas no ERP e confere duplicidade no Bitrix (só leitura).
// Escreve renovacoes-re/cards/2026-12/cards-2026-12.PENDENTES.json (o original NÃO é alterado).
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { listarItensSpaCategoria } from "@/lib/bitrix/client";

const RETIRAR: Record<string, string> = { "7739433": "já tem renovação emitida no ERP", "7739884": "já tem renovação emitida no ERP", "7740027": "apólice cancelada no ERP" };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
async function main() {
  const dir = path.resolve(process.cwd(), "..", "renovacoes-re", "cards", "2026-12");
  const todos = JSON.parse(fs.readFileSync(path.join(dir, "cards-2026-12.json"), "utf8")) as any[];
  const alvo = todos.filter((c) => !c.bitrixId && /IMOB|2IMO/.test(c.ramos) && !/RENASCEN/.test(norm(c.titulo)));
  const existentes = await listarItensSpaCategoria(1046, 34);
  const titulos = new Set(existentes.map((i: any) => norm(String(i.title ?? ""))));
  const apolicasBitrix = new Map<string, string>();
  for (const i of existentes as any[]) for (const a of String(i["ufCrm12NumApolice"] ?? "").split(/[;,]/).map((x) => x.trim()).filter(Boolean)) apolicasBitrix.set(a, `${i.id} ${i.title}`);
  const saida: any[] = [];
  for (const c of alvo) {
    const retirar = c.apolices.filter((a: string) => RETIRAR[a]);
    const nota = retirar.map((a: string) => `Apólice ${a} fora do card: ${RETIRAR[a]} (conferido em 06/11/2026), ainda consta na planilha do Drive.`);
    const manter = c.apolices.filter((a: string) => !RETIRAR[a]);
    const dup = titulos.has(norm(c.titulo));
    const jaNoBitrix = manter.filter((a: string) => apolicasBitrix.has(a)).map((a: string) => `${a} -> ${apolicasBitrix.get(a)}`);
    console.log(`${dup ? "DUPLICADO " : ""}${c.titulo} | itens ${c.itens} -> ${c.itens - retirar.length}${jaNoBitrix.length ? " | JÁ EM CARD: " + jaNoBitrix.slice(0, 3).join("; ") : ""}`);
    if (dup || jaNoBitrix.length) continue;
    saida.push({
      ...c, alertas: [], apolices: manter, itens: c.itens - retirar.length,
      observacoes: c.observacoes.replace(/Quantidade de itens: \d+/, `Quantidade de itens: ${c.itens - retirar.length}`) + (nota.length ? "\n" + nota.join("\n") : ""),
    });
  }
  fs.writeFileSync(path.join(dir, "cards-2026-12.PENDENTES.json"), JSON.stringify(saida, null, 1));
  console.log(`\n${saida.length} cards prontos para criar (nada foi criado no Bitrix)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
