// Liga à campanha os cards que JÁ existem no funil Campanhas do Bitrix (só lê o
// Bitrix; não cria nem altera cards). Por padrão só mostra o que faria.
//   NODE_PATH="$TEMP/stub" npx tsx scripts/campanhas/vincular-cards-existentes.ts <campanha_id>            (simulação)
//   NODE_PATH="$TEMP/stub" npx tsx scripts/campanhas/vincular-cards-existentes.ts <campanha_id> --gravar    (grava a ligação)
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { vincularCardsExistentes } from "../../src/lib/campanhas/cardsBitrix";

async function main() {
  const id = process.argv[2];
  const gravar = process.argv.includes("--gravar");
  if (!id) throw new Error("Informe o id da campanha.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: campanha } = await db.from("campanhas").select("id, nome, valido_de, valido_ate, imobiliarias_selecionadas, criado_por_email").eq("id", id).single();
  if (!campanha) throw new Error("Campanha não encontrada.");
  const r = await vincularCardsExistentes(db, campanha, "matheus@o2seguros.com.br", gravar);
  console.log(`Campanha: ${campanha.nome}  (${gravar ? "GRAVADO" : "simulação"})`);
  console.log("A vincular agora:", r.vinculados, "| já vinculados:", r.jaVinculados, "| participantes sem card no Bitrix:", r.semCardNoBitrix);
  console.log("Cards do funil sem empresa vinculada à base única:", r.semEmpresaVinculada.length);
  for (const c of r.semEmpresaVinculada) console.log("   #" + c.cardId, JSON.stringify(c.titulo), "empresa", c.empresaId);
  console.log("Cards de imobiliárias que não estão nesta campanha:", r.foraDaCampanha.length);
  for (const c of r.foraDaCampanha) console.log("   #" + c.cardId, JSON.stringify(c.titulo), "→", c.imobiliaria);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
