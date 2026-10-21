import type { SupabaseClient } from "@supabase/supabase-js";

// Base Única × Power BI — aplica o "Cadastro de Produtores" do Power BI
// (corp_regra_produtor, espelho da lista do SharePoint analyticspwb mantido
// pela sessão Integração Power BI) na base única de imobiliárias.
// Decisão do Matheus em 21/10/2026: "O POWER BI SEMPRE VALE" — o anterior fica
// em imobiliaria_historico, nunca apagado sem rastro.
//
// Roda sozinho no fim do cron /api/cron/corp-sharepoint e pelo script
// scripts/base-unica/aplicar-power-bi.ts (conferência manual). Re-rodável.
//  1. Liga cada produtor do PBI ao registro do Corp (fonte corp_produtor), pelo
//     nome (sem espaços nas pontas) ou, se o nome mudou, pelo código Corp.
//  2. Produtor que entra na base (ENTRA / TRATAR N1 / TRATAR N2) sem ficha:
//     liga à ficha de mesmo nome (sugestão "nome igual") ou cria uma ficha nova
//     (cadastro incompleto) com os dados do cadastro do Corp.
//  3. Centralizador do PBI = grupo (2+ fichas no mesmo centralizador). Ficha
//     com o nome do centralizador = matriz.
//  4. Centralizador "O2 SEGUROS" = produção própria da O2 (Venda direta O2).
//  5. Origem, tipo de pessoa e centralizador do PBI vão para a ficha.
//
// REGRA DE SEGURANÇA: o que desfaz uma decisão já confirmada no Workspace
// (tirar ficha de grupo, mudar ficha de um grupo para outro, desligar um
// produtor da ficha para Venda direta O2) só é aplicado quando o Matheus já
// aprovou aquele caso (listas abaixo). Caso novo fica só em `pendentes`.

// Aprovados pelo Matheus em 21/10/2026 (Max Brokers na resposta direta dele, no mesmo dia).
const GRUPOS_DESFAZER_APROVADOS = new Set(["Ribas-HP / Pintas / HC Consultoria", "Max Brokers"]);
const VENDA_DIRETA_DESLIGAR_APROVADOS = new Set(["MARTINELLI (BASE)"]);

const ENTRA = new Set(["ENTRA", "TRATAR N1", "TRATAR N2"]);
const CENTRAL_O2 = "O2 SEGUROS";
// Canais/marcadores do Corp nunca são imobiliária (Matheus, 18/10/2026) e
// "1 - REPASSE PADRÃO" é modelo do Corp — não viram ficha mesmo que o PBI liste.
const NUNCA_IMOBILIARIA = /^(O2 CORRETORA|SEGIMOB$|BASE SOFTWARE$|SUPERL[OÓ]GICA$|RETRANSMISS|TOMBAMENTO$|\d+ - )/i;
const MARCA_FICHA_PBI = "a partir do Cadastro de Produtores do Power BI";

type Regra = { produtor: string; centralizador: string | null; origem: string | null; tipo_pessoa: string | null; entra_base_com_corretora: string | null };
type Sugestao = { imobiliaria_id: string; motivo: string };
type Registro = {
  id: string;
  chave_externa: string;
  nome_original: string;
  situacao: string;
  imobiliaria_id: string | null;
  sugestoes: Sugestao[] | null;
  dados: Record<string, unknown> | null;
  volume: number | null;
};
type Ficha = {
  id: string;
  nome: string;
  grupo_id: string | null;
  papel_no_grupo: string | null;
  origem_comercial: string | null;
  tipo_pessoa: string | null;
  centralizador_power_bi: string | null;
  observacao_interna: string | null;
};
type Grupo = { id: string; nome: string };
type Item = Regra & { central: string; registro: Registro | null };

export type ResultadoPowerBi = {
  gravado: boolean;
  produtores: number;
  ligadosAoCorp: number;
  ligarPorNomeIgual: number;
  fichasCriar: { nome: string; possivelDuplicataDe: string[] }[];
  semRegistroNoCorp: number;
  registrosDoEspelho: number; // registros do Corp criados a partir do espelho do SharePoint (produtores novos)
  foraDaBase: number;
  vendaDireta: string[];
  grupos: { centralizador: string; grupo: string | null; novo: boolean; fichas: number; mudam: string[] }[];
  sairDoGrupo: string[];
  // Conflitos com decisão já confirmada que o Matheus ainda não aprovou: nunca aplicados sozinhos.
  pendentes: { tipo: "sair_do_grupo" | "trocar_de_grupo" | "venda_direta"; descricao: string }[];
  alteracoes: number;
};

const t = (s: unknown) => String(s ?? "").trim();
const semAcento = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
const k = (s: unknown) => semAcento(t(s)).replace(/\s+/g, " ");

async function todos<T>(sb: SupabaseClient, tabela: string, colunas: string, filtro: (q: any) => any = (q) => q): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await filtro(sb.from(tabela).select(colunas)).range(ini, ini + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function aplicarPowerBi(sb: SupabaseClient, { gravar }: { gravar: boolean }): Promise<ResultadoPowerBi> {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  let alteracoes = 0;
  // Histórico gravado na hora de cada mudança (se parar no meio, o que já mudou está registrado).
  async function log(campo: string, ids: Record<string, string | null>, antes: unknown, depois: unknown, motivo: string) {
    const { error } = await sb.from("imobiliaria_historico").insert({ campo, ...ids, antes, depois, motivo, origem: "power_bi" });
    if (error) throw new Error("histórico: " + error.message);
    alteracoes++;
  }
  async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data;
  }

  const [regras, registros, fichas, grupos, pares] = await Promise.all([
    todos<Regra>(sb, "corp_regra_produtor", "produtor, centralizador, origem, tipo_pessoa, entra_base_com_corretora", (q) => q.order("produtor")),
    todos<Registro>(sb, "imobiliaria_registros_fonte", "id, chave_externa, nome_original, situacao, imobiliaria_id, sugestoes, dados, volume", (q) =>
      q.eq("fonte", "corp_produtor").order("id")
    ),
    todos<Ficha>(sb, "imobiliarias", "id, nome, grupo_id, papel_no_grupo, origem_comercial, tipo_pessoa, centralizador_power_bi, observacao_interna", (q) => q.order("id")),
    todos<Grupo>(sb, "imobiliaria_grupos", "id, nome", (q) => q.order("id")),
    (async () => {
      const out: { produtor: string; codigo_produtor: string }[] = [];
      for (let ini = 0; ; ini += 1000) {
        const { data, error } = await sb.rpc("base_unica_produtor_codigos").range(ini, ini + 999);
        if (error) throw new Error("produtor_codigos: " + error.message);
        out.push(...((data ?? []) as typeof out));
        if (!data || data.length < 1000) break;
      }
      return out;
    })(),
  ]);
  const codigosDoProdutor = new Map<string, Set<string>>();
  for (const p of pares) {
    if (!codigosDoProdutor.has(p.produtor)) codigosDoProdutor.set(p.produtor, new Set());
    codigosDoProdutor.get(p.produtor)!.add(String(p.codigo_produtor));
  }
  // Produtor que já aparece no espelho do SharePoint (corp_grade) mas ainda não
  // tem registro no Corp da base única (a planilha Produtores é de 18/10/2026):
  // o registro nasce do próprio espelho (código + nome), para a ligação pelo
  // código e a criação da ficha pelo Power BI acontecerem sozinhas (21/10/2026).
  const codigosComRegistro = new Set(registros.map((r) => r.chave_externa.split("#")[0]));
  const novosDoEspelho = pares.filter((p, i, arr) => !codigosComRegistro.has(String(p.codigo_produtor)) && arr.findIndex((x) => x.codigo_produtor === p.codigo_produtor) === i);
  if (gravar && novosDoEspelho.length) {
    const linhas = novosDoEspelho.map((p) => ({
      fonte: "corp_produtor",
      chave_externa: String(p.codigo_produtor),
      nome_original: p.produtor,
      dados: { origem: "corp_grade (espelho do SharePoint)" },
    }));
    const { data, error } = await sb.from("imobiliaria_registros_fonte").insert(linhas).select("id, chave_externa, nome_original, situacao, imobiliaria_id, sugestoes, dados, volume");
    if (error) throw new Error("registros do espelho: " + error.message);
    registros.push(...((data ?? []) as Registro[]));
  }
  const registrosDoEspelho = novosDoEspelho.length;
  const fichaPorId = new Map(fichas.map((f) => [f.id, f]));
  const grupoPorId = new Map(grupos.map((g) => [g.id, g]));
  const codigo = (r: Registro) => r.chave_externa.split("#")[0];

  // 1. produtor do PBI → registro do Corp
  function acharRegistro(produtor: string): Registro | null {
    const porNome = registros.filter((r) => t(r.nome_original) === t(produtor));
    const cods = codigosDoProdutor.get(produtor) ?? new Set<string>();
    if (porNome.length === 1) return porNome[0];
    if (porNome.length > 1) return porNome.find((r) => cods.has(codigo(r))) ?? porNome[0];
    const porCodigo = registros.filter((r) => cods.has(codigo(r)));
    return porCodigo.length === 1 ? porCodigo[0] : null;
  }
  const itens: Item[] = regras.map((r) => ({ ...r, central: t(r.centralizador) || t(r.produtor), registro: acharRegistro(r.produtor) }));
  const pendentes: ResultadoPowerBi["pendentes"] = [];

  // 4. venda direta O2
  const vendaDireta = itens.filter((i) => k(i.central) === k(CENTRAL_O2));
  const desligarO2: Item[] = [];
  for (const i of vendaDireta) {
    if (i.registro?.situacao !== "confirmado" || /^O2 CORRETORA/i.test(i.produtor)) continue;
    if (VENDA_DIRETA_DESLIGAR_APROVADOS.has(t(i.produtor))) desligarO2.push(i);
    else
      pendentes.push({
        tipo: "venda_direta",
        descricao: `"${t(i.produtor)}" está ligado à ficha "${fichaPorId.get(i.registro.imobiliaria_id ?? "")?.nome ?? "?"}", mas o Power BI o centraliza em O2 SEGUROS (Venda direta O2)`,
      });
  }

  // 2. fichas: ligar à de mesmo nome ou criar
  const ligar: { item: Item; fichaId: string; criada?: boolean }[] = [];
  const criar: { item: Item; parecida: string[] }[] = [];
  let semRegistro = 0;
  let foraDaBase = 0;
  for (const i of itens) {
    if (vendaDireta.includes(i)) continue;
    if (!i.registro) {
      semRegistro++;
      continue;
    }
    if (i.registro.situacao === "confirmado" && i.registro.imobiliaria_id) continue;
    if (i.registro.situacao === "ignorar") continue; // decisão já tomada no Workspace
    if (NUNCA_IMOBILIARIA.test(t(i.produtor)) || !ENTRA.has(t(i.entra_base_com_corretora))) {
      foraDaBase++;
      continue;
    }
    const sug = Array.isArray(i.registro.sugestoes) ? i.registro.sugestoes : [];
    const iguais = [...new Set(sug.filter((s) => s.motivo === "nome igual").map((s) => s.imobiliaria_id))];
    if (iguais.length === 1 && fichaPorId.has(iguais[0])) ligar.push({ item: i, fichaId: iguais[0] });
    else criar.push({ item: i, parecida: sug.filter((s) => s.motivo === "nome parecido").map((s) => fichaPorId.get(s.imobiliaria_id)?.nome ?? "").filter(Boolean) });
  }

  // Ficha de cada item (novas recebem id provisório "novo:<produtor>").
  const fichaDoItem = new Map<Item, string>();
  for (const i of itens) if (i.registro?.situacao === "confirmado" && i.registro.imobiliaria_id && !vendaDireta.includes(i)) fichaDoItem.set(i, i.registro.imobiliaria_id);
  for (const l of ligar) fichaDoItem.set(l.item, l.fichaId);
  for (const c of criar) fichaDoItem.set(c.item, `novo:${c.item.produtor}`);
  const fichasComPbiAntes = new Set(fichaDoItem.values());

  // 3. grupos pelo centralizador
  const porCentral = new Map<string, { rotulo: string; fichas: Map<string, Item[]> }>();
  for (const [i, fichaId] of fichaDoItem) {
    const c = k(i.central);
    if (!porCentral.has(c)) porCentral.set(c, { rotulo: i.central, fichas: new Map() });
    const g = porCentral.get(c)!;
    if (!g.fichas.has(fichaId)) g.fichas.set(fichaId, []);
    g.fichas.get(fichaId)!.push(i);
  }
  const planoGrupos: { rotulo: string; grupoExistente: string | null; membros: { fichaId: string; papel: string | null }[] }[] = [];
  const fichaNoGrupoPbi = new Set<string>();
  for (const [c, g] of porCentral) {
    if (g.fichas.size < 2) continue;
    const conta: Record<string, number> = {};
    for (const id of g.fichas.keys()) {
      const gid = fichaPorId.get(id)?.grupo_id;
      if (gid) conta[gid] = (conta[gid] ?? 0) + 1;
    }
    const grupoExistente = Object.entries(conta).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const membros: { fichaId: string; papel: string | null }[] = [];
    for (const [fichaId, its] of g.fichas) {
      fichaNoGrupoPbi.add(fichaId);
      const atual = fichaPorId.get(fichaId);
      // Ficha que hoje está em OUTRO grupo: trocar desfaz decisão confirmada → pendente.
      if (atual?.grupo_id && atual.grupo_id !== grupoExistente) {
        pendentes.push({
          tipo: "trocar_de_grupo",
          descricao: `"${atual.nome}" está no grupo "${grupoPorId.get(atual.grupo_id)?.nome}", mas o Power BI a centraliza em "${g.rotulo}"`,
        });
        continue;
      }
      const matriz = its.some((i) => k(i.produtor) === c);
      const fisica = its.every((i) => /F[IÍ]SICA/i.test(t(i.tipo_pessoa)));
      // O PBI só diz quem é a matriz (ficha com o nome do centralizador) e se é
      // pessoa física. Ficha já no grupo mantém o papel definido pelo Matheus;
      // ficha existente que entra fica sem papel; ficha criada pelo PBI = unidade
      // (ou corretor, se PF).
      const jaNoGrupo = !!atual && !!grupoExistente && atual.grupo_id === grupoExistente;
      const criadaPeloPbi = !atual || (atual.observacao_interna ?? "").includes(MARCA_FICHA_PBI);
      const papel = matriz ? "matriz" : jaNoGrupo ? (atual!.papel_no_grupo ?? null) : criadaPeloPbi ? (fisica ? "corretor" : "unidade") : fisica ? "corretor" : null;
      membros.push({ fichaId, papel });
    }
    planoGrupos.push({ rotulo: g.rotulo, grupoExistente, membros });
  }
  // Ficha que o PBI coloca sozinha, mas que hoje está num grupo com fichas que o
  // PBI separa → sai do grupo (só se o Matheus já aprovou desfazer aquele grupo).
  const sairDoGrupo: Ficha[] = [];
  for (const f of fichas) {
    if (!f.grupo_id || fichaNoGrupoPbi.has(f.id) || !fichasComPbiAntes.has(f.id)) continue;
    const colegasComPbi = fichas.filter((o) => o.id !== f.id && o.grupo_id === f.grupo_id && fichasComPbiAntes.has(o.id));
    if (!colegasComPbi.length) continue;
    const nomeGrupo = grupoPorId.get(f.grupo_id)?.nome ?? "";
    if (GRUPOS_DESFAZER_APROVADOS.has(nomeGrupo)) sairDoGrupo.push(f);
    else pendentes.push({ tipo: "sair_do_grupo", descricao: `"${f.nome}" está no grupo "${nomeGrupo}", mas o Power BI a trata separada das outras fichas do grupo` });
  }

  const nomeFicha = (id: string) => (id.startsWith("novo:") ? `${id.slice(5)} (nova)` : (fichaPorId.get(id)?.nome ?? id));
  const resultado: ResultadoPowerBi = {
    gravado: gravar,
    produtores: itens.length,
    ligadosAoCorp: itens.filter((i) => i.registro).length,
    ligarPorNomeIgual: ligar.length,
    fichasCriar: criar.map((c) => ({ nome: t(c.item.produtor), possivelDuplicataDe: c.parecida })),
    semRegistroNoCorp: semRegistro,
    registrosDoEspelho,
    foraDaBase,
    vendaDireta: vendaDireta.map((i) => t(i.produtor)),
    grupos: planoGrupos.map((g) => ({
      centralizador: g.rotulo,
      grupo: g.grupoExistente ? (grupoPorId.get(g.grupoExistente)?.nome ?? null) : null,
      novo: !g.grupoExistente,
      fichas: g.membros.length,
      mudam: g.membros
        .filter((m) => {
          const f = fichaPorId.get(m.fichaId);
          return !f || !g.grupoExistente || f.grupo_id !== g.grupoExistente || (f.papel_no_grupo ?? null) !== m.papel;
        })
        .map((m) => `${nomeFicha(m.fichaId)} [${m.papel ?? "sem papel"}]`),
    })),
    sairDoGrupo: sairDoGrupo.map((f) => `${f.nome} (de "${grupoPorId.get(f.grupo_id ?? "")?.nome}")`),
    pendentes,
    alteracoes: 0,
  };
  if (!gravar) return resultado;

  // ---------- gravação ----------
  const agora = new Date().toISOString();

  if (vendaDireta.length)
    await ok(sb.from("base_unica_produtores_venda_direta").upsert(vendaDireta.map((i) => ({ produtor: i.produtor, atualizado_em: agora }))));
  for (const i of desligarO2) {
    const r = i.registro!;
    await ok(sb.from("imobiliaria_registros_fonte").update({ situacao: "ignorar", metodo_vinculo: "power_bi", confirmado_em: agora, confirmado_por_email: "power_bi" }).eq("id", r.id));
    await log(
      "vinculo",
      { registro_id: r.id, imobiliaria_id: r.imobiliaria_id },
      { situacao: "confirmado", imobiliaria_id: r.imobiliaria_id },
      { situacao: "ignorar", canal: "venda_direta_o2" },
      `Power BI centraliza "${t(i.produtor)}" em O2 SEGUROS: produção própria da O2 (Venda direta O2)`
    );
  }

  const idNovo = new Map<string, string>();
  for (const c of criar) {
    const r = c.item.registro!;
    const d = (r.dados ?? {}) as { cpf_cnpj?: string; emails?: string[]; telefones?: string[]; endereco?: string; bairro?: string; cidade?: string; uf?: string };
    const doc = String(d.cpf_cnpj ?? "").replace(/\D/g, "");
    const obs = `Criada em ${hoje} pela Base Única ${MARCA_FICHA_PBI} (produtor Corp "${t(c.item.produtor)}", código ${codigo(r)}).${
      c.parecida.length ? ` Possível duplicata de: ${c.parecida.join(", ")} (nome parecido) — revisar.` : ""
    }`;
    const nova = await ok(
      sb
        .from("imobiliarias")
        .insert({
          nome: t(c.item.produtor),
          cnpj: doc || "A definir",
          texto_base_contrato: "",
          indice_reajuste: "",
          percentual_multa_atraso: 0,
          percentual_juros_mora: 0,
          percentual_honorarios_advocaticios: 0,
          cadastro_incompleto: true,
          email: d.emails?.[0] ?? null,
          telefone: d.telefones?.[0] ?? null,
          endereco: t(d.endereco) || null,
          bairro: d.bairro ?? null,
          cidade: d.cidade ?? null,
          uf: d.uf ?? null,
          observacao_interna: obs,
        })
        .select("id")
        .single()
    );
    const novaId = (nova as { id: string }).id;
    idNovo.set(`novo:${c.item.produtor}`, novaId);
    fichaPorId.set(novaId, {
      id: novaId,
      nome: t(c.item.produtor),
      grupo_id: null,
      papel_no_grupo: null,
      origem_comercial: null,
      tipo_pessoa: null,
      centralizador_power_bi: null,
      observacao_interna: obs,
    });
    await log("ficha_criada", { imobiliaria_id: novaId, registro_id: r.id }, null, { nome: t(c.item.produtor) }, "Produtor do Cadastro de Produtores do Power BI sem ficha no Workspace");
    ligar.push({ item: c.item, fichaId: novaId, criada: true });
  }
  const real = (id: string) => idNovo.get(id) ?? id;

  for (const l of ligar) {
    const r = l.item.registro!;
    await ok(sb.from("imobiliaria_registros_fonte").update({ situacao: "confirmado", imobiliaria_id: l.fichaId, metodo_vinculo: "power_bi", confirmado_em: agora, confirmado_por_email: "power_bi" }).eq("id", r.id));
    await log(
      "vinculo",
      { registro_id: r.id, imobiliaria_id: l.fichaId },
      { situacao: r.situacao, imobiliaria_id: r.imobiliaria_id },
      { situacao: "confirmado", imobiliaria_id: l.fichaId },
      l.criada ? "Ligado à ficha criada a partir do Power BI" : "Ligado à ficha de mesmo nome (produtor classificado no Power BI)"
    );
  }

  for (const g of planoGrupos) {
    if (!g.membros.length) continue;
    let grupoId = g.grupoExistente;
    if (!grupoId) {
      const chave = semAcento(g.rotulo).replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
      const novo = await ok(
        sb
          .from("imobiliaria_grupos")
          .insert({ nome: g.rotulo, tipo: "rede_filiais", chave, criado_por_email: "power_bi", observacao: `Criado em ${hoje} a partir do centralizador "${g.rotulo}" do Cadastro de Produtores do Power BI` })
          .select("id")
          .single()
      );
      grupoId = (novo as { id: string }).id;
      await log("grupo_criado", { grupo_id: grupoId }, null, { nome: g.rotulo, tipo: "rede_filiais" }, `Centralizador "${g.rotulo}" do Power BI`);
    }
    for (const m of g.membros) {
      const id = real(m.fichaId);
      const f = fichaPorId.get(id)!;
      if (f.grupo_id === grupoId && (f.papel_no_grupo ?? null) === m.papel) continue;
      await ok(sb.from("imobiliarias").update({ grupo_id: grupoId, papel_no_grupo: m.papel }).eq("id", id));
      await log("grupo", { imobiliaria_id: id, grupo_id: grupoId }, { grupo_id: f.grupo_id, papel_no_grupo: f.papel_no_grupo }, { grupo_id: grupoId, papel_no_grupo: m.papel }, `Centralizador "${g.rotulo}" do Power BI`);
    }
  }
  for (const f of sairDoGrupo) {
    await ok(sb.from("imobiliarias").update({ grupo_id: null, papel_no_grupo: null }).eq("id", f.id));
    await log("grupo", { imobiliaria_id: f.id, grupo_id: f.grupo_id }, { grupo_id: f.grupo_id, papel_no_grupo: f.papel_no_grupo }, { grupo_id: null, papel_no_grupo: null }, "O Power BI trata esta imobiliária separada das outras fichas do grupo");
  }

  // 5. origem / tipo de pessoa / centralizador (produtor de maior volume da ficha)
  const itensPorFicha = new Map<string, Item[]>();
  for (const [i, v] of fichaDoItem) {
    const id = real(v);
    if (!itensPorFicha.has(id)) itensPorFicha.set(id, []);
    itensPorFicha.get(id)!.push(i);
  }
  for (const [id, its] of itensPorFicha) {
    const f = fichaPorId.get(id);
    if (!f) continue;
    const i = [...its].sort((a, b) => (b.registro?.volume ?? 0) - (a.registro?.volume ?? 0))[0];
    const novo = { origem_comercial: t(i.origem) || null, tipo_pessoa: t(i.tipo_pessoa) || null, centralizador_power_bi: i.central || null };
    const antes = { origem_comercial: f.origem_comercial ?? null, tipo_pessoa: f.tipo_pessoa ?? null, centralizador_power_bi: f.centralizador_power_bi ?? null };
    if (JSON.stringify(antes) === JSON.stringify(novo)) continue;
    await ok(sb.from("imobiliarias").update(novo).eq("id", id));
    if (antes.origem_comercial || antes.tipo_pessoa || antes.centralizador_power_bi) await log("dados_power_bi", { imobiliaria_id: id }, antes, novo, "Origem/tipo de pessoa/centralizador do Power BI");
  }

  if (alteracoes) await ok(sb.rpc("atualizar_producao_painel", { p_forcar: true }));
  return { ...resultado, alteracoes };
}
