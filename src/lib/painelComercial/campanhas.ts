import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DIAS_APROVADA_PARADA,
  ROTULO_FAROL,
  ritmoEFarolNoPrazo,
  hojeBrasilia,
  metricaInfo,
  montarDesempenhoCampanha,
  produtosBaseDaCampanha,
  type DesempenhoCampanha,
  type LinhaDesempenho,
} from "@/lib/campanhas/desempenho";
import { participantesDaCampanha } from "@/lib/campanhas/metasCampanha";
import { imobiliariasDaCampanha } from "@/lib/campanhas/imobiliariasDaCampanha";
import { produtosDaCampanha } from "@/lib/campanhas/produtos";
import { DIAS_SEM_CONTATO_ALERTA, resumirContatos, ultimosContatosPorImobiliaria, type ContatosImobiliaria } from "@/lib/campanhas/contatosBitrix";
import { ROTULO_STATUS_ENVIO, resumirStatusPorImobiliaria, type EnvioParaStatus } from "@/lib/campanhas/producaoStatus";
import type { Datasets, Linha } from "./construir";

// Aba Campanhas do Painel Comercial: junta o CRM (cards, etapas, permanência)
// com a área Campanhas do Workspace (metas por cliente, produção, projeção,
// farol, e-mails). NÃO recalcula nada: reaproveita montarDesempenhoCampanha,
// a mesma função da tela /campanhas/[id]. O vínculo cliente do CRM ↔
// imobiliária é pelo ID da Empresa do Bitrix (imobiliaria_registros_fonte,
// fonte bitrix_empresa, só vínculos confirmados), nunca pelo nome.

const DIAS_RETROATIVO = 31; // campanha encerrada há pouco ainda aparece

type CampanhaDb = Record<string, unknown> & { id: string; nome: string; valido_de: string; valido_ate: string; meta_metrica: string };
type Calculada = { campanha: CampanhaDb; desempenho: DesempenhoCampanha; emails: Map<string, ReturnType<typeof resumirStatusPorImobiliaria> extends Map<string, infer V> ? V : never> };

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function campanhasComMeta(db: SupabaseClient, hoje: string): Promise<CampanhaDb[]> {
  const { data } = await db
    .from("campanhas")
    .select("*")
    .is("campanha_pai_id", null)
    .not("meta_metrica", "is", null)
    .not("valido_de", "is", null)
    .not("valido_ate", "is", null)
    .gte("valido_ate", somarDias(hoje, -DIAS_RETROATIVO))
    .order("valido_ate", { ascending: true });
  return (data ?? []) as CampanhaDb[];
}

async function calcular(db: SupabaseClient, c: CampanhaDb): Promise<Calculada | null> {
  const produtos = produtosBaseDaCampanha(produtosDaCampanha(c as { produtos?: string[] | null; produto?: string | null }));
  if (!produtos.length) return null;
  const idsImobs = await imobiliariasDaCampanha(db, c as never);
  const { participantes } = await participantesDaCampanha(db, c.id, idsImobs);
  if (!participantes.length) return null;
  const desempenho = await montarDesempenhoCampanha(
    db,
    {
      nome: c.nome,
      produtos,
      metrica: c.meta_metrica,
      inicio: c.valido_de,
      fim: c.valido_ate,
      premiacao_descricao: (c.premiacao_descricao as string | null) ?? null,
      custo_premiacao_geral: Number(c.custo_premiacao_geral) || 0,
    },
    participantes
  );
  // E-mails da campanha (principal + e-mails filhos), por imobiliária.
  const { data: filhos } = await db.from("campanhas").select("id").eq("campanha_pai_id", c.id);
  const ids = [c.id, ...((filhos ?? []) as { id: string }[]).map((f) => f.id)];
  const envios: EnvioParaStatus[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await db
      .from("campanhas_envios")
      .select("imobiliaria_id, email, status, enviado_em, aberto_em, clicado_em, erro_detalhe")
      .in("campanha_id", ids.slice(i, i + 50));
    envios.push(...((data ?? []) as EnvioParaStatus[]));
  }
  return { campanha: c, desempenho, emails: resumirStatusPorImobiliaria(envios) };
}

const cobreMetrica = (n: number | null, moeda: boolean) => (n === null ? null : moeda ? Math.round(n) : Math.round(n * 10) / 10);

export async function montarDatasetsCampanhas(db: SupabaseClient, cardsCrm: Linha[]): Promise<Datasets> {
  const hoje = hojeBrasilia();
  const lista = await campanhasComMeta(db, hoje);
  const calculadas: Calculada[] = [];
  const falhas: string[] = [];
  for (const c of lista) {
    try {
      const r = await calcular(db, c);
      if (r) calculadas.push(r);
    } catch (e) {
      falhas.push(`${c.nome}: ${e instanceof Error ? e.message : "falha ao calcular"}`);
    }
  }

  // Vínculo empresa do Bitrix -> imobiliária (somente confirmados).
  const empresas = [...new Set(cardsCrm.map((c) => String(c.empresa_id ?? "")).filter((x) => x && x !== "0"))];
  const empresaParaImob = new Map<string, string>();
  const situacaoDoVinculo = new Map<string, string>();
  for (let i = 0; i < empresas.length; i += 100) {
    const { data } = await db
      .from("imobiliaria_registros_fonte")
      .select("imobiliaria_id, chave_externa, situacao")
      .eq("fonte", "bitrix_empresa")
      .in("chave_externa", empresas.slice(i, i + 100));
    for (const r of (data ?? []) as { imobiliaria_id: string | null; chave_externa: string; situacao: string }[]) {
      situacaoDoVinculo.set(r.chave_externa, r.situacao);
      if (r.situacao === "confirmado" && r.imobiliaria_id) empresaParaImob.set(r.chave_externa, r.imobiliaria_id);
    }
  }

  // imobiliária -> (campanha, linha de desempenho que a contém)
  // Uma imobiliária pode estar em mais de uma campanha: escolhe a que tem meta
  // para ela e, em empate, a que combina com o campo Campanha do próprio card.
  const porImob = new Map<string, { calc: Calculada; linha: LinhaDesempenho }[]>();
  for (const calc of calculadas) for (const l of calc.desempenho.linhas) for (const id of l.unidadeIds) porImob.set(id, [...(porImob.get(id) ?? []), { calc, linha: l }]);
  const normaliza = (t: unknown) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const escolher = (imobId: string, campanhaCrm: unknown) => {
    const candidatas = porImob.get(imobId) ?? [];
    const chave = normaliza(campanhaCrm).split(/[^a-z0-9]+/)[0];
    const pontos = (c: { calc: Calculada; linha: LinhaDesempenho }) => (c.linha.meta !== null && c.linha.meta > 0 ? 2 : 0) + (chave && normaliza(c.calc.campanha.nome).includes(chave) ? 1 : 0);
    return [...candidatas].sort((a, b) => pontos(b) - pontos(a))[0];
  };

  const clientes: Linha[] = [];
  const pendencias: Linha[] = [];
  for (const card of cardsCrm) {
    const empId = String(card.empresa_id ?? "");
    const imobId = empresaParaImob.get(empId) ?? null;
    const achado = imobId ? escolher(imobId, card.campanha) : undefined;
    const fimCrm = typeof card.campanha_crm_fim === "string" ? card.campanha_crm_fim : null;
    const base = { card: card.card, cliente: card.cliente, vendedora: card.vendedora, gestor: card.gestor, etapa: card.etapa, dias_etapa: card.dias_etapa, situacao: card.situacao, dias_sem_ativ: card.dias_sem_ativ, produtos: card.produtos, empresa_id: empId };
    if (!achado) {
      const motivo = !imobId ? (situacaoDoVinculo.get(empId) ? `Vínculo ${situacaoDoVinculo.get(empId)} (não confirmado)` : "Empresa sem vínculo com a base de imobiliárias") : "Imobiliária fora das campanhas com meta";
      clientes.push({ ...base, campanha_id: null, campanha: card.campanha, vinculo: "Sem vínculo com a campanha", meta: null, realizado: null, faltam: null, pct: null, ritmo_semana: null, projecao: null, farol: null, farol_chave: null, email_enviados: null, email_abertos: null, email_status: null, cotacoes_abertas: null, aprovadas_paradas: null, renovacoes: null, imobiliaria_id: imobId });
      pendencias.push({ card: card.card, cliente: card.cliente, vendedora: card.vendedora, motivo });
      continue;
    }
    const { calc, linha } = achado;
    const m = metricaInfo(calc.campanha.meta_metrica);
    // Prazo do cliente: o fim do campo Campanha do card no CRM (Expan, Silvério e Adjuve = 2 meses,
    // os demais = 3). Só vale quando cabe dentro da campanha cadastrada.
    const fimCliente = fimCrm && fimCrm < calc.campanha.valido_ate && fimCrm > calc.campanha.valido_de ? fimCrm : calc.campanha.valido_ate;
    const proprio = fimCliente !== calc.campanha.valido_ate ? ritmoEFarolNoPrazo(linha.meta, linha.realizado, calc.campanha.valido_de, fimCliente) : null;
    const novas = linha.oportunidades.filter((o) => o.tipo === "novo");
    const resumoEmail = linha.unidadeIds.map((id) => calc.emails.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const temEmail = resumoEmail.length > 0;
    const pior = temEmail ? (resumoEmail.find((r) => r.chave === "falhou") ?? resumoEmail.find((r) => r.chave === "abriu") ?? resumoEmail[0]) : null;
    clientes.push({
      ...base,
      campanha_id: calc.campanha.id,
      campanha: calc.campanha.nome,
      vinculo: "Vinculado",
      imobiliaria_id: imobId,
      participante: linha.nome,
      participante_id: linha.participanteId,
      responsavel_o2: linha.responsavelEmail,
      gestor_conta: linha.gestorContaEmail,
      campanha_inicio: calc.campanha.valido_de,
      campanha_fim: fimCliente,
      campanha_fim_cadastrada: calc.campanha.valido_ate,
      prazo_proprio: proprio ? "Sim" : "Não",
      dias_restantes: proprio ? proprio.diasRestantes : calc.desempenho.diasRestantes,
      dias_total: proprio ? proprio.diasTotais : calc.desempenho.diasTotais,
      dias_decorridos: proprio ? proprio.diasDecorridos : calc.desempenho.diasDecorridos,
      unidade: m.rotulo,
      moeda: m.moeda ? "Sim" : "Não",
      meta: cobreMetrica(linha.meta, m.moeda),
      realizado: cobreMetrica(linha.realizado, m.moeda),
      realizado_mes: cobreMetrica(linha.realizadoMes, m.moeda),
      meta_mensal: cobreMetrica(proprio ? proprio.metaMensal : linha.metaMensal, m.moeda),
      faltam: cobreMetrica(linha.faltam, m.moeda),
      pct: linha.percentual === null ? null : Math.round(linha.percentual * 10) / 10,
      ritmo_semana: (proprio ? proprio.ritmoSemana : linha.ritmoSemana) === null ? null : Math.round((proprio ? proprio.ritmoSemana : linha.ritmoSemana)! * 10) / 10,
      projecao: cobreMetrica(proprio ? proprio.projecao : linha.projecao, m.moeda),
      farol: ROTULO_FAROL[proprio ? proprio.farol : linha.farol],
      farol_chave: proprio ? proprio.farol : linha.farol,
      email_enviados: resumoEmail.reduce((s, r) => s + r.totalEmails, 0),
      email_abertos: resumoEmail.reduce((s, r) => s + r.emailsAbertos, 0),
      email_status: pior ? ROTULO_STATUS_ENVIO[pior.chave] : "Aguardando envio",
      cotacoes_abertas: novas.length,
      aprovadas_paradas: novas.filter((o) => o.status === "Aprovado" && o.dias >= DIAS_APROVADA_PARADA).length,
      renovacoes: linha.funil.renovacoes.contratacoes,
      cotacoes_mes: linha.cotacoesMes,
    });
  }

  // Contatos (Bitrix + registrados por fora). O alerta olha o contato do
  // VENDEDOR(A) responsável pelo card no CRM; contato de outro colaborador
  // aparece no histórico mas não zera o alerta, e e-mail automático da
  // campanha não conta como contato pessoal.
  // E-mail de cada vendedor(a) NO BITRIX (o do Henrique é de outro domínio, conferido em user.get).
  const EMAIL_VENDEDOR: Record<string, string> = { Dayane: "dayane@o2seguros.com.br", Livia: "livia@o2seguros.com.br", Henrique: "henrique@o2vistorialocaticia.com.br", Vanessa: "vanessa@o2seguros.com.br" };
  const NOME_POR_EMAIL = new Map(Object.entries(EMAIL_VENDEDOR).map(([n, e]) => [e, n]));
  const imobsVinculadas = [...new Set(clientes.filter((c) => c.vinculo === "Vinculado" && c.imobiliaria_id).map((c) => String(c.imobiliaria_id)))];
  const ultimoEmailDaCampanha = new Map<string, string>();
  for (const calc of calculadas) for (const [id, r] of calc.emails) for (const e of r.emails) if (e.enviadoEm && e.enviadoEm > (ultimoEmailDaCampanha.get(id) ?? "")) ultimoEmailDaCampanha.set(id, e.enviadoEm);
  let contatos: Map<string, ContatosImobiliaria> | null = null;
  try {
    contatos = await ultimosContatosPorImobiliaria(db, imobsVinculadas, ultimoEmailDaCampanha);
  } catch (e) {
    console.error("Contatos de Campanhas indisponíveis:", e);
  }
  for (const c of clientes) {
    if (c.vinculo !== "Vinculado") continue;
    const dados = contatos?.get(String(c.imobiliaria_id));
    if (!dados) {
      c.alerta_contato = contatos ? "Sem empresa no Bitrix para checar contatos" : "Contatos indisponíveis agora";
      continue;
    }
    const r = resumirContatos([dados], EMAIL_VENDEDOR[String(c.vendedora)] ?? null);
    const qualquer = dados.eventos[0] ?? null;
    c.ultimo_contato_vend = r?.doResponsavel?.data ?? null;
    c.dias_sem_contato_vend = r?.diasSemContato ?? null;
    c.ultimo_contato_qualquer = qualquer?.data ?? null;
    c.ultimo_contato_qualquer_canal = qualquer?.canal ?? null;
    c.ultimo_contato_qualquer_quem = qualquer?.quem ? (NOME_POR_EMAIL.get(qualquer.quem) ?? qualquer.quem) : null;
    c.contatos = dados.eventos.slice(0, 8).map((e) => ({ data: e.data, canal: e.canal, quem: e.quem ? (NOME_POR_EMAIL.get(e.quem) ?? e.quem) : "Não identificado", origem: e.origem }));
    const vendedorSemEmail = !EMAIL_VENDEDOR[String(c.vendedora)];
    c.alerta_contato = vendedorSemEmail ? "Vendedor(a) sem conta conhecida" : r?.diasSemContato === null ? "Sem contato registrado" : (r?.diasSemContato ?? 0) >= DIAS_SEM_CONTATO_ALERTA ? `${r?.diasSemContato} dias sem contato` : null;
  }

  // Resumo por campanha (uma linha por campanha com meta, sem misturar prazos).
  const camp_def: Linha[] = calculadas.map(({ campanha, desempenho }) => {
    const m = metricaInfo(campanha.meta_metrica);
    const t = desempenho.totais;
    const cardsDaCamp = clientes.filter((c) => c.campanha_id === campanha.id);
    const unicos = new Set(cardsDaCamp.map((c) => c.imobiliaria_id));
    const comMeta = desempenho.linhas.filter((l) => l.meta !== null && l.meta > 0);
    const farolDe = (f: string[]) => desempenho.linhas.filter((l) => f.includes(l.farol)).length;
    return {
      id: campanha.id,
      nome: campanha.nome,
      inicio: campanha.valido_de,
      fim: campanha.valido_ate,
      dias_total: desempenho.diasTotais,
      dias_restantes: desempenho.diasRestantes,
      pct_prazo: desempenho.diasTotais ? Math.round((desempenho.diasDecorridos / desempenho.diasTotais) * 1000) / 10 : null,
      metrica: m.valor,
      metrica_rotulo: m.rotulo,
      moeda: m.moeda ? "Sim" : "Não",
      meta_total: cobreMetrica(t.meta, m.moeda),
      realizado: cobreMetrica(t.realizado, m.moeda),
      realizado_mes: cobreMetrica(t.realizadoMes, m.moeda),
      pct_meta: t.percentual === null ? null : Math.round(t.percentual * 10) / 10,
      projecao: cobreMetrica(t.projecao, m.moeda),
      cotacoes_mes: t.cotacoesMes,
      participantes: desempenho.linhas.length,
      participantes_com_meta: comMeta.length,
      clientes_unicos_crm: unicos.size,
      cards_crm: cardsDaCamp.length,
      farol_no_ritmo: farolDe(["no_ritmo", "atingida"]),
      farol_atencao: farolDe(["atencao"]),
      farol_em_risco: farolDe(["em_risco", "nao_atingida"]),
      renovacoes_fora_da_meta: t.funil.renovacoes.contratacoes,
      corp_documentos: t.corp.documentos,
      corp_premio: Math.round(t.corp.premio),
      comissao: Math.round(t.corp.comissao),
      repasse: Math.round(t.corp.repasse),
      custo_premiacao: Math.round(t.custoPremiacao),
      resultado: Math.round(t.resultado),
    };
  });

  const out: Datasets = { camp_def, camp_clientes: clientes, camp_pendencias: pendencias };
  if (falhas.length) out.camp_erros = falhas.map((erro) => ({ erro }));
  return out;
}
