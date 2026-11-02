// Imagem de uma tela do Corp: do disco (telas/<nn>/<tela>.webp, enquanto não foi liberada) ou do bucket privado corp-telas (cópia em telas-cache/ para não baixar de novo).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

export const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const CACHE = path.join(PASTA, "telas-cache");
let sb: ReturnType<typeof createServiceClient> | null = null;

export async function imagemDaTela(nn: string | number, tela: string): Promise<Buffer | null> {
  const local = path.join(PASTA, "telas", String(nn), `${tela}.webp`);
  if (fs.existsSync(local)) return fs.readFileSync(local);
  const cache = path.join(CACHE, String(nn), `${tela}.webp`);
  if (fs.existsSync(cache)) return fs.readFileSync(cache);
  sb ??= createServiceClient();
  const { data, error } = await sb.storage.from("corp-telas").download(`${nn}/${tela}.webp`);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, buf);
  return buf;
}
