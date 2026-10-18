// Base Única — congela a "impressão digital" de todas as planilhas de
// controle do Drive como estão AGORA (decisão do Matheus, 2026-10-18).
//
//   node scripts/base-unica/congelar-planilhas.mjs            -> registra o que ainda não foi congelado
//   node scripts/base-unica/congelar-planilhas.mjs verificar  -> compara com o Drive e marca o que mudou depois
//
// Nunca sobrescreve um congelamento já feito: o registro original é a referência.
import { createRequire } from "node:module";
import { supabase, buscarTudo } from "./_comum.mjs";

const require = createRequire(import.meta.url);
const { cliente } = require("./_google.cjs");

async function listarDrive() {
  const vistos = new Map();
  for (const conta of ["RE", "GERAL"]) {
    const c = cliente(conta);
    const todos = [];
    let pt;
    do {
      const r = await c.drive.files.list({
        q: "trashed=false", pageSize: 1000, pageToken: pt, supportsAllDrives: true, includeItemsFromAllDrives: true,
        fields: "nextPageToken,files(id,name,mimeType,parents,modifiedTime,headRevisionId,md5Checksum,size)",
      });
      todos.push(...r.data.files);
      pt = r.data.nextPageToken;
    } while (pt);
    const pastas = Object.fromEntries(todos.filter((f) => f.mimeType.endsWith("folder")).map((f) => [f.id, f.name]));
    for (const f of todos) {
      const planilha = f.mimeType === "application/vnd.google-apps.spreadsheet" || /spreadsheetml|ms-excel/.test(f.mimeType);
      if (!planilha || vistos.has(f.id)) continue;
      vistos.set(f.id, { ...f, pasta: (f.parents || []).map((p) => pastas[p] || p).join(",") });
    }
  }
  return [...vistos.values()];
}

const modo = process.argv[2] || "congelar";
const drive = await listarDrive();
const ja = new Map((await buscarTudo("base_unica_planilhas_congeladas", "*")).map((r) => [r.arquivo_id, r]));

if (modo === "copiar") {
  // Guarda a cópia física no bucket privado `planilhas-congeladas`. Excel:
  // o arquivo como está (confere o md5 com o congelado — se mudou entre o
  // congelamento e a cópia, não copia e avisa). Google Sheets: exporta em
  // .xlsx, só se a data de alteração ainda é a do congelamento.
  const crypto = await import("node:crypto");
  const contas = { RE: cliente("RE"), GERAL: cliente("GERAL") };
  let ok = 0, pulado = 0, divergente = 0, erro = 0;
  for (const f of drive) {
    const r = ja.get(f.id);
    if (!r || r.copia_storage_path) { pulado++; continue; }
    const ehGoogle = f.mimeType === "application/vnd.google-apps.spreadsheet";
    if (ehGoogle && new Date(f.modifiedTime).getTime() !== new Date(r.modificado_em).getTime()) { divergente++; console.log("mudou antes da cópia:", f.name); continue; }
    let buf = null;
    for (const c of [contas.GERAL, contas.RE]) {
      try {
        const resp = ehGoogle
          ? await c.drive.files.export({ fileId: f.id, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { responseType: "arraybuffer", timeout: 180000 })
          : await c.drive.files.get({ fileId: f.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer", timeout: 180000 });
        buf = Buffer.from(resp.data);
        break;
      } catch { /* tenta a outra conta */ }
    }
    if (!buf) { erro++; console.log("erro ao baixar:", f.name); continue; }
    const md5 = crypto.createHash("md5").update(buf).digest("hex");
    if (!ehGoogle && r.md5 && md5 !== r.md5) { divergente++; console.log("md5 diferente do congelado:", f.name); continue; }
    const nomeArq = f.name.replace(/[^\w.\- ]+/g, "_") + (ehGoogle ? ".xlsx" : "");
    const caminho = `${f.id}/${nomeArq}`;
    const tipo = ehGoogle || /\.xlsx$/i.test(f.name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : f.mimeType;
    const { error } = await supabase.storage.from("planilhas-congeladas").upload(caminho, buf, { contentType: tipo, upsert: false });
    if (error) { erro++; console.log("erro ao gravar:", f.name, error.message); continue; }
    await supabase.from("base_unica_planilhas_congeladas").update({
      copia_storage_path: caminho, copia_tamanho_bytes: buf.length, copia_md5: md5, copiado_em: new Date().toISOString(),
    }).eq("arquivo_id", f.id);
    ok++;
    if (ok % 20 === 0) console.log(`... ${ok} copiadas`);
  }
  console.log({ copiadas: ok, jaCopiadasOuForaDoRegistro: pulado, mudaramAntesDaCopia: divergente, erro });
} else if (modo === "congelar") {
  const novos = drive.filter((f) => !ja.has(f.id)).map((f) => ({
    arquivo_id: f.id, nome: f.name, pasta: f.pasta, mime_type: f.mimeType, modificado_em: f.modifiedTime,
    revisao_id: f.headRevisionId ?? null, md5: f.md5Checksum ?? null, tamanho_bytes: f.size ? Number(f.size) : null,
  }));
  for (let i = 0; i < novos.length; i += 200) {
    const { error } = await supabase.from("base_unica_planilhas_congeladas").insert(novos.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  console.log(`congeladas agora: ${novos.length} | já congeladas antes: ${ja.size} | total no Drive: ${drive.length}`);
} else {
  const agora = new Date().toISOString();
  let mudaram = 0;
  for (const f of drive) {
    const r = ja.get(f.id);
    if (!r) continue;
    const mudou = (r.md5 && f.md5Checksum && r.md5 !== f.md5Checksum) || (r.revisao_id && f.headRevisionId && r.revisao_id !== f.headRevisionId)
      || (!r.md5 && !r.revisao_id && new Date(f.modifiedTime).getTime() !== new Date(r.modificado_em).getTime());
    const upd = { verificado_em: agora, ...(mudou && !r.alterado_depois ? { alterado_depois: true, alterado_em: f.modifiedTime } : {}) };
    if (mudou) mudaram++;
    await supabase.from("base_unica_planilhas_congeladas").update(upd).eq("arquivo_id", f.id);
  }
  console.log(`verificadas: ${ja.size} | alteradas depois do congelamento: ${mudaram}`);
}
