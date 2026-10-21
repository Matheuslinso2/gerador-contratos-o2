import * as XLSX from "xlsx";

// Leitura das extrações do Corp que ficam no SharePoint "O2 Data Analytics"
// (mesmos arquivos do Power BI "PBI O2 SEGUROS - PRODUÇÃO CORP"):
//   CORP_01.02 - Propostas Grade por Produtor  → grade_prods_AAAA-AAAA.xlsx
//   CORP_05.02 - Sinistros Geral Grade          → sinistros_grade.xlsx
//   CORP_02.05 - Clientes com Documentos        → Clientes Com Documentos.xlsx
//   00. BASES AUXILIARES                         → cidades_padronizadas.xlsx
// As colunas são achadas pelo NOME do cabeçalho (1ª ocorrência — a grade tem
// "Ramo" duas vezes: código e descrição). Nome e CPF de cliente não são lidos.

export type LinhaGrade = {
  codigo_produtor: number | null;
  agente: string | null;
  produtor: string | null;
  filial: string | null;
  nosso_numero: number;
  seg: string | null;
  ramo: string | null;
  numero_apolice: string | null;
  numero_endosso: string | null;
  ini_vig: string | null;
  fim_vig: string | null;
  dt_proposta: string | null;
  parcelas: number | null;
  pr_liquido: number | null;
  pr_adicional: number | null;
  vl_com: number | null;
  pct_com: number | null;
  vl_com_prod: number | null;
  pct_com_prod: number | null;
  base_com_corretora: number | null;
  pr_total: number | null;
  tipo: string | null;
  cancelado: string | null;
  canal_vendas: string | null;
};

export type LinhaSinistro = {
  tipo: string | null;
  nosso_numero: number | null;
  seg: string | null;
  ramo: string | null;
  apolice: string | null;
  item: number | null;
  numero_sinistro: string | null;
  dt_ocor: string | null;
  dt_aviso: string | null;
  vl_avisado: number | null;
  situacao: string | null;
  dt_encer: string | null;
  vl_inden: number | null;
  vl_despesas: number | null;
  produtor: string | null;
  cobertura: string | null;
};

export type LinhaDocumento = { nosso_numero: number; tipo_doc: string | null; uf: string | null; cidade: string | null };
export type CidadePadrao = { uf_cidade_corp: string; uf: string | null; cidade: string | null };

type Celula = string | number | boolean | Date | null | undefined;

function lerAba(buffer: Uint8Array, aba?: string): Celula[][] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false, dense: true });
  const nome = aba && wb.SheetNames.includes(aba) ? aba : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json<Celula[]>(wb.Sheets[nome], { header: 1, raw: true, defval: null });
}

function indices(cabecalho: Celula[]): Map<string, number> {
  const m = new Map<string, number>();
  cabecalho.forEach((c, i) => {
    const k = String(c ?? "").trim();
    if (k && !m.has(k)) m.set(k, i);
  });
  return m;
}

function coluna(m: Map<string, number>, nome: string, obrigatoria = true): number {
  const i = m.get(nome);
  if (i === undefined && obrigatoria) throw new Error(`coluna "${nome}" não encontrada no arquivo`);
  return i ?? -1;
}

const texto = (v: Celula): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const numero = (v: Celula): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const inteiro = (v: Celula): number | null => {
  const n = numero(v);
  return n === null ? null : Math.round(n);
};

// O Corp grava as datas como número de série do Excel com hora 00:00 de
// Brasília (o "T03:00:28Z" que aparece ao converter em UTC) — vale o dia.
function data(v: Celula): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    if (!p || p.y < 1900) return null;
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function lerGrade(buffer: Uint8Array): LinhaGrade[] {
  const linhas = lerAba(buffer);
  const m = indices(linhas[0] ?? []);
  const c = {
    codigo: coluna(m, "Codigo"), agente: coluna(m, "Agente"), produtor: coluna(m, "Produtor"), filial: coluna(m, "Filial"),
    nosso: coluna(m, "Nosso Nº"), seg: coluna(m, "Seg."), ramo: coluna(m, "Ramo"), apolice: coluna(m, "Nº Apólice"),
    endosso: coluna(m, "Nº Endosso"), ini: coluna(m, "Ini. Vig."), fim: coluna(m, "Fim Vig."),
    proposta: coluna(m, "Dt. Proposta", false), parcs: coluna(m, "Parcs."), prLiq: coluna(m, "Pr. Líquido"),
    prAd: coluna(m, "Pr. Adicional"), vlCom: coluna(m, "Vl. Com."), pctCom: coluna(m, "% Com."),
    vlComProd: coluna(m, "Vl. Com. Prod."), pctComProd: coluna(m, "% Com. Prod."), base: coluna(m, "Base Com. Corretora"),
    prTot: coluna(m, "Pr. Total"), tipo: coluna(m, "Tipo"), canc: coluna(m, "Cancelado"), canal: coluna(m, "Canal Vendas", false),
  };
  const out: LinhaGrade[] = [];
  for (const r of linhas.slice(1)) {
    const nosso = inteiro(r[c.nosso]);
    if (nosso === null) continue;
    out.push({
      codigo_produtor: inteiro(r[c.codigo]),
      agente: texto(r[c.agente]),
      produtor: texto(r[c.produtor]),
      filial: texto(r[c.filial]),
      nosso_numero: nosso,
      seg: texto(r[c.seg]),
      ramo: texto(r[c.ramo]),
      numero_apolice: texto(r[c.apolice]),
      numero_endosso: texto(r[c.endosso]),
      ini_vig: data(r[c.ini]),
      fim_vig: data(r[c.fim]),
      dt_proposta: c.proposta >= 0 ? data(r[c.proposta]) : null,
      parcelas: inteiro(r[c.parcs]),
      pr_liquido: numero(r[c.prLiq]),
      pr_adicional: numero(r[c.prAd]),
      vl_com: numero(r[c.vlCom]),
      pct_com: numero(r[c.pctCom]),
      vl_com_prod: numero(r[c.vlComProd]),
      pct_com_prod: numero(r[c.pctComProd]),
      base_com_corretora: numero(r[c.base]),
      pr_total: numero(r[c.prTot]),
      tipo: texto(r[c.tipo]),
      cancelado: texto(r[c.canc]),
      canal_vendas: c.canal >= 0 ? texto(r[c.canal]) : null,
    });
  }
  return out;
}

export function lerSinistros(buffer: Uint8Array): LinhaSinistro[] {
  const linhas = lerAba(buffer);
  const m = indices(linhas[0] ?? []);
  const c = {
    tipo: coluna(m, "Tipo"), nosso: coluna(m, "Nosso Nº"), seg: coluna(m, "Seg."), ramo: coluna(m, "Ramo"),
    apolice: coluna(m, "Apólice"), item: coluna(m, "Item"), sinistro: coluna(m, "Nº Sinistro"), ocor: coluna(m, "Dt. Ocor."),
    aviso: coluna(m, "Dt. Aviso"), avisado: coluna(m, "Vl. Avisado"), sit: coluna(m, "Situação"), encer: coluna(m, "Dt. Encer."),
    inden: coluna(m, "Vl. Inden."), desp: coluna(m, "Vl. Despesas"), produtor: coluna(m, "Produtor", false),
    cobertura: coluna(m, "Cobertura", false),
  };
  return linhas.slice(1)
    .filter((r) => r.some((v) => v !== null && v !== ""))
    .map((r) => ({
      tipo: texto(r[c.tipo]),
      nosso_numero: inteiro(r[c.nosso]),
      seg: texto(r[c.seg]),
      ramo: texto(r[c.ramo]),
      apolice: texto(r[c.apolice]),
      item: inteiro(r[c.item]),
      numero_sinistro: texto(r[c.sinistro]),
      dt_ocor: data(r[c.ocor]),
      dt_aviso: data(r[c.aviso]),
      vl_avisado: numero(r[c.avisado]),
      situacao: texto(r[c.sit]),
      dt_encer: data(r[c.encer]),
      vl_inden: numero(r[c.inden]),
      vl_despesas: numero(r[c.desp]),
      produtor: c.produtor >= 0 ? texto(r[c.produtor]) : null,
      cobertura: c.cobertura >= 0 ? texto(r[c.cobertura]) : null,
    }));
}

// Mesma padronização de UF/cidade do Power BI (d_Clientes + d_CidadesPad).
export function lerDocumentos(buffer: Uint8Array, cidades: CidadePadrao[]): LinhaDocumento[] {
  const linhas = lerAba(buffer);
  const m = indices(linhas[0] ?? []);
  const c = { nosso: coluna(m, "Nosso Nº"), tipoDoc: coluna(m, "Tipo Doc."), uf: coluna(m, "UF"), cidade: coluna(m, "Cidade") };
  const pad = new Map(cidades.map((x) => [x.uf_cidade_corp, x]));
  const porNosso = new Map<number, LinhaDocumento>();
  for (const r of linhas.slice(1)) {
    const nosso = inteiro(r[c.nosso]);
    if (nosso === null) continue;
    const uf = (texto(r[c.uf]) ?? "").toUpperCase();
    const cidade = texto(r[c.cidade])?.toUpperCase() ?? null;
    // Text.Combine do Power Query ignora o nulo: sem cidade a chave é só a UF.
    const p = pad.get(cidade ? `${uf}_${cidade}` : uf);
    porNosso.set(nosso, {
      nosso_numero: nosso,
      tipo_doc: texto(r[c.tipoDoc]),
      uf: p?.uf ?? (uf || "z_SEM UF"),
      cidade: p?.cidade ?? cidade ?? "z_SEM CIDADE",
    });
  }
  return [...porNosso.values()];
}

export function lerCidades(buffer: Uint8Array): CidadePadrao[] {
  const linhas = lerAba(buffer, "cidades");
  const m = indices(linhas[0] ?? []);
  const c = { chave: coluna(m, "uf_cidade_corp_upper"), uf: coluna(m, "UF_pad"), cidade: coluna(m, "cidade_pad") };
  const porChave = new Map<string, CidadePadrao>();
  for (const r of linhas.slice(1)) {
    const chave = texto(r[c.chave]);
    if (chave) porChave.set(chave, { uf_cidade_corp: chave, uf: texto(r[c.uf]), cidade: texto(r[c.cidade]) });
  }
  return [...porChave.values()];
}
