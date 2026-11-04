import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarItem, chamarBitrix, type BitrixItemRaw } from "@/lib/bitrix/client";

// Lista de cards da resposta do Robô O2 (pedido do Matheus, 04/11/2026). O robô só diz QUAIS cards a resposta cita
// (registrar_cards_da_resposta); os dados de cada linha vêm daqui, do banco do Workspace e do próprio card no Bitrix
// (etapa lida na hora da consulta), nunca digitados pela IA.

export type RefCard = { id: number; produto: string };

export type CardLista = {
  id: number;
  produto: string; // fianca | re | capitalizacao | automovel
  produtoRotulo: string;
  nome: string;
  papelNome: string; // inquilino (Fiança) | segurado/titular (demais)
  etapa: string; // etapa atual do card no Bitrix
  etapaAoVivo: boolean; // false = não deu para ler o Bitrix agora; vale a cópia do banco (atualizada de hora em hora)
  funil: string | null;
  seguradora: string | null;
  imobiliaria: string | null;
  endereco: string | null;
  premio: number | null;
  comissao: number | null;
  repasse: number | null;
  valores: "efetivado" | "previsto" | "sem_valor";
  url: string;
  atualizadoEm: string; // quando a lista foi montada
};

export const FERRAMENTA_CARDS: Anthropic.Tool = {
  name: "registrar_cards_da_resposta",
  description:
    "Quando a sua resposta CITAR cards/cotações específicos (listar, comparar ou detalhar cotações de uma pessoa, imobiliária, produto ou período), chame esta ferramenta UMA vez com os cards citados, para a tela oferecer a lista de cards (produto, nome, etapa atual, seguradora, imobiliária, endereço, prêmio, comissão e repasse). Use o nº do card do Bitrix (origem_bitrix_id em producao_resolvida; fonte bitrix) e o produto (fianca, re, capitalizacao, automovel). No máximo 100 cards. Não chame em resposta só com totais ou médias, nem quando não houver card identificado.",
  input_schema: {
    type: "object",
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number", description: "Nº do card no Bitrix." },
            produto: { type: "string", enum: ["fianca", "re", "capitalizacao", "automovel"] },
          },
          required: ["id", "produto"],
        },
      },
    },
    required: ["cards"],
  },
};

const ENTIDADE: Record<string, number> = { fianca: 1042, re: 1046, capitalizacao: 1048, automovel: 1050 };
const ROTULO: Record<string, string> = { fianca: "Seguro Fiança", re: "Ramos Elementares", capitalizacao: "Capitalização", automovel: "Automóvel" };
const PORTAL = "https://o2seguros.bitrix24.com.br";

export function refsDoRobo(entrada: unknown): RefCard[] {
  const bruto = (entrada as { cards?: unknown })?.cards;
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  const refs: RefCard[] = [];
  for (const c of bruto) {
    const id = Number((c as { id?: unknown })?.id);
    const produto = String((c as { produto?: unknown })?.produto ?? "");
    if (!Number.isInteger(id) || id <= 0 || !ENTIDADE[produto]) continue;
    const k = `${produto}:${id}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    refs.push({ id, produto });
    if (refs.length >= 100) break;
  }
  return refs;
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function dinheiro(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor || null;
  const bruto = texto(valor).split("|")[0].replace(/\s/g, "");
  if (!bruto) return null;
  const n = Number(bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

const etapasEmCache = new Map<string, Map<string, string>>();
async function nomeDaEtapa(entityTypeId: number, categoryId: number, stageId: string): Promise<string> {
  const chave = `${entityTypeId}:${categoryId}`;
  if (!etapasEmCache.has(chave)) {
    try {
      const r = await chamarBitrix<{ result: { STATUS_ID: string; NAME: string }[] }>("crm.status.list", { "filter[ENTITY_ID]": `DYNAMIC_${entityTypeId}_STAGE_${categoryId}` });
      etapasEmCache.set(chave, new Map((r.result ?? []).map((s) => [s.STATUS_ID, s.NAME])));
    } catch {
      etapasEmCache.set(chave, new Map());
    }
  }
  return etapasEmCache.get(chave)!.get(stageId) ?? stageId.split(":").pop() ?? stageId;
}

async function lerAoVivo(ref: RefCard): Promise<{ item: BitrixItemRaw; entityTypeId: number } | null> {
  const tentativas = ref.produto === "automovel" ? [1050, 1046] : [ENTIDADE[ref.produto]];
  for (const entityTypeId of tentativas) {
    try {
      const item = await Promise.race([buscarItem(entityTypeId, ref.id), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tempo")), 7000))]);
      if (item?.id) return { item, entityTypeId };
    } catch {
      /* tenta a próxima entidade ou cai para a cópia do banco */
    }
  }
  return null;
}

const empresasEmCache = new Map<number, string>();
async function nomeDaEmpresa(companyId: number): Promise<string | null> {
  if (empresasEmCache.has(companyId)) return empresasEmCache.get(companyId) || null;
  try {
    const r = await chamarBitrix<{ result: { TITLE?: string } }>("crm.company.get", { id: companyId });
    const t = texto(r.result?.TITLE);
    empresasEmCache.set(companyId, t);
    return t || null;
  } catch {
    return null;
  }
}

const PAPEL_NOME: Record<string, string> = { fianca: "inquilino", re: "segurado", capitalizacao: "titular", automovel: "segurado" };

export async function montarListaCards(refs: RefCard[]): Promise<CardLista[]> {
  if (!refs.length) return [];
  const sb = createServiceClient();
  const ids = refs.map((r) => String(r.id));

  // Cópia do banco (atualizada de hora em hora): seguradora, imobiliária, valores de cotações já efetivadas.
  const { data: linhas } = await sb
    .from("producao_resolvida")
    .select("origem_bitrix_id, produto, status_padrao, status_original, seguradora, imobiliaria_exibicao, imobiliaria_texto, premio, comissao, locatario_id, extras")
    .eq("fonte", "bitrix")
    .in("origem_bitrix_id", ids);
  const doBanco = new Map<string, NonNullable<typeof linhas>[number]>();
  for (const l of linhas ?? []) doBanco.set(`${l.produto}:${l.origem_bitrix_id}`, l);

  const locatarioIds = [...new Set((linhas ?? []).map((l) => l.locatario_id).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();
  if (locatarioIds.length) {
    const { data } = await sb.from("locatarios").select("id, nome").in("id", locatarioIds);
    for (const p of data ?? []) if (p.nome) nomes.set(p.id as string, p.nome as string);
  }

  const agora = new Date().toISOString();
  const lista: CardLista[] = [];
  // Etapa lida na hora (um card por vez, poucos em paralelo para não estourar o limite do Bitrix).
  for (let i = 0; i < refs.length; i += 6) {
    const lote = refs.slice(i, i + 6);
    const resultados = await Promise.all(
      lote.map(async (ref) => {
        const banco = doBanco.get(`${ref.produto}:${ref.id}`);
        const vivo = await lerAoVivo(ref);
        const item = vivo?.item;
        const extras = (banco?.extras ?? {}) as Record<string, unknown>;

        let etapa = texto(banco?.status_original) || "—";
        let funil: string | null = null;
        if (item && vivo) {
          const cat = Number(item.categoryId) || 0;
          etapa = await nomeDaEtapa(vivo.entityTypeId, cat, texto(item.stageId));
          funil = cat ? `funil ${cat}` : null;
        }

        let nome = (banco?.locatario_id ? nomes.get(banco.locatario_id as string) : "") || "";
        let seguradora = texto(banco?.seguradora) || null;
        let imobiliaria = texto(banco?.imobiliaria_exibicao) || texto(banco?.imobiliaria_texto) || null;
        let endereco: string | null = null;
        let premio: number | null = null;
        let comissao: number | null = null;
        let repasse: number | null = null;
        const efetivado = banco?.status_padrao === "Convertido";

        if (ref.produto === "re") {
          endereco = [texto(extras.endereco), texto(extras.bairro), texto(extras.cidade_endereco)].filter(Boolean).join(", ") || null;
          if (item) {
            premio = dinheiro(item["ufCrm12PremioTotal"]);
            const pc = dinheiro(item["ufCrm12_1788368973918"] ?? item["ufCrm12ComissaoPercentual"]);
            const pr = dinheiro(item["ufCrm12_1788368984463"] ?? item["ufCrm12RepassePercentual"]);
            if (premio && pc) comissao = premio * (pc / 100);
            if (premio && pr) repasse = premio * (pr / 100);
            seguradora = seguradora || texto(item["ufCrm12Seguradora"]) || null;
            nome = nome || texto(item["ufCrm12Segurado"]) || "";
          }
          premio = premio ?? (banco?.premio as number | null) ?? null;
          comissao = comissao ?? (banco?.comissao as number | null) ?? null;
        } else if (ref.produto === "capitalizacao") {
          if (item) {
            premio = dinheiro(item["ufCrm14CapValorTit"]);
            comissao = dinheiro(item["ufCrm14CapComissao"]);
            nome = nome || texto(item["ufCrm14CapLocatPfNome"]) || texto(item["ufCrm14CapLocatPjRazao"]);
            imobiliaria = texto(item["ufCrm14CapImobAdmin"]) || imobiliaria;
            seguradora = texto(item["ufCrm14CapSeguradora"]) || seguradora;
            endereco = texto(item["ufCrm14CapImovelCep"]) ? [texto((item["ufCrm14CapImovelEnd"] as string | undefined)?.toString?.().split("|")[0]), texto(item["ufCrm14CapImovelBairro"]), texto(item["ufCrm14CapImovelCidade"])].filter(Boolean).join(", ") || null : null;
          }
          premio = premio ?? (banco?.premio as number | null) ?? null;
          comissao = comissao ?? (banco?.comissao as number | null) ?? null;
        } else if (ref.produto === "automovel") {
          if (item) {
            nome = nome || texto(item["ufCrm16_1787056933080"]);
            endereco = texto(item["ufCrm16_1787057323033"]) || null;
            premio = dinheiro(item["ufCrm16_1787061422"]);
            comissao = dinheiro(item["ufCrm16_1787061468"]);
          }
          premio = premio ?? (banco?.premio as number | null) ?? null;
          comissao = comissao ?? (banco?.comissao as number | null) ?? null;
        } else {
          // Fiança: valores só existem no banco para cotações já efetivadas.
          premio = (banco?.premio as number | null) ?? null;
          comissao = (banco?.comissao as number | null) ?? null;
        }

        // Imobiliária sem ficha ligada (só o código da empresa): usa o nome da empresa do card no Bitrix.
        if ((!imobiliaria || /^d+$/.test(imobiliaria)) && item && Number(item.companyId) > 0) imobiliaria = (await nomeDaEmpresa(Number(item.companyId))) || imobiliaria;
        if (imobiliaria && /^d+$/.test(imobiliaria)) imobiliaria = null;
        if (!nome && item) nome = texto(item.title);
        const temValor = premio !== null || comissao !== null;
        const c: CardLista = {
          id: ref.id,
          produto: ref.produto,
          produtoRotulo: ROTULO[ref.produto] ?? ref.produto,
          nome: nome || "—",
          papelNome: PAPEL_NOME[ref.produto] ?? "segurado",
          etapa,
          etapaAoVivo: !!item,
          funil,
          seguradora,
          imobiliaria,
          endereco,
          premio,
          comissao,
          repasse,
          valores: !temValor ? "sem_valor" : efetivado ? "efetivado" : "previsto",
          url: `${PORTAL}/crm/type/${vivo?.entityTypeId ?? ENTIDADE[ref.produto]}/details/${ref.id}/`,
          atualizadoEm: agora,
        };
        return c;
      })
    );
    lista.push(...resultados);
  }
  return lista;
}
