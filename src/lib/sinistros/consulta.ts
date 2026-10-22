import { lista } from "./periodo";

// Lista da Gestão de sinistros -- a mesma consulta alimenta a Gestão (quadro
// e lista) e o "anterior / próximo" da ficha, para o operador andar pelos
// casos na mesma ordem e com os mesmos filtros (21/10/2026).

/* eslint-disable @typescript-eslint/no-explicit-any -- linhas do Supabase sem tipos gerados */

export const CAMPOS_GESTAO =
  "id, codigo, produto, origem, locador_nome, data_abertura_seguradora, enviado_em, created_at, tipo, etapa, seguradora, numero_apolice, nosso_numero, locatario_nome, imovel_logradouro, imovel_numero, imovel_complemento, data_primeiro_vencimento, data_segundo_vencimento, data_entrega_chaves, prazo_aviso, aviso_fora_prazo, valor_avisado, responsavel_o2, pre_analise_desde, pendencia_prazo, documentacao_completa_em, numero_sinistro_seguradora, proxima_acao_em, proxima_acao_descricao, updated_at, numero_aviso, ultima_msg_imob_em, ultimo_doc_imob_em, visto_o2_em, imobiliarias(nome, apelido)";

// Selos da Gestão: mensagem no chat / documento novo da imobiliária que a O2
// ainda não viu (a ficha marca visto_o2_em ao abrir).
export function novidadesImobiliaria(s: any) {
  const visto = s.visto_o2_em ?? "";
  return { mensagem: !!s.ultima_msg_imob_em && s.ultima_msg_imob_em > visto, documento: !!s.ultimo_doc_imob_em && s.ultimo_doc_imob_em > visto };
}

export const ORDENS = [
  { chave: "agenda", rotulo: "Próxima ação (atrasadas primeiro)" },
  { chave: "antigos", rotulo: "Mais antigos primeiro" },
  { chave: "valor", rotulo: "Maior valor avisado" },
  { chave: "recentes", rotulo: "Mexidos recentemente" },
] as const;

export const ETAPAS_ABERTAS = ["pre_analise", "pendencia_imobiliaria", "na_seguradora", "em_indenizacao", "acordo_judicial"];

type Params = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function dataDoAviso(s: any): string | null {
  return s.enviado_em?.slice(0, 10) ?? s.data_abertura_seguradora ?? s.created_at?.slice(0, 10) ?? null;
}

export async function listarSinistros(supabase: any, parametros: Params, opcoes: { interno: boolean; userEmail: string | null | undefined }) {
  const { interno, userEmail } = opcoes;
  const [q, resp, encerrados, imob, ordem, etapa] = ["q", "resp", "encerrados", "imob", "ordem", "etapa"].map((k) => um(parametros[k]));
  const produtos = lista(parametros.prod);
  const seguradoras = lista(parametros.seg);

  let consulta = supabase.from("sinistros").select(CAMPOS_GESTAO).limit(1000);
  if (encerrados !== "1") consulta = consulta.not("etapa", "in", "(cancelado,encerrado)");
  if (interno && produtos.length) consulta = consulta.in("produto", produtos);
  if (interno && seguradoras.length) consulta = consulta.in("seguradora", seguradoras);
  if (interno && etapa) consulta = consulta.eq("etapa", etapa);
  if (interno && resp === "meus") consulta = consulta.eq("responsavel_o2", userEmail ?? "-");
  else if (interno && resp === "sem") consulta = consulta.is("responsavel_o2", null);
  else if (interno && resp) consulta = consulta.eq("responsavel_o2", resp);

  // Imobiliária/grupo vindo do dashboard: i:<imobiliaria> · g:<grupo> · t:<texto do Corp>.
  let nomeFiltroImob: string | null = null;
  if (interno && imob) {
    const { data: g } = await supabase.from("sinistros_kpi_grupos").select("nome").eq("chave", imob).maybeSingle();
    nomeFiltroImob = g?.nome ?? imob;
    if (imob.startsWith("i:")) consulta = consulta.eq("imobiliaria_id", imob.slice(2));
    else if (imob.startsWith("g:")) {
      const { data: membros } = await supabase.from("imobiliarias").select("id").eq("grupo_id", imob.slice(2));
      consulta = consulta.in("imobiliaria_id", (membros ?? []).map((m: any) => m.id).concat("00000000-0000-0000-0000-000000000000"));
    } else {
      // Card trazido do Corp sem imobiliária ligada: acha pelo produtor (texto) da apólice.
      const { data: ids } = await supabase
        .from("sinistros_kpi_fato")
        .select("id")
        .eq("origem", "workspace")
        .eq("grupo_chave", imob);
      consulta = consulta.in("id", (ids ?? []).map((r: any) => r.id).concat("00000000-0000-0000-0000-000000000000"));
    }
  }

  const { data } = await consulta;
  let sinistros = (data ?? []) as any[];
  if (q) {
    const termo = q.toLowerCase();
    sinistros = sinistros.filter((s) =>
      [
        s.locatario_nome, s.locador_nome, s.numero_apolice, s.nosso_numero, s.numero_sinistro_seguradora, `sin-${s.codigo}`,
        s.imovel_logradouro, s.imobiliarias?.nome, s.imobiliarias?.apelido,
      ]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(termo))
    );
  }

  const chave = (ordem as string) || "agenda";
  const porData = (a: string | null, b: string | null) => (a ?? "9999").localeCompare(b ?? "9999");
  sinistros.sort((a, b) => {
    if (chave === "antigos") return porData(dataDoAviso(a), dataDoAviso(b));
    if (chave === "valor") return (Number(b.valor_avisado) || 0) - (Number(a.valor_avisado) || 0);
    if (chave === "recentes") return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    // agenda: com próxima ação (mais antiga primeiro), depois sem agenda pelos mais antigos.
    return porData(a.proxima_acao_em, b.proxima_acao_em) || porData(dataDoAviso(a), dataDoAviso(b));
  });

  return { sinistros, nomeFiltroImob, produtos, seguradoras, resp, q, encerrados, imob, ordem: chave, etapa };
}
