import type { SupabaseClient } from "@supabase/supabase-js";

// Base Única — vínculos automáticos dos nomes das fontes (Bitrix, planilhas,
// Corp…) com as fichas de imobiliária. Roda sozinho de hora em hora pelo cron
// /api/cron/base-unica-vinculos (pedido do Matheus em 21/10/2026: ligação por
// nome rodando sozinha para os nomes novos, com as mesmas regras de segurança)
// e pelo script scripts/base-unica/vincular.ts (conferência).
//
// 1. LIGA SOZINHO com prova forte (confirmado_por_email = "automatico", é
//    recalculado a cada rodada):
//    - corp_produtor: código Corp = codigo_produtor_corp da ficha; senão CPF/CNPJ igual
//    - receita_cnpj / imobiliarias_conhecidas: CNPJ igual
//    - bitrix_empresa: e-mail exato de UM único destino (@o2seguros não conta)
// 2. SUGERE pelo nome: igual (normalizado) ao de uma ficha ou de um registro já
//    ligado; ou parecido (palavras em comum, até 3 candidatos).
// 3. CONFIRMA a sugestão (confirmado_por_email = "base_unica_nome", não é
//    recalculado depois) quando "nome igual"/"mesmo e-mail" aponta para uma
//    única ficha, ou só para fichas do MESMO grupo (liga na principal: matriz;
//    senão a de mais fontes confirmadas). Nome só parecido, ou igual a fichas
//    de grupos diferentes, fica para revisão no Workspace. Nunca liga a ficha
//    cujo produtor o Power BI centraliza em O2 SEGUROS (Venda direta O2).
// Nunca mexe em vínculo decidido por pessoa ou pelo Power BI (confirmado não
// automático, rejeitado, ignorar). Toda confirmação por nome vai para
// imobiliaria_historico. Só grava as linhas que mudaram.

const FONTES_CONFIRMAR_NOME = new Set(["planilha_fianca", "planilha_re", "planilha_cap", "bitrix_empresa", "bitrix_cap_texto", "corp_produtor"]);

// Mesma normalização de scripts/base-unica/_comum.mjs (tira acento, caixa,
// o que está entre parênteses e as palavras que só dizem o tipo da empresa).
const GENERICAS = new Set([
  "LTDA", "ME", "EPP", "EIRELI", "SA", "S", "A", "DE", "DA", "DO", "DOS", "DAS", "E", "EM",
  "IMOVEIS", "IMOVEL", "IMOBILIARIA", "IMOB", "ADMINISTRACAO", "ADMINISTRADORA", "ADM", "CONSULTORIA", "SERVICOS",
  "CORRETORA", "CORRETOR", "GESTAO", "NEGOCIOS", "PARTICIPACOES", "CONDOMINIOS", "PJ", "PF", "BAS", "BASE", "SUPERLOGICA",
  "ANTIGO", "ANTIGA", "INATIVO", "INATIVA",
]);
const textoBase = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^A-Z0-9&]+/g, " ")
    .trim();
const tokens = (v: unknown) => textoBase(v).split(" ").filter((t) => t && !GENERICAS.has(t));
const chaveNome = (v: unknown) => tokens(v).join(" ");
const somenteDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const extrairEmails = (v: unknown) =>
  [...new Set((String(v ?? "").match(EMAIL_RE) || []).map((e) => e.toLowerCase()))].filter((e) => !/^teste@|@teste\./.test(e));
const ehO2 = (e: string) => /@o2(seguros|grupo)\.com\.br$/.test(e);

type Sugestao = { imobiliaria_id: string; motivo: string; score: number };
type Registro = {
  id: string;
  fonte: string;
  chave_externa: string;
  nome_original: string | null;
  dados: { cpf_cnpj?: string; cnpj?: string; emails?: string[]; codigo_corp_repetido?: boolean } | null;
  situacao: string;
  confirmado_por_email: string | null;
  imobiliaria_id: string | null;
  metodo_vinculo: string | null;
  sugestoes: Sugestao[] | null;
};
type Ficha = {
  id: string;
  nome: string;
  apelido: string | null;
  cnpj: string | null;
  codigo_produtor_corp: string | null;
  email: string | null;
  email_faturas: string[] | null;
  email_repasses: string[] | null;
  email_campanhas: string[] | null;
  receita_razao_social: string | null;
  receita_nome_fantasia: string | null;
  grupo_id: string | null;
  papel_no_grupo: string | null;
};
type Decisao = { imobiliaria_id: string | null; situacao: string; metodo_vinculo: string | null; sugestoes: Sugestao[]; confirmado_por_email: string | null };

export type ResultadoVinculos = {
  gravado: boolean;
  avaliados: number;
  mudancas: number;
  porTipo: Record<string, number>;
  confirmadosPorNome: { fonte: string; nome: string; ficha: string; como: "nome_unico" | "mesmo_grupo" }[];
  revisarGruposDiferentes: number;
  revisarParecido: number;
};

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

export async function vincularAutomaticamente(sb: SupabaseClient, { gravar }: { gravar: boolean }): Promise<ResultadoVinculos> {
  const [fichas, registros] = await Promise.all([
    todos<Ficha>(
      sb,
      "imobiliarias",
      "id, nome, apelido, cnpj, codigo_produtor_corp, email, email_faturas, email_repasses, email_campanhas, receita_razao_social, receita_nome_fantasia, grupo_id, papel_no_grupo",
      (q) => q.order("id")
    ),
    todos<Registro>(sb, "imobiliaria_registros_fonte", "id, fonte, chave_externa, nome_original, dados, situacao, confirmado_por_email, imobiliaria_id, metodo_vinculo, sugestoes", (q) =>
      q.order("id")
    ),
  ]);
  const fichaPorId = new Map(fichas.map((f) => [f.id, f]));

  const porCnpj = new Map<string, string[]>();
  const porCodigo = new Map<string, string[]>();
  for (const f of fichas) {
    const c = somenteDigitos(f.cnpj);
    if (c) porCnpj.set(c, [...(porCnpj.get(c) || []), f.id]);
    if (f.codigo_produtor_corp) {
      const k = String(f.codigo_produtor_corp).trim();
      porCodigo.set(k, [...(porCodigo.get(k) || []), f.id]);
    }
  }
  const porEmail = new Map<string, Set<string>>();
  const addEmail = (e: string, id: string) => {
    if (!ehO2(e)) porEmail.set(e, new Set([...(porEmail.get(e) || []), id]));
  };
  for (const f of fichas) for (const e of extrairEmails([f.email, ...(f.email_faturas || []), ...(f.email_repasses || []), ...(f.email_campanhas || [])].join(" "))) addEmail(e, f.id);

  const travado = (r: Registro) => ["rejeitado", "ignorar"].includes(r.situacao) || (r.situacao === "confirmado" && r.confirmado_por_email !== "automatico");
  const decisao = new Map<string, Decisao>();
  const confirmar = (r: Registro, id: string, metodo: string) =>
    decisao.set(r.id, { imobiliaria_id: id, situacao: "confirmado", metodo_vinculo: metodo, sugestoes: [], confirmado_por_email: "automatico" });

  // 1) Prova forte por CNPJ / código
  for (const r of registros) {
    if (travado(r)) continue;
    if (r.fonte === "corp_produtor") {
      const porCod = porCodigo.get(r.chave_externa.split("#")[0]) || [];
      const porDoc = porCnpj.get(r.dados?.cpf_cnpj || "") || [];
      if (porCod.length === 1 && !r.dados?.codigo_corp_repetido) confirmar(r, porCod[0], "codigo_corp");
      else if (porDoc.length === 1) confirmar(r, porDoc[0], "cnpj");
    } else if (r.fonte === "receita_cnpj" || r.fonte === "imobiliarias_conhecidas") {
      const ids = porCnpj.get(r.fonte === "receita_cnpj" ? r.chave_externa : r.dados?.cnpj || "") || [];
      if (ids.length === 1) confirmar(r, ids[0], "cnpj");
    }
  }
  const vinculoAtual = (r: Registro) => {
    const d = decisao.get(r.id);
    if (d?.situacao === "confirmado") return d.imobiliaria_id;
    return r.situacao === "confirmado" ? r.imobiliaria_id : null;
  };
  for (const r of registros) {
    if (r.fonte !== "corp_produtor") continue;
    const id = vinculoAtual(r);
    if (id) for (const e of r.dados?.emails || []) addEmail(e, id);
  }

  // 2) Bitrix por e-mail exato
  for (const r of registros) {
    if (travado(r) || r.fonte !== "bitrix_empresa") continue;
    const alvos = new Set<string>();
    for (const e of r.dados?.emails || []) for (const id of porEmail.get(e) || []) alvos.add(id);
    if (alvos.size === 1) confirmar(r, [...alvos][0], "email_exato");
    else if (alvos.size > 1)
      decisao.set(r.id, {
        imobiliaria_id: null,
        situacao: "sugerido",
        metodo_vinculo: "email_varios",
        sugestoes: [...alvos].map((id) => ({ imobiliaria_id: id, motivo: "mesmo e-mail", score: 1 })),
        confirmado_por_email: null,
      });
  }

  // 3) Nomes
  const indiceNome = new Map<string, Set<string>>();
  const addNome = (n: unknown, id: string) => {
    const k = chaveNome(n);
    if (k) indiceNome.set(k, new Set([...(indiceNome.get(k) || []), id]));
  };
  for (const f of fichas) [f.nome, f.apelido, f.receita_razao_social, f.receita_nome_fantasia].forEach((n) => addNome(n, f.id));
  for (const r of registros) {
    const id = vinculoAtual(r);
    if (id) addNome(r.nome_original, id);
  }
  const tokensFicha = fichas.map((f) => ({ id: f.id, t: new Set([f.nome, f.apelido, f.receita_nome_fantasia].flatMap(tokens)) }));
  for (const r of registros) {
    if (travado(r) || decisao.has(r.id)) continue;
    const exatos = indiceNome.get(chaveNome(r.nome_original)) || new Set<string>();
    if (exatos.size) {
      decisao.set(r.id, {
        imobiliaria_id: null,
        situacao: "sugerido",
        metodo_vinculo: "nome_exato",
        sugestoes: [...exatos].map((id) => ({ imobiliaria_id: id, motivo: "nome igual", score: 1 })),
        confirmado_por_email: null,
      });
      continue;
    }
    const t = new Set(tokens(r.nome_original));
    const cands: Sugestao[] = [];
    if (t.size)
      for (const f of tokensFicha) {
        const inter = [...t].filter((x) => f.t.has(x)).length;
        const score = inter / Math.max(t.size, Math.min(f.t.size, 4));
        if (inter && score >= 0.5) cands.push({ imobiliaria_id: f.id, motivo: "nome parecido", score: Math.round(score * 100) / 100 });
      }
    cands.sort((a, b) => b.score - a.score);
    decisao.set(
      r.id,
      cands.length
        ? { imobiliaria_id: null, situacao: "sugerido", metodo_vinculo: "nome_parecido", sugestoes: cands.slice(0, 3), confirmado_por_email: null }
        : { imobiliaria_id: null, situacao: "a_identificar", metodo_vinculo: null, sugestoes: [], confirmado_por_email: null }
    );
  }

  // 4) Confirmação por nome (só uma imobiliária possível)
  const fontesPorFicha: Record<string, number> = {};
  for (const r of registros) {
    const id = vinculoAtual(r);
    if (id) fontesPorFicha[id] = (fontesPorFicha[id] ?? 0) + 1;
  }
  const desligadasO2 = new Set(
    registros.filter((r) => r.fonte === "corp_produtor" && r.situacao === "ignorar" && r.metodo_vinculo === "power_bi" && r.imobiliaria_id).map((r) => r.imobiliaria_id!)
  );
  const confirmadosPorNome: ResultadoVinculos["confirmadosPorNome"] = [];
  let revisarGruposDiferentes = 0;
  let revisarParecido = 0;
  for (const r of registros) {
    const d = decisao.get(r.id);
    if (!d || d.situacao !== "sugerido") continue;
    if (!FONTES_CONFIRMAR_NOME.has(r.fonte)) continue;
    const fortes = [...new Set(d.sugestoes.filter((s) => s.motivo === "nome igual" || s.motivo === "mesmo e-mail").map((s) => s.imobiliaria_id))]
      .map((id) => fichaPorId.get(id))
      .filter((f): f is Ficha => !!f);
    if (!fortes.length) {
      revisarParecido++;
      continue;
    }
    if (fortes.some((f) => desligadasO2.has(f.id))) {
      revisarGruposDiferentes++;
      continue;
    }
    let alvo: Ficha | null = null;
    let como: "nome_unico" | "mesmo_grupo" = "nome_unico";
    if (fortes.length === 1) alvo = fortes[0];
    else {
      const grupos = new Set(fortes.map((f) => f.grupo_id));
      if (grupos.size === 1 && !grupos.has(null)) {
        como = "mesmo_grupo";
        alvo = [...fortes].sort(
          (a, b) =>
            Number(b.papel_no_grupo === "matriz") - Number(a.papel_no_grupo === "matriz") ||
            (fontesPorFicha[b.id] ?? 0) - (fontesPorFicha[a.id] ?? 0) ||
            a.nome.localeCompare(b.nome)
        )[0];
      }
    }
    if (!alvo) {
      revisarGruposDiferentes++;
      continue;
    }
    decisao.set(r.id, {
      imobiliaria_id: alvo.id,
      situacao: "confirmado",
      metodo_vinculo: como === "nome_unico" ? "nome_igual_unico" : "nome_igual_mesmo_grupo",
      sugestoes: d.sugestoes,
      confirmado_por_email: "base_unica_nome",
    });
    confirmadosPorNome.push({ fonte: r.fonte, nome: r.nome_original ?? "", ficha: alvo.nome, como });
  }

  // 5) Só o que mudou (o banco guarda as chaves do JSON em outra ordem: compara pelo conteúdo)
  const assinatura = (ss: Sugestao[] | null) => (ss ?? []).map((x) => `${x.imobiliaria_id}|${x.motivo}|${x.score}`).join(";");
  const mudou = registros.filter((r) => {
    const d = decisao.get(r.id);
    if (!d) return false;
    return (
      d.situacao !== r.situacao ||
      (d.imobiliaria_id ?? null) !== (r.imobiliaria_id ?? null) ||
      (d.metodo_vinculo ?? null) !== (r.metodo_vinculo ?? null) ||
      assinatura(d.sugestoes) !== assinatura(r.sugestoes)
    );
  });
  const porTipo: Record<string, number> = {};
  for (const r of mudou) {
    const d = decisao.get(r.id)!;
    const k = `${d.situacao}${d.metodo_vinculo ? ":" + d.metodo_vinculo : ""}`;
    porTipo[k] = (porTipo[k] ?? 0) + 1;
  }
  const resultado: ResultadoVinculos = {
    gravado: gravar,
    avaliados: decisao.size,
    mudancas: mudou.length,
    porTipo,
    confirmadosPorNome,
    revisarGruposDiferentes,
    revisarParecido,
  };
  if (!gravar || !mudou.length) return resultado;

  const agora = new Date().toISOString();
  for (const r of mudou) {
    const d = decisao.get(r.id)!;
    const { error } = await sb
      .from("imobiliaria_registros_fonte")
      .update({
        situacao: d.situacao,
        imobiliaria_id: d.imobiliaria_id,
        metodo_vinculo: d.metodo_vinculo,
        sugestoes: d.sugestoes,
        confirmado_por_email: d.situacao === "confirmado" ? d.confirmado_por_email : null,
        confirmado_em: d.situacao === "confirmado" ? agora : null,
        updated_at: agora,
      })
      .eq("id", r.id);
    if (error) throw new Error("registros: " + error.message);
    if (d.confirmado_por_email === "base_unica_nome") {
      const { error: eh } = await sb.from("imobiliaria_historico").insert({
        imobiliaria_id: d.imobiliaria_id,
        registro_id: r.id,
        campo: "vinculo",
        antes: { situacao: r.situacao, imobiliaria_id: r.imobiliaria_id },
        depois: { situacao: "confirmado", imobiliaria_id: d.imobiliaria_id },
        motivo:
          d.metodo_vinculo === "nome_igual_unico"
            ? `"${r.nome_original}" (${r.fonte}) tem o mesmo nome de uma única ficha`
            : `"${r.nome_original}" (${r.fonte}) tem o mesmo nome de fichas do mesmo grupo`,
        origem: "base_unica",
      });
      if (eh) throw new Error("histórico: " + eh.message);
    }
  }
  const { error: ep } = await sb.rpc("atualizar_producao_painel", { p_forcar: true });
  if (ep) throw new Error("painel: " + ep.message);
  return resultado;
}
