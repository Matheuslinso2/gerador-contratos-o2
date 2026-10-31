// Liga os combinados (erp_combinados_cadastro) à tabela única de imobiliárias e ao documento do ERP, seguindo o guia de fontes:
// só vincula com 1 candidato certo; imobiliária nunca é criada (o que não casa vira sugestão em imobiliaria_registros_fonte).
// Ensaio por padrão; --gravar grava (só nas colunas imobiliaria_id / documento_id / ligacao e nos registros de fonte).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/combinados-ligar.ts [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { documentosDoNome, normNome } from "@/lib/erp/tarefaCadastro";

const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();
const FONTE = "tarefa_bitrix_cadastro";
const norm = (s: string) => normNome(s).replace(/\b(LTDA|ME|EPP|S A|SA|IMOVEIS|IMOBILIARIA|IMOBILIARIAS|ADMINISTRADORA|EMPREENDIMENTOS|GESTAO|NEGOCIOS)\b/g, " ").replace(/\s+/g, " ").trim();
const NAO_E_IMOB = /^(ENDOSSO|INDIVIDUAL|NOVOS?|RENOVA|AUTO|BIKE|RESIDENCIAL)/i;

async function todas<T>(tabela: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from(tabela).select(cols).range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  // ---------------------------------------------------------------- 1) imobiliárias
  const imobs = await todas<{ id: string; nome: string | null; apelido: string | null; receita_nome_fantasia: string | null; receita_razao_social: string | null }>("imobiliarias", "id,nome,apelido,receita_nome_fantasia,receita_razao_social");
  const fontes = await todas<{ nome_original: string | null; imobiliaria_id: string | null; situacao: string }>("imobiliaria_registros_fonte", "nome_original,imobiliaria_id,situacao");
  const mapa = new Map<string, Set<string>>(); // nome normalizado -> ids de imobiliária
  const add = (n: string | null, id: string | null) => { if (!n || !id) return; const k = norm(n); if (k.length < 3) return; (mapa.get(k) ?? mapa.set(k, new Set()).get(k)!).add(id); };
  for (const i of imobs) for (const n of [i.nome, i.apelido, i.receita_nome_fantasia, i.receita_razao_social]) add(n, i.id);
  for (const f of fontes) if (f.situacao === "confirmado") add(f.nome_original, f.imobiliaria_id);

  const { data: cb, error } = await sb.from("erp_combinados_cadastro").select("id,imobiliaria_nome").not("imobiliaria_nome", "is", null);
  if (error) throw new Error(error.message);
  const porNome = new Map<string, string[]>();
  for (const c of cb ?? []) (porNome.get(c.imobiliaria_nome!) ?? porNome.set(c.imobiliaria_nome!, []).get(c.imobiliaria_nome!)!).push(c.id);

  const res = { ligado: 0, ligadoCombinados: 0, ambiguo: 0, sugerido: 0, semCandidato: 0, naoEImob: 0, combAmbiguo: 0, combSug: 0, combSem: 0 };
  const registros: any[] = []; const ligar = new Map<string, string[]>(); // imobiliaria_id -> ids de combinado
  for (const [nome, ids] of porNome) {
    const k = norm(nome);
    if (NAO_E_IMOB.test(nome.trim())) { res.naoEImob++; continue; }
    const exato = mapa.get(k);
    if (exato?.size === 1) {
      const id = [...exato][0]; res.ligado++; res.ligadoCombinados += ids.length;
      (ligar.get(id) ?? ligar.set(id, []).get(id)!).push(...ids);
      registros.push({ fonte: FONTE, chave_externa: k, nome_original: nome, imobiliaria_id: id, situacao: "confirmado", metodo_vinculo: "nome_igual_unico", volume: ids.length, sugestoes: [] });
    } else if (exato && exato.size > 1) {
      res.ambiguo++; res.combAmbiguo += ids.length;
      registros.push({ fonte: FONTE, chave_externa: k, nome_original: nome, imobiliaria_id: null, situacao: "a_identificar", metodo_vinculo: null, volume: ids.length, sugestoes: [...exato].slice(0, 5) });
    } else {
      // parecido: todas as palavras do nome aparecem no nome de uma só imobiliária
      const toks = k.split(" ").filter((t) => t.length >= 3);
      const cand = new Set<string>();
      if (toks.length) for (const [n, s] of mapa) if (toks.every((t) => n.split(" ").includes(t))) for (const id of s) cand.add(id);
      if (cand.size >= 1 && cand.size <= 3) { res.sugerido++; res.combSug += ids.length; registros.push({ fonte: FONTE, chave_externa: k, nome_original: nome, imobiliaria_id: null, situacao: "sugerido", metodo_vinculo: "nome_parecido", volume: ids.length, sugestoes: [...cand] }); }
      else { res.semCandidato++; res.combSem += ids.length; registros.push({ fonte: FONTE, chave_externa: k, nome_original: nome, imobiliaria_id: null, situacao: "a_identificar", metodo_vinculo: null, volume: ids.length, sugestoes: [] }); }
    }
  }
  console.log(`IMOBILIÁRIAS (${porNome.size} nomes): ligados ${res.ligado} (${res.ligadoCombinados} combinados) | ambíguos ${res.ambiguo} (${res.combAmbiguo}) | sugeridos ${res.sugerido} (${res.combSug}) | sem candidato ${res.semCandidato} (${res.combSem}) | não é imobiliária ${res.naoEImob}`);

  // ---------------------------------------------------------------- 2) documentos
  const { data: cs, error: e2 } = await sb.from("erp_combinados_cadastro").select("id,setor,segurado_nome,seg_numero,vigencia_ini,vigencia_fim,numero_endosso").is("documento_id", null);
  if (e2) throw new Error(e2.message);
  const dig = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  const doc = { porProposta: 0, porApolice: 0, porNomeVig: 0, ambiguo: 0, nenhum: 0, semDados: 0 };
  const docLig: { id: string; documento_id: string; ligacao: string }[] = [];
  let feitos = 0;
  for (const c of cs ?? []) {
    if (++feitos % 300 === 0) console.log(`  documentos ${feitos}/${cs!.length}`);
    // 2a) pelo SEG: (proposta ou apólice, só dígitos), 1 candidato
    if (c.seg_numero && dig(c.seg_numero).length >= 5) {
      const d = dig(c.seg_numero);
      for (const [col, tag] of [["numero_proposta", "proposta"], ["numero_apolice", "apolice"]] as const) {
        const { data } = await sb.from("erp_documentos").select("id").eq(col, c.seg_numero.trim()).limit(3);
        const ach = data?.length ? data : (await sb.from("erp_documentos").select("id").like(col, `%${d}`).limit(3)).data;
        if (ach?.length === 1) { docLig.push({ id: c.id, documento_id: ach[0].id, ligacao: tag }); tag === "proposta" ? doc.porProposta++ : doc.porApolice++; break; }
        if (ach && ach.length > 1) { doc.ambiguo++; break; }
      }
      if (docLig.at(-1)?.id === c.id) continue;
    }
    // 2b) por nome + vigência (±5 dias), 1 candidato
    if (c.segurado_nome && c.vigencia_ini) {
      const docs = await documentosDoNome(sb, c.segurado_nome);
      const perto = docs.filter((d) => d.vigencia_inicio && Math.abs(Date.parse(d.vigencia_inicio) - Date.parse(c.vigencia_ini!)) <= 5 * 864e5);
      if (perto.length === 1) { docLig.push({ id: c.id, documento_id: perto[0].id, ligacao: "nome+vigencia" }); doc.porNomeVig++; }
      else if (perto.length > 1) doc.ambiguo++; else doc.nenhum++;
    } else doc.semDados++;
  }
  console.log(`DOCUMENTOS (${cs?.length} combinados sem vínculo): por proposta ${doc.porProposta} | por apólice ${doc.porApolice} | nome+vigência ${doc.porNomeVig} | ambíguo ${doc.ambiguo} | nenhum ${doc.nenhum} | sem nome/vigência para buscar ${doc.semDados}`);

  if (!GRAVAR) { console.log("ENSAIO: nada gravado"); return; }
  // ---------------------------------------------------------------- gravação
  const unicos = [...new Map(registros.map((r) => [r.fonte + "|" + r.chave_externa, r])).values()];
  for (let i = 0; i < unicos.length; i += 100) {
    const { error: e } = await sb.from("imobiliaria_registros_fonte").upsert(unicos.slice(i, i + 100), { onConflict: "fonte,chave_externa" });
    if (e) throw new Error("registros_fonte: " + e.message);
  }
  for (const [imobId, ids] of ligar) for (let i = 0; i < ids.length; i += 200) {
    const { error: e } = await sb.from("erp_combinados_cadastro").update({ imobiliaria_id: imobId }).in("id", ids.slice(i, i + 200));
    if (e) throw new Error("imobiliaria_id: " + e.message);
  }
  for (const l of docLig) {
    const { error: e } = await sb.from("erp_combinados_cadastro").update({ documento_id: l.documento_id, ligacao: l.ligacao }).eq("id", l.id);
    if (e) throw new Error("documento_id: " + e.message);
  }
  console.log(`GRAVADO: ${registros.length} registros de fonte, ${res.ligadoCombinados} combinados com imobiliária, ${docLig.length} com documento`);
})();
