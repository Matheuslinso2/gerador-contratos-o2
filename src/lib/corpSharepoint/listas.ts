// Listas do SharePoint "O2 Data Analytics" com as regras do Power BI.
// Os campos chegam pelo nome interno (field_1, field_2…); o nome de exibição
// (produtor, entra_base_com_corretora…) vem da definição da lista.

export const LISTAS_SHAREPOINT = {
  produtores: "f0a0b058-2f70-424a-93e4-9ae20fdabf4d", // "Cadastro de Produtores"
  ramos: "b59dff8a-d03e-4d4e-b02b-5240352679b1", // "Agrupamento Ramos/Produtos"
  seguradoras: "7b51ed15-268f-408e-bf84-528be824cb3a", // "Lista de Seguradoras"
  metas: "b6178217-19a3-4600-a0de-67e0bbb47adc", // "Base de Metas"
  analises: "c3181b08-00d1-4886-8e60-27eeee408da5", // "Análise e Recusado"
} as const;

export type CampoLista = { InternalName: string; Title: string };
export type ListaBruta = { fields: CampoLista[]; items: Record<string, unknown>[] };

// Converte os itens para { nome de exibição: valor }.
export function porNomeDeExibicao(lista: ListaBruta): Record<string, unknown>[] {
  const nomes = new Map(lista.fields.map((f) => [f.InternalName, f.Title]));
  return lista.items.map((it) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(it)) {
      const nome = nomes.get(k);
      if (nome) o[nome] = v;
    }
    if (typeof it.Id === "number") o.__id = it.Id;
    else if (typeof it.ID === "number") o.__id = it.ID;
    return o;
  });
}

const t = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

const COLUNAS_PRODUTOR = new Set([
  "produtor", "entra_base_com_corretora", "entra_base_com_produtor", "origem", "centralizador_parceiro",
  "filial", "corretor", "tipo_pessoa", "Title", "Título", "__id",
]);

// Texto EXATO, sem limpar espaços: o Power BI é a referência (o Workspace é
// espelho dele) e ele compara o nome do produtor e as classes exatamente como
// estão escritos na lista — nome com espaço sobrando não casa com o Corp e a
// produção dele fica fora, lá e aqui (aparece em Inconsistências).
const exato = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export function regrasProdutor(lista: ListaBruta) {
  const porNome = new Map<string, Record<string, unknown>>();
  for (const o of porNomeDeExibicao(lista)) {
    const produtor = exato(o.produtor);
    if (!produtor) continue;
    const sistemas: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (!COLUNAS_PRODUTOR.has(k) && t(v)) sistemas[k] = t(v)!;
    porNome.set(produtor, {
      produtor,
      nome_no_sharepoint: produtor,
      entra_base_com_corretora: exato(o.entra_base_com_corretora),
      entra_base_com_produtor: exato(o.entra_base_com_produtor),
      origem: t(o.origem),
      centralizador_parceiro: exato(o.centralizador_parceiro),
      filial: t(o.filial),
      corretor: t(o.corretor),
      tipo_pessoa: t(o.tipo_pessoa),
      sistemas,
      sp_item_id: typeof o.__id === "number" ? o.__id : null,
    });
  }
  return [...porNome.values()];
}

export function regrasRamo(lista: ListaBruta) {
  return porNomeDeExibicao(lista)
    .filter((o) => t(o.id_ramo))
    .map((o) => ({
      id_ramo: t(o.id_ramo)!,
      descricao: t(o.descricao_ramo),
      agrupamento_pai: t(o.agrupamento_pai),
      agrupamento_filho: t(o.agrupamento_filho),
      agrupamento_flash: t(o.agrupamento_flash),
    }));
}

export function regrasSeguradora(lista: ListaBruta) {
  return porNomeDeExibicao(lista)
    .filter((o) => t(o.id_seguradora))
    .map((o) => ({ id_seguradora: t(o.id_seguradora)!, seguradora: t(o.seguradora), abreviado: t(o.seguradora_abreviado) }));
}

// "Base de Metas": ramo (agrupamento do Flash Report), mês por extenso, ano.
export function metas(lista: ListaBruta) {
  const out: { agrupamento_flash: string; mes: string; com_corretora: number }[] = [];
  for (const o of porNomeDeExibicao(lista)) {
    const ramo = t(o.ramo);
    const m = MESES.indexOf((t(o.mes) ?? "").toUpperCase());
    const ano = Number(t(o.ano));
    const valor = Number(o.com_corretora);
    if (!ramo || m < 0 || !ano || !Number.isFinite(valor)) continue;
    out.push({ agrupamento_flash: ramo, mes: `${ano}-${String(m + 1).padStart(2, "0")}-01`, com_corretora: valor });
  }
  return out;
}

export function analisesRecusas(lista: ListaBruta) {
  return porNomeDeExibicao(lista)
    .filter((o) => t(o.data_atualizacao) && t(o.ramo))
    .map((o) => ({
      data_atualizacao: String(o.data_atualizacao).slice(0, 10),
      ramo: t(o.ramo)!,
      qtde_analise_acumulada: Number(o.qtde_analise_acumulada) || 0,
      qtde_recusado_acumulada: Number(o.qtde_recusado_acumulada) || 0,
    }));
}
