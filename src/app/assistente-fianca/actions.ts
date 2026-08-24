"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { analisarPanoramaFianca, type AnaliseFianca, type FonteEntrada } from "@/lib/assistenteFianca";

const EXTENSOES_IMAGEM: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function analisar(formData: FormData): Promise<AnaliseFianca> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || (!isAdmin(user.email) && !isColaboradorO2(user.email))) {
    throw new Error("Sem permissão para usar o assistente de vendas.");
  }

  const texto = String(formData.get("panorama") ?? "").trim();
  const arquivo = formData.get("imagem") as File | null;

  let entrada: FonteEntrada;
  if (arquivo && arquivo.size > 0) {
    const nomeLower = arquivo.name.toLowerCase();
    const extensao = Object.keys(EXTENSOES_IMAGEM).find((ext) => nomeLower.endsWith(ext));
    if (!extensao) {
      throw new Error("A imagem precisa ser .png, .jpg, .jpeg, .gif ou .webp.");
    }
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    entrada = { tipo: "imagem", base64: buffer.toString("base64"), mediaType: EXTENSOES_IMAGEM[extensao] };
  } else if (texto) {
    entrada = { tipo: "texto", texto };
  } else {
    throw new Error("Cole o panorama do caso ou anexe um print das cotações.");
  }

  return analisarPanoramaFianca(entrada);
}
