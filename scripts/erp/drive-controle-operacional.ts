// Exploração (SÓ LEITURA) da pasta CONTROLE OPERACIONAL do Drive: estrutura, nº de arquivos por pasta, tipos e amostra de nomes.
process.loadEnvFile(".env.local");
import { createRequire } from "node:module";
const require = createRequire(import.meta.url); const { cliente } = require("../base-unica/_google.cjs");
const RAIZES: [string, string][] = [["DOCS EMISSÃO", "1XiNg9n3QefGTLlNiaOFTkCXFPBJ7zG6m"], ["ENVIO EMISSÃO", "1hRCgUfoODFJLuXZ9Cz6HeGV-OB1U7XFQ"], ["CONTROLE BCE", "1JVEOMVtcJ8RqRRv3fIx6iGb3ylu08Fc-"], ["CONTROLE PENDÊNCIAS", "15uKuir9BQe-tldVU9F1OeUk7ld4V491u"]];
(async () => {
  const { drive } = cliente("GERAL");
  async function filhos(id: string) { const o: any[] = []; let t: string | undefined; do { const r = await drive.files.list({ q: `'${id}' in parents and trashed=false`, fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)", pageSize: 1000, pageToken: t, supportsAllDrives: true, includeItemsFromAllDrives: true }); o.push(...(r.data.files ?? [])); t = r.data.nextPageToken ?? undefined; } while (t); return o; }
  async function arvore(id: string, nome: string, prof: number, max: number, lim: { n: number }) {
    const f = await filhos(id); const pastas = f.filter((x) => x.mimeType === "application/vnd.google-apps.folder"); const arqs = f.filter((x) => x.mimeType !== "application/vnd.google-apps.folder");
    const tipos: Record<string, number> = {}; for (const a of arqs) { const e = (a.name.match(/\.(\w{2,4})$/)?.[1] ?? a.mimeType.split(".").pop()!).toLowerCase(); tipos[e] = (tipos[e] ?? 0) + 1; }
    const datas = arqs.map((a) => String(a.modifiedTime).slice(0, 10)).sort();
    console.log(`${"  ".repeat(prof)}${nome} | pastas ${pastas.length} | arquivos ${arqs.length} ${JSON.stringify(tipos)}${datas.length ? ` | ${datas[0]}→${datas[datas.length - 1]}` : ""}${arqs.length ? ` | ex.: ${arqs.slice(0, 3).map((a) => a.name.slice(0, 40)).join(" ; ")}` : ""}`);
    if (prof < max) for (const p of pastas.slice(0, 40)) { if (lim.n++ > 400) return; await arvore(p.id, p.name, prof + 1, max, lim); }
  }
  for (const [nome, id] of RAIZES) { console.log(`\n=== ${nome}`); await arvore(id, nome, 0, 2, { n: 0 }); }
})();
