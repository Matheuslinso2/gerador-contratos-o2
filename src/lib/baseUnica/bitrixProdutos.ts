import type { SupabaseClient } from "@supabase/supabase-js";
import { listarHistoricoEtapas, listarItensSpa, buscarDefinicaoCampos } from "@/lib/bitrix/client";
import { ENTITY_TYPE_ID as SPA_CAP, mapearCard as mapearCardCap, pagamentoPorCard } from "@/lib/capitalizacao/painel";
import { ENTITY_TYPE_ID as SPA_AUTO, mapearCard as mapearCardAuto } from "@/lib/seguroAuto/painel";
import { listarNovosRamosElementares } from "@/lib/ramos-elementares/fonteBitrix";

// Base Única — cotações de Capitalização, Automóvel e Ramos Elementares do
// Bitrix na linha do tempo única (producao_unificada, fonte='bitrix'), como já
// é feito com a Fiança (bitrixFianca.ts). Pedido do Matheus (21/10/2026): o
// painel "Power BI - O2 Seguros" com as cotações de todos os produtos, cada uma
// com a MESMA regra do painel do produto — por isso as leituras abaixo usam as
// funções dos próprios painéis:
//  - Capitalização (SPA 1048): entrada = mês de criação do card; efetivado =
//    mês em que o pagamento entrou (cartão/boleto, ou Emitido); perdido = mês
//    em que chegou em Pagamento não realizado/Desistência.
//  - Automóvel (SPA 1050): entrada = criação; convertido/perdido = mês em que
//    chegou em Finalizado/Perda. Sem imobiliária (decisão de 16/10/2026).
//  - Ramos Elementares (SPA 1046, negócio novo): entrada = competência
//    operacional do card (ou criação); efetivado/não efetivado = mês do desfecho.
// 1 card = 1 linha; as datas dos eventos ficam em extras (data_conversao,
// data_perda), lidas pelo resumo producao_painel_mensal.

export type ProdutoBitrix = "capitalizacao" | "automovel" | "re";
type Linha = {
  produto: string;
  origem_bitrix_id: string;
  competencia_arquivo: string;
  data_recebimento: string | null;
  status_original: string;
  status_padrao: string;
  seguradora: string | null;
  imobiliaria_texto: string | null;
  fonte_vinculo: string | null;
  ramo_original: string | null;
  premio: number | null;
  comissao: number | null;
  extras: Record<string, unknown>;
};

const ARQUIVOS: Record<ProdutoBitrix, { arquivo: string; nome: string }> = {
  capitalizacao: { arquivo: "bitrix:spa-1048", nome: "Bitrix — SPA Título de Capitalização" },
  automovel: { arquivo: "bitrix:spa-1050", nome: "Bitrix — SPA Seguro Automóvel" },
  re: { arquivo: "bitrix:spa-1046", nome: "Bitrix — SPA Ramos Elementares (negócio novo)" },
};
const INICIO_BITRIX_RE = "2026-09";
const mesBrasilia = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
const diaBrasilia = (d: Date | null) => (d ? d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : null);
const valor = (v: number) => (Number.isFinite(v) && v !== 0 ? v : null);

async function lerCapitalizacao(): Promise<Linha[]> {
  const [itensSpa, historicoSpa] = await Promise.all([listarItensSpa(SPA_CAP), listarHistoricoEtapas(SPA_CAP)]);
  // Só o funil Títulos novos (28): Reaplicações (38) e Endossos (40) não são cotação nova.
  const itens = itensSpa.filter((item) => Number(item.categoryId) === 28);
  const idsTitulosNovos = new Set(itens.map((item) => Number(item.id)));
  const historico = historicoSpa.filter((evento) => idsTitulosNovos.has(Number(evento.OWNER_ID)));
  const pagoEm = pagamentoPorCard(historico);
  const agora = new Date();
  const linhas: Linha[] = [];
  for (const item of itens) {
    const c = mapearCardCap(item, agora, pagoEm);
    if (!c) continue;
    // Mesma regra do painel: efetivado assim que o pagamento entra (ou Emitido).
    const efetivado = c.etapaId === "DT1048_28:SUCCESS" || c.etapaId === "DT1048_28:CLIENT" || c.etapaId === "DT1048_28:BOLETO_PAGO";
    const perdido = c.semantica === "F";
    const imob = c.imobiliaria && c.imobiliaria !== "—" ? c.imobiliaria : null;
    linhas.push({
      produto: "capitalizacao",
      origem_bitrix_id: String(c.id),
      competencia_arquivo: mesBrasilia(c.criadoEm),
      data_recebimento: diaBrasilia(c.criadoEm),
      status_original: c.etapaNome,
      status_padrao: efetivado ? "Convertido" : perdido ? "Perdido" : "Em análise",
      seguradora: null,
      imobiliaria_texto: imob,
      fonte_vinculo: imob ? "bitrix_cap_texto" : null,
      ramo_original: null,
      premio: efetivado ? valor(c.valorTitulo) : null,
      comissao: efetivado ? valor(c.comissao) : null,
      extras: {
        data_conversao: efetivado ? diaBrasilia(c.concluidoEm) : null,
        data_perda: perdido ? diaBrasilia(c.concluidoEm) : null,
        valor_titulo: valor(c.valorTitulo),
      },
    });
  }
  return linhas;
}

async function lerAutomovel(): Promise<Linha[]> {
  const [itens, defs] = await Promise.all([listarItensSpa(SPA_AUTO), buscarDefinicaoCampos(SPA_AUTO)]);
  const agora = new Date();
  const linhas: Linha[] = [];
  for (const item of itens) {
    const c = mapearCardAuto(item, defs, agora);
    if (!c) continue;
    const convertido = c.etapaId === "DT1050_30:SUCCESS";
    const perdido = c.semantica === "F";
    linhas.push({
      produto: "automovel",
      origem_bitrix_id: String(c.id),
      competencia_arquivo: mesBrasilia(c.criadoEm),
      data_recebimento: diaBrasilia(c.criadoEm),
      status_original: c.etapaNome,
      status_padrao: convertido ? "Convertido" : perdido ? "Perdido" : "Em análise",
      seguradora: null,
      imobiliaria_texto: null,
      fonte_vinculo: null,
      ramo_original: null,
      premio: convertido ? valor(c.premioEfetivado) : null,
      comissao: convertido ? valor(c.comissaoGerada) : null,
      extras: {
        data_conversao: convertido ? diaBrasilia(c.concluidoEm) : null,
        data_perda: perdido ? diaBrasilia(c.concluidoEm) : null,
      },
    });
  }
  return linhas;
}

async function lerRamosElementares(): Promise<{ linhas: Linha[]; empresas: Map<string, string | null> }> {
  const cards = await listarNovosRamosElementares();
  const empresas = new Map<string, string | null>();
  const linhas = cards.map((c): Linha => {
    // Automóvel/moto lançado na SPA de RE conta como Automóvel (mesma regra da
    // tradução de ramos validada pelo Matheus em 18/10/2026).
    const produto = /AUTO|MOTO|TRICICLO/i.test(c.produto) ? "automovel" : "re";
    if (c.companyId) empresas.set(String(c.companyId), c.empresa);
    // Antes de set/2026 o painel de RE lia os negócios novos da planilha (ver
    // COMPETENCIA_INICIO_HIBRIDO em app/ramos-elementares/page.tsx): card com
    // competência anterior não conta entrada aqui (a planilha já conta) e
    // desfecho antes de set/2026 também fica com a planilha.
    const antesDoBitrix = c.competencia < INICIO_BITRIX_RE;
    const desfechoValido = !!c.dataDesfecho && c.dataDesfecho.slice(0, 7) >= INICIO_BITRIX_RE;
    const convertido = c.desfecho === "EFETIVADO" && desfechoValido;
    const perdido = c.desfecho === "NÃO EFETIVADO" && desfechoValido;
    return {
      produto,
      origem_bitrix_id: String(c.id),
      competencia_arquivo: c.competencia,
      data_recebimento: c.criadoEm,
      status_original: c.status,
      status_padrao: c.desfecho === "EFETIVADO" ? "Convertido" : c.desfecho === "NÃO EFETIVADO" ? "Perdido" : "Em análise",
      seguradora: c.seguradora || null,
      imobiliaria_texto: produto === "re" && c.companyId ? String(c.companyId) : null,
      fonte_vinculo: produto === "re" && c.companyId ? "bitrix_empresa" : null,
      ramo_original: c.produto,
      premio: convertido ? valor(c.premioTotal) : null,
      comissao: convertido ? valor(c.comissao) : null,
      extras: {
        data_conversao: convertido ? c.dataDesfecho : null,
        data_perda: perdido ? c.dataDesfecho : null,
        spa: 1046,
        ...(antesDoBitrix ? { sem_entrada: true } : {}),
      },
    };
  });
  return { linhas, empresas };
}

export async function lerBitrixProduto(produto: ProdutoBitrix) {
  if (produto === "capitalizacao") return { linhas: await lerCapitalizacao(), empresas: new Map<string, string | null>() };
  if (produto === "automovel") return { linhas: await lerAutomovel(), empresas: new Map<string, string | null>() };
  return lerRamosElementares();
}

// Totais por mês (entradas / convertidos / perdidos), para conferir com o painel do produto.
export function contarPorMes(linhas: Linha[]) {
  const porMes: Record<string, Record<string, number>> = {};
  const soma = (m: string | null | undefined, k: string) => {
    if (!m) return;
    (porMes[m.slice(0, 7)] ||= {})[k] = (porMes[m.slice(0, 7)][k] ?? 0) + 1;
  };
  for (const l of linhas) {
    if (!l.extras.sem_entrada) soma(l.competencia_arquivo, `entradas_${l.produto}`);
    soma(l.extras.data_conversao as string | null, `convertidos_${l.produto}`);
    soma(l.extras.data_perda as string | null, `perdidos_${l.produto}`);
  }
  return porMes;
}

export async function gravarBitrixProduto(sb: SupabaseClient, produto: ProdutoBitrix, dados: Awaited<ReturnType<typeof lerBitrixProduto>>) {
  const { arquivo, nome } = ARQUIVOS[produto];
  const { linhas, empresas } = dados;
  const ok = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data;
  };
  await ok(
    sb.from("base_unica_planilhas_congeladas").upsert({ arquivo_id: arquivo, nome: `${nome} (fonte viva, sincronizada)`, pasta: "Bitrix", mime_type: "application/x-bitrix-spa" }, { onConflict: "arquivo_id", ignoreDuplicates: true })
  );
  const imp = (await ok(
    sb
      .from("base_unica_importacoes")
      .upsert(
        {
          arquivo_id: arquivo,
          arquivo_nome: nome,
          aba: "cotacoes",
          produto,
          layout: "bitrix_spa",
          competencia: null,
          linhas_lidas: linhas.length,
          linhas_importadas: linhas.length,
          descartes: {},
          totais_planilha: contarPorMes(linhas),
          totais_importados: { cards: linhas.length },
          confere: true,
          importado_em: new Date().toISOString(),
        },
        { onConflict: "arquivo_id,aba" }
      )
      .select("id")
      .single()
  )) as { id: string };

  // Nomes novos (empresa do card de RE, texto da imobiliária na Capitalização)
  // entram na base única como registro a identificar; a ligação com a ficha é
  // feita pelo cron /api/cron/base-unica-vinculos.
  const registros = new Map<string, { fonte: string; chave_externa: string; nome_original: string | null }>();
  for (const l of linhas) {
    if (!l.imobiliaria_texto || !l.fonte_vinculo) continue;
    const nomeOriginal = l.fonte_vinculo === "bitrix_empresa" ? (empresas.get(l.imobiliaria_texto) ?? null) : l.imobiliaria_texto;
    registros.set(`${l.fonte_vinculo}|${l.imobiliaria_texto}`, { fonte: l.fonte_vinculo, chave_externa: l.imobiliaria_texto, nome_original: nomeOriginal });
  }
  if (registros.size) await ok(sb.from("imobiliaria_registros_fonte").upsert([...registros.values()], { onConflict: "fonte,chave_externa", ignoreDuplicates: true }));

  const registrosProducao = linhas.map((l) => ({
    ...l,
    importacao_id: imp.id,
    tipo: "novo",
    fonte: "bitrix",
    origem_arquivo_id: arquivo,
    origem_aba: "cotacoes",
    herdada: false,
    chave_caso: `bitrix|${produto}|${l.origem_bitrix_id}`,
  }));
  for (let i = 0; i < registrosProducao.length; i += 500) {
    await ok(sb.from("producao_unificada").upsert(registrosProducao.slice(i, i + 500), { onConflict: "fonte,produto,origem_bitrix_id" }));
  }
  // Card apagado (ou que mudou de produto) sai desta carga.
  const atuais = new Set(registrosProducao.map((r) => `${r.produto}|${r.origem_bitrix_id}`));
  const gravados: { id: string; produto: string; origem_bitrix_id: string }[] = [];
  for (let ini = 0; ; ini += 1000) {
    const data = (await ok(sb.from("producao_unificada").select("id, produto, origem_bitrix_id").eq("origem_arquivo_id", arquivo).order("id").range(ini, ini + 999))) as typeof gravados;
    gravados.push(...data);
    if (data.length < 1000) break;
  }
  const sobras = gravados.filter((g) => !atuais.has(`${g.produto}|${g.origem_bitrix_id}`)).map((g) => g.id);
  for (let i = 0; i < sobras.length; i += 200) await ok(sb.from("producao_unificada").delete().in("id", sobras.slice(i, i + 200)));
  await ok(sb.rpc("atualizar_producao_painel", { p_forcar: true }));
  return { cards: registrosProducao.length, removidos: sobras.length };
}
