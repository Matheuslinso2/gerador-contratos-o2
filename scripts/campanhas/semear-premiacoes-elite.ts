// Premiações personalizadas iniciais da Campanha Elite (pedido do Matheus, 04/11/2026): Adjuve, Chez, Expan e
// Silvério. Grava só o bloco de premiação na linha de meta de cada participante (campanhas_metas); o resto do
// e-mail continua o do modelo. Não envia nada. Pode rodar de novo (substitui o texto desses quatro).
//   NODE_PATH="$TEMP/stub" npx tsx scripts/campanhas/semear-premiacoes-elite.ts
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { linhasDoEmail } from "../../src/lib/campanhas/parcialCampanha";
import { salvarPremiacaoPersonalizada } from "../../src/lib/campanhas/premiacaoPersonalizada";

const CAMPANHA_ELITE = "5bdf0eb9-9fa1-4ef3-a4be-2f5db6854d32";

const BONUS_EXTRA = "🎁 <b>Bônus extra:</b> <b>R$ 300,00 em voucher</b> para títulos e fianças com prêmio acima de R$ 100 mil, além da premiação alcançada.";

// id da linha de meta do participante na campanha -> blocos (uma linha do e-mail cada)
const PREMIACOES: { metaId: string; nome: string; linhas: string[] }[] = [
  {
    metaId: "f869b3af-363c-4514-b0ed-ffb34ef51493", // ADJUVE (grupo)
    nome: "ADJUVE",
    linhas: [
      "🏆 <b>Meta 1 — 47 novos contratos:</b> Troféu Destaque 2026 + <b>R$ 50,00 por apólice para cada gerente elegível</b>.",
      "🏆 <b>Meta 2 — 51 novos contratos:</b> Troféu Destaque 2026 + <b>R$ 65,00 por apólice para cada gerente elegível</b>.",
      "💳 <b>Incentivo aos corretores:</b> durante a campanha, pagamento em dobro pelo cartão Alelo, totalizando <b>R$ 100,00 por contratação</b>, pagos diretamente aos corretores responsáveis.",
      BONUS_EXTRA,
      "<i>As premiações das metas 1 e 2 não são cumulativas. Cada gerente será premiado conforme a contribuição de sua equipe para o alcance do resultado, de acordo com as regras da campanha.</i>",
    ],
  },
  {
    metaId: "0b85a045-9507-4958-b8af-a6f9a485d5e6", // Expan Imóveis
    nome: "Expan Imóveis",
    linhas: [
      "🏆 <b>Meta 1 — 21 novos contratos:</b> Troféu Destaque 2026 + <b>R$ 500,00 em dinheiro para a equipe Expan</b>.",
      "🏆 <b>Meta 2 — 25 novos contratos:</b> Troféu Destaque 2026 + <b>R$ 800,00 em dinheiro para a equipe Expan</b>.",
      BONUS_EXTRA,
    ],
  },
  {
    metaId: "2d91c689-6917-4232-89a2-9f1d8189f5eb", // Chez Brasil Imobiliaria
    nome: "Chez Brasil Imobiliaria",
    linhas: [
      "🏆 <b>Meta 1 — 6 novos contratos:</b> Kit O2 para o corretor com melhor desempenho, com opções como kit churrasco ou bolsa térmica/copo térmico.",
      "💰 <b>Meta 2 — 10 novos contratos:</b> <b>R$ 300,00 de bônus</b>.",
      "💰 <b>Meta 3 — 12 novos contratos:</b> <b>R$ 500,00 de bônus</b>.",
      "<i>Os bônus das metas 2 e 3 poderão ser destinados ao corretor com melhor desempenho ou distribuídos conforme definição da Chez Brasil.</i>",
    ],
  },
  {
    metaId: "74ce901a-acf0-4e9b-a9e4-52f43068f53a", // Silverio Imoveis
    nome: "Silverio Imoveis",
    linhas: [
      "💰 <b>Bônus por contratação, conforme as condições de liberação da campanha:</b>",
      "• <b>Seguro Fiança Pottencial:</b> R$ 50,00 para o corretor + R$ 50,00 para o gerente.",
      "• <b>Seguro Fiança Porto, Tokio ou Too:</b> R$ 25,00 para o corretor + R$ 25,00 para o gerente.",
      "• <b>Título de Capitalização:</b> R$ 25,00 para o corretor + R$ 25,00 para o gerente.",
    ],
  },
];

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  for (const p of PREMIACOES) {
    const r = await salvarPremiacaoPersonalizada(db, CAMPANHA_ELITE, p.metaId, linhasDoEmail(p.linhas));
    console.log(`${p.nome}: ${r.ok ? "premiação personalizada gravada" : "FALHOU — " + r.erro}`);
    if (!r.ok) process.exitCode = 1;
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
