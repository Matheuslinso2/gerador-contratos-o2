// Base Única — enriquecimento das linhas de planilha (Fiança e Ramos Elementares) com campos que a importação não lia:
// endereço, BAIRRO, CIDADE, CEP, IPTU, condomínio, m², ocupação, % do aluguel (e o ALUGUEL, quando estava vazio).
// NÃO muda o que já está no banco: o que já existe em `extras` vence e o aluguel só entra se estava vazio (função producao_enriquecer).
// Casa por arquivo + aba + linha da planilha, lendo as CÓPIAS CONGELADAS (nunca o Drive ao vivo). Antes de gravar, confere o aluguel da planilha
// com o do banco nas linhas casadas: se a concordância for baixa, o arquivo é PULADO (numeração de linhas diferente).
// uso: node scripts/base-unica/enriquecer-planilhas.mjs [--anos 2025,2026] [--re] [--gravar]
//   Fiança: pastas dos anos pedidos (xlsx/xlsm, abas ANALISES/PROCESSO...).  --re: planilhas "COTAÇÃO DIÁRIA RE" (abas NOVOS MÊS / NOVOS PENDENTES).
import { supabase, buscarTudo } from "./_comum.mjs";
import { listarCopias, abrirCopia, acharCabecalho, norm } from "./_copias.mjs";

const gravar = process.argv.includes("--gravar");
const comRE = process.argv.includes("--re");
const iAnos = process.argv.indexOf("--anos");
const anos = iAnos >= 0 ? process.argv[iAnos + 1].split(",") : ["2025", "2026"];

// ---------- extração do bairro do endereço "Rua X, 123 - compl - BairroCidade - RJ, 22222-222" ----------
const CIDADES_BASE = ["Rio de Janeiro", "Niterói", "Niteroi", "Cabo Frio", "Mesquita", "Rio das Ostras", "Nova Iguaçu", "Nova Iguacu", "Duque de Caxias", "São Gonçalo", "Sao Goncalo", "Macaé", "Macae", "Petrópolis", "Petropolis", "São João de Meriti", "Belford Roxo", "Nilópolis", "Itaboraí", "Maricá", "Marica", "Búzios", "Armação dos Búzios", "Arraial do Cabo", "São Pedro da Aldeia", "Araruama", "Saquarema", "Casimiro de Abreu", "Magé", "Queimados", "Seropédica", "Itaguaí", "Angra dos Reis", "Teresópolis", "Volta Redonda", "Barra Mansa", "Resende", "Campos dos Goytacazes", "Iguaba Grande", "Cachoeiras de Macacu", "Tanguá", "Japeri", "Paracambi", "Guapimirim"];
const { data: br } = await supabase.from("bairros_regioes").select("cidade");
const CIDADES = [...new Set([...CIDADES_BASE, ...(br ?? []).map((r) => r.cidade).filter(Boolean)])].sort((a, b) => b.length - a.length);

function parseEndereco(bruto) {
  let e = String(bruto ?? "").replace(/\s+/g, " ").trim();
  if (!e) return null;
  const cepM = e.match(/(\d{5})-?(\d{3})\s*$/);
  const cep = cepM ? `${cepM[1]}${cepM[2]}` : null;
  e = e.replace(/,?\s*\d{5}-?\d{3}\s*$/, "").replace(/\s*-\s*[A-Z]{2}\s*$/, "");
  const ult = e.split(" - ").pop().trim();
  let bairro = null, cidade = null;
  if (ult.includes(",")) {
    const i = ult.lastIndexOf(",");
    bairro = ult.slice(0, i).trim();
    cidade = ult.slice(i + 1).trim();
  } else {
    const ult2 = ult;
    const achada = CIDADES.find((c) => ult2.toLowerCase().endsWith(c.toLowerCase()) && ult2.length > c.length);
    if (achada) {
      cidade = ult2.slice(ult2.length - achada.length);
      bairro = ult2.slice(0, ult2.length - achada.length).trim();
    }
  }
  if (!bairro || bairro.length < 3 || /\d/.test(bairro) || bairro.length > 45) bairro = null;
  return { bairro, cidade: cidade && cidade.length <= 40 ? cidade : null, cep };
}

const num = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v).replace(/R\$|\s/g, "");
  if (!/\d/.test(s) || /#/.test(s)) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const txt = (v) => (v == null || v instanceof Date ? "" : String(v).replace(/\s+/g, " ").trim());

async function linhasDoBanco(arquivoId, aba) {
  return buscarTudo("producao_unificada", "origem_linha, aluguel", (q) => q.eq("fonte", "planilha").eq("origem_arquivo_id", arquivoId).eq("origem_aba", aba).order("origem_linha"));
}

const copias = (await listarCopias()).filter((c) => /\.(xlsx|xlsm)$/i.test(c.nome) || c.mime_type?.includes("spreadsheet"));
const alvo = copias.filter((c) => {
  const nome = norm(c.nome);
  if (/TITULOS NOVOS|PADRAO|SIMULADOR|ESTUDO/.test(nome)) return false;
  if (/COTACAO DIARIA RE/.test(norm(`${c.pasta} ${c.nome}`))) return comRE;
  return anos.includes(String(c.pasta));
});
console.log(`${gravar ? "GRAVANDO" : "SIMULAÇÃO"} · arquivos: ${alvo.length} · anos ${anos.join(",")}${comRE ? " + RE" : ""}`);

let totalCasadas = 0, totalGravadas = 0;
for (const c of alvo.sort((a, b) => String(a.pasta + a.nome).localeCompare(b.pasta + b.nome))) {
  let abas;
  try {
    abas = await abrirCopia(c, { linhas: 20000, bruto: true });
  } catch (e) {
    console.log(`  ${c.nome}: erro ao abrir (${e.message.slice(0, 80)})`);
    continue;
  }
  for (const [nomeAba, linhas] of abas) {
    const cab = acharCabecalho(linhas.map((l) => (l || []).map((x) => (x instanceof Date ? "" : x))), /^(IMOBILI|INICIANTE$)/);
    if (!cab) continue;
    const k = (re) => cab.colunas.findIndex((x) => re.test(x));
    const col = {
      end: k(/^ENDERECO$/), logr: k(/^LOGRADOURO$/), bairro: k(/^BAIRRO$/), cidade: k(/^CIDADE$/), cep: k(/^CEP$/), aluguel: k(/^ALUGUEL$/), m2: k(/^M[²2]$/),
      ocup: k(/^OCUPACAO$/), pctAlug: k(/^% DO ALUGUEL$/), iptu: k(/^IPTU$/), cond: k(/^COND(OMINIO)?$/), numero: k(/^NUMERO$/), compl: k(/^COMPLEMENTO$/),
    };
    if (col.end < 0 && col.logr < 0 && col.bairro < 0 && col.aluguel < 0 && col.iptu < 0) continue;
    const noBanco = await linhasDoBanco(c.arquivo_id, nomeAba);
    if (!noBanco.length) continue;
    const porLinha = new Map(noBanco.map((r) => [r.origem_linha, r.aluguel]));
    const lote = [];
    let comparaveis = 0, iguais = 0, comBairro = 0, comEnd = 0;
    linhas.slice(cab.indice + 1).forEach((l, i) => {
      const linhaPlanilha = cab.indice + 2 + i;
      if (!porLinha.has(linhaPlanilha)) return;
      const g = (ix) => (ix >= 0 ? l?.[ix] : null);
      const aluguel = num(g(col.aluguel));
      const dbAlug = porLinha.get(linhaPlanilha);
      if (aluguel != null && dbAlug != null) { comparaveis++; if (Math.abs(Number(dbAlug) - aluguel) < 0.02) iguais++; }
      const patch = {};
      const endereco = col.end >= 0 ? txt(g(col.end)) : [txt(g(col.logr)), [txt(g(col.numero)), txt(g(col.compl))].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
      if (endereco) { patch.endereco = endereco; comEnd++; }
      let bairro = txt(g(col.bairro)), cidade = txt(g(col.cidade)), cep = txt(g(col.cep)).replace(/\D/g, "");
      if ((!bairro || !cidade) && endereco && col.end >= 0) {
        const p = parseEndereco(endereco);
        if (p) { bairro = bairro || p.bairro || ""; cidade = cidade || p.cidade || ""; cep = cep || p.cep || ""; }
      }
      if (bairro) { patch.bairro = bairro.toUpperCase(); comBairro++; }
      if (cidade) patch.cidade_endereco = cidade.toUpperCase();
      if (cep.length === 8) patch.cep = cep;
      const iptu = num(g(col.iptu)); if (iptu != null) patch.iptu = iptu;
      const cond = num(g(col.cond)); if (cond != null) patch.condominio = cond;
      const m2 = num(g(col.m2)); if (m2 != null) patch.m2 = m2;
      const ocup = txt(g(col.ocup)); if (ocup) patch.ocupacao = ocup.toUpperCase();
      const pct = num(g(col.pctAlug)); if (pct != null) patch.pct_do_aluguel = pct;
      if (Object.keys(patch).length || aluguel != null) lote.push({ arquivo_id: c.arquivo_id, aba: nomeAba, linha: linhaPlanilha, patch, aluguel });
    });
    if (!lote.length) continue;
    const concord = comparaveis ? iguais / comparaveis : null;
    const ok = concord == null || concord >= 0.85;
    totalCasadas += lote.length;
    console.log(`  ${String(c.pasta).trim().padEnd(14)} ${c.nome.slice(0, 34).padEnd(35)} ${nomeAba.slice(0, 14).padEnd(15)} linhas casadas ${String(lote.length).padStart(4)}/${noBanco.length} · bairro ${comBairro} · endereço ${comEnd} · aluguel confere ${concord == null ? "n/a" : Math.round(concord * 100) + "%"}${ok ? "" : "  → PULADO (numeração difere)"}`);
    if (gravar && ok) {
      for (let i = 0; i < lote.length; i += 400) {
        const { data, error } = await supabase.rpc("producao_enriquecer", { p_lote: lote.slice(i, i + 400) });
        if (error) throw new Error(error.message);
        totalGravadas += data ?? 0;
      }
    }
  }
}
console.log(`\nlinhas casadas: ${totalCasadas}${gravar ? ` · atualizadas no banco: ${totalGravadas}` : " (simulação: nada gravado)"}`);
