// Lê (SÓ LEITURA) os PDFs de apólice Porto baixados em %TEMP%\porto\cap e extrai nº da apólice, vigência, emissão, segurado, CPF/CNPJ e prêmio.
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
const ALVOS = ["4107594","4110311","4115266","4291951","4292712","4315346","10894893","10985231","10982887","11010495","10817997"];
(async () => {
  const d = path.join(os.tmpdir(), "porto", "cap"); const linhas: string[] = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".pdf"))) {
    const { t } = await textoDoPdf(fs.readFileSync(path.join(d, f)), []); if (!t) { linhas.push(`${f} SEM TEXTO`); continue; }
    const s = t.replace(/\s+/g, " ");
    const num = /N[úu]mero da Ap[óo]lice:\s*(?:\D*?)(\d{2,4}) (\d{2}) (\d{3,8})/i.exec(s) ?? /(\d{3}) (86) (\d{6,8})/.exec(s);
    const vig = /a partir das 24h do dia (\d{2}\/\d{2}\/\d{4}) at[ée] as 24h do dia (\d{2}\/\d{2}\/\d{4})/i.exec(s);
    const prem = /Pr[êe]mio total[^R]*R\$\s*([\d.,]+)/i.exec(s) ?? /TOTAL PR[ÊE]MIO COBERTURAS R\$\s*([\d.,]+)/i.exec(s);
    const seg = /Segurado:.*?(?:CPF\/CNPJ:)\s*([\d./-]+)/i.exec(s); const nome = /DADOS CADASTRAIS Segurado:.*?Estado Cidade:\s*(.+?)\s+(?:COBRANCA|[A-Z]+@)/i.exec(s);
    const susep = /\b(G0852J|LI7PMJ)\b/.exec(s);
    linhas.push([f.slice(0, 40), num ? `${num[1]}-${num[2]}-${num[3]}` : "?", vig ? `${vig[1]}→${vig[2]}` : "?", prem ? prem[1] : "?", seg ? seg[1] : "?", susep ? susep[1] : "?"].join(" | "));
  }
  console.log(linhas.join("\n")); console.log("alvos:", ALVOS.join(","));
})();
