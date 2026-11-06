// Confere, no Bitrix (só leitura), se as apólices "sem card" de novembro aparecem em algum card de renovação (nº da apólice, título, imobiliária).
process.loadEnvFile(".env.local");
import fs from "node:fs";
import { lerCardsRenovacao, urlCard } from "@/lib/erp/renovacaoCards";

const csv = fs.readFileSync("../renovacoes-re/URGENTES-NOVEMBRO-2026-sem-card.csv", "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(";"));
const norm = (s: string) => (s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
async function main() {
  const cards = await lerCardsRenovacao();
  console.log("cards de renovação lidos:", cards.length);
  for (const [prod, , cod, num, seg, cliente, imob] of csv) {
    const n = num.replace(/^0+/, "");
    const achados = cards.filter((c) => {
      const txt = norm(JSON.stringify(c.bruto ?? {})) + " " + norm(c.titulo ?? "");
      return txt.includes(n) || (cliente && txt.includes(norm(cliente).slice(0, 18)));
    });
    const porImob = imob ? cards.filter((c) => norm(c.titulo ?? "").includes(norm(imob).split(" ")[0]) && /11\.2026|NOV/.test(norm(c.titulo ?? ""))) : [];
    console.log(`\n${cod} ${prod} ${num} ${seg} | ${cliente} | ${imob}`);
    for (const c of achados.slice(0, 3)) console.log("  por nº/cliente:", urlCard(c.entity, c.id), c.etapa, "|", c.titulo);
    for (const c of porImob.slice(0, 3)) console.log("  por imob+nov:", urlCard(c.entity, c.id), c.etapa, "|", c.titulo);
    if (!achados.length && !porImob.length) console.log("  nenhum card encontrado");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
