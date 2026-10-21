// Base Única — títulos NOVOS de Capitalização das planilhas do setor,
// jul/2021 → jul/2026 (a partir de ago/2026 os títulos estão no Bitrix, SPA
// 1048 — ver bitrixProdutos.ts). Lê as CÓPIAS CONGELADAS (bucket
// planilhas-congeladas), só a aba NOVOS (ASS ELETRÔNICA, ASSIST. LOCATÍCIA,
// RENOVAÇÃO e RESGATE não são títulos novos).
// Formatos (21/10/2026):
//  - jul/2021–ago/2023: uma planilha por mês "<MÊS>_<ANO> - CAPITALIZAÇÃO.xlsm"
//  - jul/2023 → 2026: uma planilha por ano "TÍTULOS NOVOS <ANO>.xlsm", coluna MÊS
// Régua do painel /capitalizacao: EMITIDO e BOLETO_PAGO = efetivado
// (convertido); DESIST_LOCAÇÃO / DESISTÊNCIA / CANCELADO = perdido;
// PROPOSTA_ENVIADA / RETRANSMITIDA = em andamento. Mês = o mês em que o setor
// lançou o título (nome da planilha mensal ou coluna MÊS da anual).
// O mesmo título lançado de novo num mês seguinte (até 3 meses, mesmo CPF)
// é o mesmo caso (herança); o mesmo mês em duas planilhas (cópias repetidas,
// jul–ago/2023 na mensal e na anual) vale uma vez só, com o status mais
// avançado. Nome e CPF do titular só servem para ligar o caso (não são gravados).
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/base-unica/importar-planilhas-cap.ts [--gravar]
process.loadEnvFile(".env.local");
import crypto from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { listarCopias, abrirCopia, acharCabecalho, norm } from "./_copias.mjs";

const gravar = process.argv.includes("--gravar");
const FIM = "2026-07"; // ago/2026 em diante: Bitrix
const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
// Cópia parcial: "JULHO_2021 - CAPITALIZAÇÃO.xlsm" tem 17 dos 28 títulos de
// "JULHO_2021 - CAPITALIZAÇÃO (2).xlsm" — vale a completa.
const IGNORAR = /^JULHO_2021 - CAPITALIZACAO\.XLSM$/;

type Copia = { arquivo_id: string; nome: string; pasta: string; copia_storage_path: string | null };
type Titulo = {
  comp: string;
  arquivoId: string;
  arquivoNome: string;
  linha: number;
  chave: string; // CPF (ou nome) do titular — só para ligar
  status: string;
  imobiliaria: string;
  solicitadoPor: string;
  seguradora: string;
  valor: number;
  comissao: number;
  dataSolicitacao: string | null;
  dataPagamento: string | null;
  motivo: string;
};

const txt = (v: unknown) => (v == null ? "" : String(v).trim());
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
// Datas da cópia xlsx: meia-noite de Brasília (03:00 UTC).
const dia = (v: unknown) => (v instanceof Date && !isNaN(v.getTime()) ? new Date(v.getTime() - 3 * 3600_000).toISOString().slice(0, 10) : null);
const somarMes = (m: string, n: number) => {
  const [a, mm] = m.split("-").map(Number);
  const t = a * 12 + mm - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const statusPadrao = (s: string) =>
  /^(EMITIDO|BOLETO_PAGO)$/.test(s) ? "Convertido" : /^(DESIST|CANCELADO)/.test(s) ? "Perdido" : "Em análise";
const RANK: Record<string, number> = { "Em análise": 0, Perdido: 1, Convertido: 2 };

async function lerTitulos(): Promise<{ titulos: Titulo[]; arquivos: Map<string, { nome: string; pasta: string; comps: Set<string> }> }> {
  const copias = ((await listarCopias()) as Copia[]).filter(
    (c) => c.copia_storage_path && /CAPITALIZACAO\.XLSM$|CAPITALIZACAO \(\d\)\.XLSM$|^TITULOS NOVOS \d{4}/.test(norm(c.nome)) && !IGNORAR.test(norm(c.nome))
  );
  const titulos: Titulo[] = [];
  const arquivos = new Map<string, { nome: string; pasta: string; comps: Set<string> }>();
  for (const c of copias) {
    const n = norm(c.nome);
    const mensal = n.match(/^(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)_(\d{4})/);
    const anual = n.match(/^TITULOS NOVOS (\d{4})/);
    const abas = (await abrirCopia(c, { linhas: 5000, bruto: true })) as [string, unknown[][]][];
    const aba = abas.find(([nome]) => norm(nome) === "NOVOS");
    if (!aba) throw new Error(`${c.nome}: sem aba NOVOS`);
    const cab = acharCabecalho(aba[1], /^IMOBILI/);
    if (!cab) throw new Error(`${c.nome}: sem cabeçalho`);
    const col = (re: RegExp) => cab.colunas.findIndex((x: string) => re.test(x));
    const i = {
      imob: col(/^IMOBILI/),
      por: col(/^SOLICITADO/),
      mes: col(/^MES$/),
      data: col(/^DATA SOLICITACAO/),
      titular: col(/^TITULAR/),
      cpf: col(/^CPF/),
      seguradora: col(/^SEGURADORA$/),
      status: col(/^STATUS$/),
      pagamento: col(/^DATA (PAGAMENTO TITULO|EMISSAO)/),
      motivo: col(/^MOTIVO/),
      valor: col(/^VALOR$/),
      comissao: col(/^R\$ COMISSAO/),
    };
    const info = { nome: c.nome.trim(), pasta: c.pasta, comps: new Set<string>() };
    arquivos.set(c.arquivo_id, info);
    aba[1].slice(cab.indice + 1).forEach((l, k) => {
      const status = norm(l?.[i.status]).replace(/\s+/g, "_");
      const titular = norm(l?.[i.titular]);
      if (!status || !titular) return;
      let comp: string | null = null;
      if (mensal) comp = `${mensal[2]}-${String(MESES.indexOf(mensal[1]) + 1).padStart(2, "0")}`;
      else if (anual) {
        const m = MESES.indexOf(norm(l?.[i.mes]));
        const d = dia(l?.[i.data]);
        comp = m >= 0 ? `${anual[1]}-${String(m + 1).padStart(2, "0")}` : d ? d.slice(0, 7) : null;
      }
      if (!comp || comp > FIM) return;
      const cpf = txt(l?.[i.cpf]).replace(/\D/g, "");
      info.comps.add(comp);
      titulos.push({
        comp,
        arquivoId: c.arquivo_id,
        arquivoNome: info.nome,
        linha: cab.indice + 2 + k,
        chave: cpf.length >= 11 ? cpf : titular,
        status,
        imobiliaria: txt(l?.[i.imob]).replace(/\s+/g, " ").toUpperCase(),
        solicitadoPor: i.por >= 0 ? txt(l?.[i.por]) : "",
        seguradora: i.seguradora >= 0 ? txt(l?.[i.seguradora]).toUpperCase() : "",
        valor: numero(l?.[i.valor]),
        comissao: numero(l?.[i.comissao]),
        dataSolicitacao: dia(l?.[i.data]),
        dataPagamento: i.pagamento >= 0 ? dia(l?.[i.pagamento]) : null,
        motivo: i.motivo >= 0 ? txt(l?.[i.motivo]) : "",
      });
    });
  }
  return { titulos, arquivos };
}

async function main() {
  const sb = createServiceClient();
  const { titulos, arquivos } = await lerTitulos();
  // 1) Mesmo mês em mais de uma planilha: vale uma vez, com o status mais avançado.
  const porComp = new Map<string, Titulo[]>();
  for (const t of titulos) porComp.set(t.comp, [...(porComp.get(t.comp) ?? []), t]);
  let repetidos = 0;
  const unicos: Titulo[] = [];
  for (const [, lista] of [...porComp].sort(([a], [b]) => a.localeCompare(b))) {
    const arqs = new Set(lista.map((t) => t.arquivoId));
    if (arqs.size === 1) {
      unicos.push(...lista);
      continue;
    }
    const escolhido = new Map<string, Titulo[]>();
    for (const t of lista) escolhido.set(t.chave, [...(escolhido.get(t.chave) ?? []), t]);
    for (const grupo of escolhido.values()) {
      // Na mesma planilha, repetição é título distinto; entre planilhas, é cópia.
      const porArq = new Map<string, Titulo[]>();
      for (const t of grupo) porArq.set(t.arquivoId, [...(porArq.get(t.arquivoId) ?? []), t]);
      const melhor = [...porArq.values()].sort(
        (a, b) => b.length - a.length || Math.max(...b.map((t) => RANK[statusPadrao(t.status)])) - Math.max(...a.map((t) => RANK[statusPadrao(t.status)]))
      )[0];
      repetidos += grupo.length - melhor.length;
      unicos.push(...melhor);
    }
  }
  // 2) Linha do tempo: mesmo titular de novo em até 3 meses = mesmo caso (herdada).
  unicos.sort((a, b) => a.comp.localeCompare(b.comp) || a.linha - b.linha);
  const ultimo = new Map<string, { comp: string; caso: string; valor: number }>();
  const contador = new Map<string, number>();
  const linhas: (Record<string, unknown> & { _arquivo: string })[] = [];
  const noMes = new Map<string, Set<string>>();
  for (const t of unicos) {
    const ant = ultimo.get(t.chave);
    const vistosMes = noMes.get(t.comp) ?? new Set<string>();
    noMes.set(t.comp, vistosMes);
    let caso: string;
    let herdada = false;
    if (ant && ant.comp < t.comp && somarMes(ant.comp, 3) >= t.comp && Math.round(ant.valor) === Math.round(t.valor) && !vistosMes.has(ant.caso)) {
      caso = ant.caso;
      herdada = true;
    } else {
      const n = (contador.get(t.chave) ?? 0) + 1;
      contador.set(t.chave, n);
      caso = crypto.createHash("sha1").update(`cap|${t.chave}|${n}`).digest("hex");
    }
    vistosMes.add(caso);
    ultimo.set(t.chave, { comp: t.comp, caso, valor: t.valor });
    const sp = statusPadrao(t.status);
    linhas.push({
      _arquivo: t.arquivoId,
      produto: "capitalizacao",
      tipo: "novo",
      fonte: "planilha",
      origem_arquivo_id: t.arquivoId,
      origem_aba: "NOVOS",
      origem_linha: t.linha,
      competencia_arquivo: t.comp,
      herdada,
      chave_caso: caso,
      data_recebimento: t.dataSolicitacao,
      data_efetivacao: sp === "Convertido" ? t.dataPagamento : null,
      status_original: t.status,
      status_padrao: sp,
      seguradora: t.seguradora || null,
      imobiliaria_texto: t.imobiliaria || null,
      fonte_vinculo: t.imobiliaria ? "planilha_cap" : null,
      responsavel: t.solicitadoPor || null,
      premio: sp === "Convertido" && t.valor ? t.valor : null,
      comissao: sp === "Convertido" && t.comissao ? t.comissao : null,
      extras: { valor_titulo: t.valor || null, motivo_desistencia: t.motivo || null },
    });
  }

  // Vale o desfecho atual do título (regra dos painéis: o estado atual é o mais
  // avançado): desistiu num mês e foi emitido no seguinte = convertido só no
  // seguinte. O desfecho anterior fica guardado em extras.status_revisto.
  const finalDoCaso = new Map<string, string>();
  for (const l of linhas) finalDoCaso.set(l.chave_caso as string, l.status_padrao as string);
  let revistos = 0;
  for (const l of linhas) {
    const fim = finalDoCaso.get(l.chave_caso as string);
    if (l.status_padrao !== "Em análise" && l.status_padrao !== fim) {
      l.extras = { ...(l.extras as object), status_revisto: l.status_padrao };
      l.status_padrao = "Em análise";
      l.premio = null;
      l.comissao = null;
      revistos++;
    }
  }

  // Conferência: por mês, entradas / convertidos / perdidos / em andamento.
  const casos = new Map<string, { entrada: string; conv: string | null; perd: string | null; ultimo: string }>();
  for (const l of linhas) {
    const k = l.chave_caso as string;
    const c = casos.get(k) ?? { entrada: l.competencia_arquivo as string, conv: null, perd: null, ultimo: "" };
    if (l.status_padrao === "Convertido" && !c.conv) c.conv = l.competencia_arquivo as string;
    if (l.status_padrao === "Perdido" && !c.perd) c.perd = l.competencia_arquivo as string;
    c.ultimo = l.status_padrao as string;
    casos.set(k, c);
  }
  const tab: Record<string, { entradas: number; conv: number; perd: number }> = {};
  const z = (m: string) => (tab[m] ??= { entradas: 0, conv: 0, perd: 0 });
  for (const c of casos.values()) {
    z(c.entrada).entradas++;
    if (c.conv) z(c.conv).conv++;
    if (c.perd) z(c.perd).perd++;
  }
  const anos: Record<string, { entradas: number; conv: number; perd: number }> = {};
  for (const [m, v] of Object.entries(tab).sort()) {
    const a = (anos[m.slice(0, 4)] ??= { entradas: 0, conv: 0, perd: 0 });
    a.entradas += v.entradas;
    a.conv += v.conv;
    a.perd += v.perd;
    console.log(`${m}: entradas ${v.entradas} | convertidos ${v.conv} | perdidos ${v.perd}`);
  }
  console.log("\npor ano:");
  for (const [a, v] of Object.entries(anos)) console.log(`${a}: entradas ${v.entradas} | convertidos ${v.conv} | perdidos ${v.perd} | conversão ${((100 * v.conv) / Math.max(1, v.conv + v.perd)).toFixed(1)}%`);
  const abertos = [...casos.values()].filter((c) => c.ultimo === "Em análise").length;
  const imobs = new Map<string, number>();
  for (const l of linhas) if (l.imobiliaria_texto && !l.herdada) imobs.set(l.imobiliaria_texto as string, (imobs.get(l.imobiliaria_texto as string) ?? 0) + 1);
  console.log(
    `\nlinhas ${titulos.length} lidas | ${repetidos} cópias repetidas descartadas | ${linhas.length} gravadas | ${casos.size} casos | ${linhas.filter((l) => l.herdada).length} herdadas | ${abertos} ainda em andamento | ${revistos} desfechos anteriores revistos | ${imobs.size} nomes de imobiliária`
  );
  console.log("arquivos:", [...arquivos.values()].map((a) => `${a.nome} [${[...a.comps].sort().join(",")}]`).join("\n  "));
  if (process.argv.includes("--herancas"))
    for (const l of linhas.filter((x) => x.herdada)) {
      const antes = linhas.filter((x) => x.chave_caso === l.chave_caso && (x.competencia_arquivo as string) < (l.competencia_arquivo as string));
      const d = (x: Record<string, unknown>) => `${x.competencia_arquivo} ${x.status_original} ${x.imobiliaria_texto} R$${(x.extras as { valor_titulo: number }).valor_titulo}`;
      console.log(`herança ${antes.map(d).join(" + ")} -> ${d(l)}`);
    }
  if (!gravar) return console.log("\n(simulação — nada gravado; use --gravar)");

  // Nomes de imobiliária da planilha entram na base única (a ligação com a ficha é do cron de vínculos).
  const nomes = [...imobs.keys()];
  for (let k = 0; k < nomes.length; k += 500) {
    const { error } = await sb
      .from("imobiliaria_registros_fonte")
      .upsert(nomes.slice(k, k + 500).map((n) => ({ fonte: "planilha_cap", chave_externa: n, nome_original: n, volume: imobs.get(n) ?? 0 })), { onConflict: "fonte,chave_externa", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  for (const [arquivoId, a] of arquivos) {
    const doArquivo = linhas.filter((l) => l._arquivo === arquivoId);
    const { data: imp, error } = await sb
      .from("base_unica_importacoes")
      .upsert(
        {
          arquivo_id: arquivoId,
          arquivo_nome: a.nome,
          aba: "NOVOS",
          produto: "capitalizacao",
          layout: /^TITULOS NOVOS/.test(norm(a.nome)) ? "cap_titulos_novos_anual" : "cap_mensal",
          competencia: [...a.comps].sort()[0] ?? null,
          linhas_lidas: titulos.filter((t) => t.arquivoId === arquivoId).length,
          linhas_importadas: doArquivo.length,
          descartes: { copias_repetidas: titulos.filter((t) => t.arquivoId === arquivoId).length - doArquivo.length },
          totais_planilha: {},
          totais_importados: { titulos: doArquivo.length, efetivados: doArquivo.filter((l) => l.status_padrao === "Convertido").length },
          importado_em: new Date().toISOString(),
        },
        { onConflict: "arquivo_id,aba" }
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { error: eDel } = await sb.from("producao_unificada").delete().eq("importacao_id", imp.id);
    if (eDel) throw new Error(eDel.message);
    const registros = doArquivo.map(({ _arquivo, ...l }) => ({ ...l, importacao_id: imp.id }));
    for (let k = 0; k < registros.length; k += 500) {
      const { error: e2 } = await sb.from("producao_unificada").insert(registros.slice(k, k + 500));
      if (e2) throw new Error(e2.message);
    }
  }
  const { error: ep } = await sb.rpc("atualizar_producao_painel", { p_forcar: true });
  if (ep) throw new Error(ep.message);
  console.log("\ngravado.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
