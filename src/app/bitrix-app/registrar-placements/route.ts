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
// ?aba=apolice-mae (28/10/2026): registra a aba "Apólice-mãe" nas SPAs que
// têm funil de endosso (Fiança, Ramos, Capitalização) em vez do E-mail.
// ?aba=campanha (30/10/2026): aba "Panorama da campanha" só nos Negócios (o handler
// avisa quando o card não está ligado a uma campanha do Workspace).
type AbaConfig = { handler: string; titulo: string; entidades: number[] | null; placements?: string[] };
const ABAS: Record<string, AbaConfig> = {
  email: { handler: "https://contratos.o2seguros.com.br/bitrix-app/card-email", titulo: "E-mail", entidades: null },
  "apolice-mae": { handler: "https://contratos.o2seguros.com.br/bitrix-app/card-apolice-mae", titulo: "Apólice-mãe", entidades: [1042, 1046, 1048] },
  campanha: { handler: "https://contratos.o2seguros.com.br/bitrix-app/card-campanha", titulo: "Panorama da campanha", entidades: null, placements: ["CRM_DEAL_DETAIL_TAB"] },
};

const ALVOS = [
  { rotulo: "Lead", padrao: "CRM_LEAD_DETAIL_TAB" },
  { rotulo: "Negócios (Deal)", padrao: "CRM_DEAL_DETAIL_TAB" },
  { rotulo: "SPA Seguro Fiança (1042)", padrao: "CRM_DYNAMIC_1042_DETAIL_TAB" },
  { rotulo: "SPA Ramos Elementares/Incêndio (1046)", padrao: "CRM_DYNAMIC_1046_DETAIL_TAB" },
  { rotulo: "SPA Capitalização (1048)", padrao: "CRM_DYNAMIC_1048_DETAIL_TAB" },
  { rotulo: "SPA Seguro Automóvel (1050)", padrao: "CRM_DYNAMIC_1050_DETAIL_TAB" },
];

type PlacementListResposta = { result: string[] };
type PlacementBindResposta = { result: boolean };

export async function GET(request: NextRequest) {
  const executar = request.nextUrl.searchParams.get("executar") === "1";
  const aba = ABAS[request.nextUrl.searchParams.get("aba") ?? "email"] ?? ABAS.email;
  const HANDLER = aba.handler;
  const TITLE = aba.titulo;
  const alvos = aba.placements
    ? ALVOS.filter((a) => aba.placements!.includes(a.padrao))
    : aba.entidades
      ? ALVOS.filter((a) => aba.entidades!.some((e) => a.padrao.includes(`_${e}_`)))
      : ALVOS;

  const listaBruta = await chamarBitrixComoApp<PlacementListResposta>("placement.list");
  const disponiveis = listaBruta.result ?? [];

  const encontrados: { rotulo: string; placement: string }[] = [];
  const naoEncontrados: string[] = [];

  for (const alvo of alvos) {
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
