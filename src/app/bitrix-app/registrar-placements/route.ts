import { NextRequest, NextResponse } from "next/server";
import { chamarBitrixComoApp } from "@/lib/bitrix/appAuth";

export const dynamic = "force-dynamic";

// Rotina de configuração pontual: registra o placement "E-mail no card"
// (Fase 0/1, ver C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md)
// nas 5 entidades que ainda faltam (Lead + 4 SPAs) -- só Negócios (Deal)
// foi registrado até agora, manualmente pelo Codex.
//
// Por padrão só CONSULTA (placement.list) e mostra quais nomes de
// placement esse portal realmente tem disponíveis pras entidades alvo --
// nunca assumir o nome "CRM_DYNAMIC_<id>_DETAIL_TAB" sem confirmar, já
// que pode variar entre portais/versões do Bitrix. Só registra de verdade
// (placement.bind) quando chamado com ?executar=1, e só pros placements
// que realmente apareceram na lista.
const HANDLER = "https://contratos.o2seguros.com.br/bitrix-app/card-email";
const TITLE = "E-mail";

const ALVOS = [
  { rotulo: "Lead", padrao: "CRM_LEAD_DETAIL_TAB" },
  { rotulo: "SPA Seguro Fiança (1042)", padrao: "CRM_DYNAMIC_1042_DETAIL_TAB" },
  { rotulo: "SPA Ramos Elementares/Incêndio (1046)", padrao: "CRM_DYNAMIC_1046_DETAIL_TAB" },
  { rotulo: "SPA Capitalização (1048)", padrao: "CRM_DYNAMIC_1048_DETAIL_TAB" },
  { rotulo: "SPA Seguro Automóvel (1050)", padrao: "CRM_DYNAMIC_1050_DETAIL_TAB" },
];

type PlacementListResposta = { result: string[] };
type PlacementBindResposta = { result: boolean };

export async function GET(request: NextRequest) {
  const executar = request.nextUrl.searchParams.get("executar") === "1";

  const listaBruta = await chamarBitrixComoApp<PlacementListResposta>("placement.list");
  const disponiveis = listaBruta.result ?? [];

  const encontrados: { rotulo: string; placement: string }[] = [];
  const naoEncontrados: string[] = [];

  for (const alvo of ALVOS) {
    if (disponiveis.includes(alvo.padrao)) {
      encontrados.push({ rotulo: alvo.rotulo, placement: alvo.padrao });
    } else {
      naoEncontrados.push(alvo.rotulo);
    }
  }

  if (!executar) {
    return NextResponse.json({
      modo: "consulta (adicione ?executar=1 pra registrar de verdade)",
      encontrados,
      naoEncontrados,
      totalDisponiveisNoPortal: disponiveis.length,
    });
  }

  const resultados: { placement: string; ok: boolean; erro?: string }[] = [];
  for (const item of encontrados) {
    try {
      const resposta = await chamarBitrixComoApp<PlacementBindResposta>("placement.bind", {
        PLACEMENT: item.placement,
        HANDLER,
        TITLE,
      });
      resultados.push({ placement: item.placement, ok: Boolean(resposta.result) });
    } catch (erro) {
      resultados.push({ placement: item.placement, ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
    }
  }

  return NextResponse.json({ modo: "execução", resultados, naoEncontrados });
}
