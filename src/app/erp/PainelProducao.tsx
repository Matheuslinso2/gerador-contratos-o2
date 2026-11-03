import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import InfoLegenda from "@/components/InfoLegenda";
import { PRODUTOS } from "@/lib/erp/filtros";

// Painel de PRODUÇÃO da aba Início do ERP, no mesmo desenho e na mesma conta do painel do Corp
// (Consultas > Gráficos de Análise e Metas > Produção Total): abas Prêmio Base / Comissão / Qtde de Docs, ano e mês, Análise Anual/Mensal,
// cartões Produção Total · Novos · Renovações · Faturas · Endossos, rosca, Comparativo, Demonstrativo e Metas.
// Critério calibrado em 02/11/2026 contra o painel do Corp (ver migração erp_inicio_producao_painel_corp): data = INÍCIO DE VIGÊNCIA.
// O ERP anda independente: o que só existe no ERP entra; a diferença para o Corp aparece nos números.

const GRUPOS = ["Novos", "Renovações", "Faturas", "Endossos"] as const;
type Grupo = (typeof GRUPOS)[number];
type Metrica = "base" | "com" | "docs";
const COR: Record<Grupo, string> = { Novos: "#2b7bde", Renovações: "#2fa9a6", Faturas: "#bdb9b4", Endossos: "#7b7b7b" };
const CARTAO: Record<string, string> = { Total: "bg-[#00447E] text-white", Novos: "bg-[#2b7bde] text-white", Renovações: "bg-[#2fa9a6] text-white", Faturas: "bg-[#d9d9d9] text-[#444440]", Endossos: "bg-[#8d8683] text-white" };
const ABAS: { chave: string; rotulo: string; metrica: Metrica; unidade: string }[] = [
  { chave: "premio", rotulo: "Prêmio Base", metrica: "base", unidade: "Prêmio" },
  { chave: "comissao", rotulo: "Comissão", metrica: "com", unidade: "Comissão" },
  { chave: "docs", rotulo: "Qtde de Docs", metrica: "docs", unidade: "Qtde de docs" },
];
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_CHEIOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

type Linha = { mes?: string; ano?: number; grupo: Grupo; docs: number; base: number; com: number };
type Dia = { d: string; docs: number; base: number; com: number };
type Retorno = { mensal: Linha[]; anual: Linha[]; diario: Dia[]; meta: { mes: string; com: number }[]; propostas_mensal?: { mes: string; docs: number; base: number; com: number }[]; duvida_mensal?: { mes: string; docs: number; base: number; com: number }[]; com_propostas?: boolean; meta_ok: boolean; gerado_em: string };
type Soma = Record<Grupo, { docs: number; base: number; com: number }>;
type Rank = { nome: string; grupo: Grupo; docs: number; base: number; com: number };

const vazio = (): Soma => Object.fromEntries(GRUPOS.map((g) => [g, { docs: 0, base: 0, com: 0 }])) as Soma;
const num = (v: unknown) => Number(v ?? 0) || 0;
const dec = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inteiro = (v: number) => Math.round(v).toLocaleString("pt-BR");
const valor = (m: Metrica, v: number) => (m === "docs" ? inteiro(v) : dec(v));
function curto(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: a >= 1e7 ? 0 : 1 })}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3).toLocaleString("pt-BR")}k`;
  return Math.round(v).toLocaleString("pt-BR");
}
function somaDe(linhas: Linha[], filtro: (l: Linha) => boolean): Soma {
  const s = vazio();
  for (const l of linhas) if (filtro(l)) { s[l.grupo].docs += num(l.docs); s[l.grupo].base += num(l.base); s[l.grupo].com += num(l.com); }
  return s;
}
const total = (s: Soma, m: Metrica) => GRUPOS.reduce((t, g) => t + s[g][m], 0);
const pad = (n: number) => String(n).padStart(2, "0");
const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

export type ParamsProducao = { ano?: string; m?: string; aba?: string; sub?: string; seg?: string; prod?: string; imob?: string; ramo?: string; grp?: string; prop?: string };

export default async function PainelProducao({ params, caminho = "/erp" }: { params: ParamsProducao; caminho?: string }) {
  const sb = await createClient();
  const hoje = new Date();
  const anoAtual = hoje.getUTCFullYear();
  const mesAtual = hoje.getUTCMonth() + 1;
  const ano = Math.min(Math.max(Number(params.ano) || anoAtual, 2015), anoAtual + 1);
  const anual = params.m === "a";
  const mes = anual ? null : Math.min(Math.max(Number(params.m) || (ano === anoAtual ? mesAtual : 12), 1), 12);
  const aba = ABAS.find((a) => a.chave === params.aba) ?? ABAS[0];
  const ranking = params.sub === "ranking";
  const seg = params.seg || null;
  const prod = params.prod && PRODUTOS[params.prod] ? params.prod : null;
  const imob = params.imob?.trim() || null;
  const ramo = params.ramo || null;
  const grp = params.grp?.trim() || null;
  // Proposta efetivada (card do Bitrix/API ainda sem Nosso nº do Corp) já conta, uma vez só (Matheus, 03/11/2026); ?prop=corp volta a só o que o Corp/Power BI conta.
  const comProp = params.prop !== "corp";
  const filtros = { p_seguradora: seg, p_produto: prod, p_imobiliaria: imob, p_ramo: ramo, p_grupo: grp, p_propostas: comProp };

  const [{ data: bruto }, { data: segs }, { data: ramos }, rk] = await Promise.all([
    sb.rpc("erp_inicio_producao", { p_ano: ano, p_mes: mes, ...filtros }),
    sb.from("erp_seguradoras").select("abreviacao, nome").eq("ativa", true).order("nome"),
    sb.from("erp_ramos").select("abreviacao, nome").order("abreviacao"),
    ranking
      ? Promise.all((["seguradora", "ramo", "produtor"] as const).map((dim) => sb.rpc("erp_inicio_ranking", { p_ano: ano, p_mes: mes, p_dim: dim, ...filtros })))
      : Promise.resolve(null),
  ]);
  const dados = (bruto ?? { mensal: [], anual: [], diario: [], meta: [], meta_ok: false, gerado_em: "" }) as Retorno;
  const m = aba.metrica;

  // período mostrado nos cartões e o mesmo período um ano antes (variação do Corp é contra o mesmo mês/ano do ano anterior)
  const atual: Soma = anual ? somaDe(dados.anual, (l) => l.ano === ano) : somaDe(dados.mensal, (l) => l.mes === `${ano}-${pad(mes!)}`);
  const ant: Soma = anual ? somaDe(dados.anual, (l) => l.ano === ano - 1) : somaDe(dados.mensal, (l) => l.mes === `${ano - 1}-${pad(mes!)}`);
  const variacao = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
  const metaPeriodo = dados.meta_ok ? dados.meta.filter((x) => (anual ? x.mes.startsWith(String(ano)) : x.mes === `${ano}-${pad(mes!)}`)).reduce((s, x) => s + num(x.com), 0) : null;
  const rotuloPeriodo = anual ? String(ano) : `${MESES_CHEIOS[mes! - 1].toUpperCase()}/${ano}`;

  // link que mantém os filtros e troca só o que foi pedido
  const href = (troca: Partial<ParamsProducao>) => {
    const p = new URLSearchParams();
    const base: ParamsProducao = { ano: String(ano), m: anual ? "a" : String(mes), aba: aba.chave, sub: ranking ? "ranking" : undefined, seg: seg ?? undefined, prod: prod ?? undefined, imob: imob ?? undefined, ramo: ramo ?? undefined, grp: grp ?? undefined, prop: comProp ? undefined : "corp", ...troca };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `${caminho}?${p.toString()}`;
  };

  // ---- Comparativo
  type Serie = { rotulo: string; cor: string; pontos: number[]; espessa?: boolean };
  let series: Serie[] = [];
  let eixoX: string[] = [];
  let subtituloComp = "";
  if (!anual) {
    const nDias = diasNoMes(ano, mes!);
    eixoX = Array.from({ length: 31 }, (_, i) => String(i + 1));
    subtituloComp = "(Outros Meses)";
    const porDia = new Map(dados.diario.map((x) => [x.d, x]));
    const acumulado = (a: number, mm: number, limite?: number) => {
      let acc = 0;
      return Array.from({ length: 31 }, (_, i) => {
        const dia = i + 1;
        if (dia > diasNoMes(a, mm)) return NaN;
        if (limite && dia > limite) return NaN;
        acc += num(porDia.get(`${a}-${pad(mm)}-${pad(dia)}`)?.[m]);
        return acc;
      });
    };
    const mesAnt = mes === 1 ? { a: ano - 1, m: 12 } : { a: ano, m: mes! - 1 };
    // última data com movimento no mês escolhido (a linha do mês para onde há dado, como no Corp)
    let ultimo = 0;
    for (let d = 1; d <= nDias; d++) if (porDia.has(`${ano}-${pad(mes!)}-${pad(d)}`)) ultimo = d;
    // média dos 12 meses anteriores (dia a dia, acumulada)
    const medias = Array.from({ length: 31 }, () => 0);
    for (let k = 1; k <= 12; k++) {
      const t = new Date(Date.UTC(ano, mes! - 1 - k, 1));
      const ac = acumulado(t.getUTCFullYear(), t.getUTCMonth() + 1);
      let ultimoVal = 0;
      for (let i = 0; i < 31; i++) {
        const val = Number.isNaN(ac[i]) ? ultimoVal : ac[i];
        ultimoVal = val;
        medias[i] += val / 12;
      }
    }
    series = [
      { rotulo: `${MESES_ABREV[mes! - 1]}/${String(ano).slice(2)}`, cor: "#00447E", pontos: acumulado(ano, mes!, Math.max(ultimo, 1)), espessa: true },
      { rotulo: `${MESES_ABREV[mesAnt.m - 1]}/${String(mesAnt.a).slice(2)}`, cor: "#f2a31b", pontos: acumulado(mesAnt.a, mesAnt.m) },
      { rotulo: `${MESES_ABREV[mes! - 1]}/${String(ano - 1).slice(2)}`, cor: "#7a1f8c", pontos: acumulado(ano - 1, mes!) },
      { rotulo: "Média 12 meses", cor: "#7fe8d4", pontos: medias },
    ];
  } else {
    eixoX = MESES;
    subtituloComp = "(Outros Anos)";
    for (const [i, a] of [ano, ano - 1, ano - 2].entries()) {
      let acc = 0;
      const pontos = Array.from({ length: 12 }, (_, k) => {
        acc += GRUPOS.reduce((t, g) => t + num(dados.mensal.find((l) => l.mes === `${a}-${pad(k + 1)}` && l.grupo === g)?.[m]), 0);
        return a === anoAtual && k + 1 > mesAtual ? NaN : acc;
      });
      series.push({ rotulo: String(a), cor: ["#00447E", "#f2a31b", "#7a1f8c"][i], pontos, espessa: i === 0 });
    }
  }

  // ---- Demonstrativo (últimos 12 meses ou 10 anos)
  type Barra = { rotulo: string; s: Soma; meta?: number };
  const barras: Barra[] = [];
  if (!anual) {
    for (let k = 11; k >= 0; k--) {
      const t = new Date(Date.UTC(ano, mes! - 1 - k, 1));
      const chave = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
      barras.push({ rotulo: `${MESES[t.getUTCMonth()]}/${String(t.getUTCFullYear()).slice(2)}`, s: somaDe(dados.mensal, (l) => l.mes === chave), meta: dados.meta_ok ? num(dados.meta.find((x) => x.mes === chave)?.com) || undefined : undefined });
    }
  } else {
    for (let a = ano - 9; a <= ano; a++) barras.push({ rotulo: String(a), s: somaDe(dados.anual, (l) => l.ano === a) });
  }
  const maxBarra = Math.max(1, ...barras.map((b) => Math.max(total(b.s, m) > 0 ? total(b.s, m) : 0, m === "com" && b.meta ? b.meta : 0)));

  // quanto do período vem de proposta efetivada ainda sem Corp (já dentro do total quando comProp)
  const propsPeriodo = (dados.propostas_mensal ?? []).filter((x) => (anual ? x.mes.startsWith(String(ano)) : x.mes === `${ano}-${pad(mes!)}`)).reduce((s, x) => ({ docs: s.docs + num(x.docs), base: s.base + num(x.base), com: s.com + num(x.com) }), { docs: 0, base: 0, com: 0 });
  const duvidaPeriodo = (dados.duvida_mensal ?? []).filter((x) => (anual ? x.mes.startsWith(String(ano)) : x.mes === `${ano}-${pad(mes!)}`)).reduce((s, x) => ({ docs: s.docs + num(x.docs), base: s.base + num(x.base), com: s.com + num(x.com) }), { docs: 0, base: 0, com: 0 });
  const filtrosAtivos = [seg && `seguradora ${seg}`, ramo && `ramo ${ramo}`, prod && PRODUTOS[prod], grp && `grupo “${grp}”`, imob && `imobiliária “${imob}”`].filter(Boolean).join(" · ");

  return (
    <section className="space-y-3" aria-label="Produção">
      {/* abas */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex gap-1">
          {ABAS.map((a) => (
            <Link key={a.chave} href={href({ aba: a.chave })} className={`rounded-t-lg px-5 py-2 text-sm font-medium ${a.chave === aba.chave ? "bg-[#00447E] text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"}`}>
              {a.rotulo}
            </Link>
          ))}
        </div>
        <span className="pb-1 text-xs text-gray-500">
          Início de vigência · documentos distintos · Corp e ERP juntos
          <InfoLegenda titulo="Como esta conta é feita">
            Mesma conta do painel do Corp (Gráficos de Análise e Metas, Produção Total), conferida contra ele em 02/11/2026: a data é o INÍCIO DE VIGÊNCIA; Novos, Renovações, Faturas e Endossos (inclui cancelamentos) vêm do tipo do documento; Prêmio Base é o prêmio líquido (base de comissão da corretora); Comissão é o valor da comissão; Qtde de Docs conta documentos distintos (pelo Nosso nº do Corp). O ERP anda independente: documentos que só existem no ERP (vindos dos cards do Bitrix) entram, e o que o Corp ainda não lançou também. Nas faturas de novembro/2026 o ERP bate com o Corp ao centavo. Em Novos e Renovações o Corp pode ter documentos que o ERP ainda não tem, e o ERP tem documentos que o Corp não tem: a diferença é esperada e será fechada com o vínculo das apólices.
          </InfoLegenda>
        </span>
      </div>

      <div className="overflow-hidden rounded-b-xl rounded-tr-xl border border-gray-200 bg-white">
        {/* seletor de período */}
        <div className="bg-[#00447E] px-4 py-2 text-sm text-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-1 items-center justify-center gap-3">
              <Link href={href({ ano: String(ano - 1) })} aria-label="Ano anterior" className="px-2 opacity-80 hover:opacity-100">‹</Link>
              {[ano - 2, ano - 1, ano].map((a) => (
                <Link key={a} href={href({ ano: String(a) })} className={`rounded px-2 py-0.5 ${a === ano ? "border border-white font-semibold" : "opacity-80 hover:opacity-100"}`}>
                  {a}
                </Link>
              ))}
              <Link href={href({ ano: String(Math.min(ano + 1, anoAtual + 1)) })} aria-label="Próximo ano" className="px-2 opacity-80 hover:opacity-100">›</Link>
            </div>
            <div className="flex gap-1 text-xs">
              <Link href={href({ m: "a" })} className={`rounded border px-3 py-1 ${anual ? "border-white bg-white/15 font-semibold" : "border-white/40 opacity-80 hover:opacity-100"}`}>Análise Anual</Link>
              <Link href={href({ m: String(mes ?? (ano === anoAtual ? mesAtual : 12)) })} className={`rounded border px-3 py-1 ${!anual ? "border-white bg-white/15 font-semibold" : "border-white/40 opacity-80 hover:opacity-100"}`}>Análise Mensal</Link>
            </div>
          </div>
          <div className={`mt-2 flex flex-wrap items-center justify-center gap-1 text-xs ${anual ? "opacity-40" : ""}`}>
            {MESES.map((nome, i) => (
              <Link key={nome} href={href({ m: String(i + 1) })} className={`rounded px-2.5 py-0.5 ${!anual && mes === i + 1 ? "border border-white font-semibold" : "opacity-85 hover:opacity-100"}`}>
                {nome}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex gap-1 border-b border-gray-200 bg-gray-50 px-3 pt-2 text-sm">
          <Link href={href({ sub: undefined })} className={`rounded-t px-4 py-1.5 ${!ranking ? "bg-white font-semibold text-[#00447E]" : "text-gray-600 hover:text-[#00447E]"}`}>Produção Total</Link>
          <Link href={href({ sub: "ranking" })} className={`rounded-t px-4 py-1.5 ${ranking ? "bg-white font-semibold text-[#00447E]" : "text-gray-600 hover:text-[#00447E]"}`}>Ranking</Link>
          <span className="ml-auto flex items-center gap-1 pb-1 text-xs">
            <span className="text-gray-500">Conta:</span>
            <Link href={href({ prop: undefined })} className={`rounded-full border px-3 py-1 font-medium ${comProp ? "border-[#00447E] bg-[#00447E] text-white" : "border-gray-300 text-gray-700 hover:bg-white"}`} title="Corp/Power BI mais as propostas efetivadas ainda sem Corp, cada documento uma vez só">Com propostas</Link>
            <Link href={href({ prop: "corp" })} className={`rounded-full border px-3 py-1 font-medium ${!comProp ? "border-[#00447E] bg-[#00447E] text-white" : "border-gray-300 text-gray-700 hover:bg-white"}`} title="Só documentos com Nosso nº do Corp, como o Power BI">Só Corp / Power BI</Link>
          </span>
        </div>
        {comProp && (propsPeriodo.docs > 0 || duvidaPeriodo.docs > 0) ? (
          <p className="border-b border-gray-100 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
            {rotuloPeriodo}: {propsPeriodo.docs > 0 ? <>inclui <b>{inteiro(propsPeriodo.docs)}</b> proposta(s) efetivada(s) ainda sem Nosso nº do Corp (comissão R$ {dec(propsPeriodo.com)}). </> : null}{duvidaPeriodo.docs > 0 ? <><b>{inteiro(duvidaPeriodo.docs)}</b> proposta(s) com possível equivalente no Corp (comissão R$ {dec(duvidaPeriodo.com)}) ficam FORA do total até o vínculo, para o mesmo seguro não contar como proposta e como apólice. </> : null}Ou é proposta ou é apólice: quando o Corp cadastra, o documento só troca de estado. “Só Corp / Power BI” mostra o número sem elas.
          </p>
        ) : null}

        {/* filtros */}
        <form method="get" action={caminho} className="flex flex-wrap items-end gap-3 border-b border-gray-100 px-4 py-2 text-xs">
          <input type="hidden" name="ano" value={ano} />
          <input type="hidden" name="m" value={anual ? "a" : mes!} />
          <input type="hidden" name="aba" value={aba.chave} />
          {ranking && <input type="hidden" name="sub" value="ranking" />}
          {!comProp && <input type="hidden" name="prop" value="corp" />}
          <label className="flex flex-col gap-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            Seguradora
            <select name="seg" defaultValue={seg ?? ""} className="rounded border border-gray-300 px-2 py-1 text-xs normal-case text-gray-800">
              <option value="">Todas</option>
              {((segs ?? []) as { abreviacao: string; nome: string }[]).map((s) => (
                <option key={s.abreviacao} value={s.abreviacao}>{s.nome}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            Produto
            <select name="prod" defaultValue={prod ?? ""} className="rounded border border-gray-300 px-2 py-1 text-xs normal-case text-gray-800">
              <option value="">Todos</option>
              {Object.entries(PRODUTOS).map(([k, r]) => (
                <option key={k} value={k}>{r}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            Ramo
            <select name="ramo" defaultValue={ramo ?? ""} className="rounded border border-gray-300 px-2 py-1 text-xs normal-case text-gray-800">
              <option value="">Todos</option>
              {((ramos ?? []) as { abreviacao: string; nome: string }[]).map((r) => (
                <option key={r.abreviacao} value={r.abreviacao}>{r.abreviacao} · {r.nome}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            Grupo de produtores
            <input name="grp" defaultValue={grp ?? ""} placeholder="nome do grupo" className="w-40 rounded border border-gray-300 px-2 py-1 text-xs normal-case text-gray-800" />
          </label>
          <label className="flex flex-col gap-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            Imobiliária
            <input name="imob" defaultValue={imob ?? ""} placeholder="nome ou parte" className="w-44 rounded border border-gray-300 px-2 py-1 text-xs normal-case text-gray-800" />
          </label>
          <button type="submit" className="rounded bg-[#01192e] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#00447E]">Filtrar</button>
          {filtrosAtivos && <Link href={href({ seg: "", prod: "", imob: "", ramo: "", grp: "" })} className="py-1.5 text-gray-500 hover:underline">Limpar</Link>}
          {filtrosAtivos && <span className="py-1.5 text-gray-600">Filtrando: {filtrosAtivos}</span>}
        </form>

        {!ranking ? (
          <div className="space-y-4 p-4">
            {/* cartões */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              {(["Total", ...GRUPOS] as const).map((g) => {
                const v = g === "Total" ? total(atual, m) : atual[g][m];
                const vp = g === "Total" ? total(ant, m) : ant[g][m];
                const pct = variacao(v, vp);
                const taxa = m === "com" ? (g === "Total" ? total(atual, "base") : atual[g].base) : 0;
                const taxaPct = m === "com" && taxa ? ((g === "Total" ? total(atual, "com") : atual[g].com) / taxa) * 100 : null;
                return (
                  <div key={g} className={`rounded-lg px-3 py-2 ${CARTAO[g]}`}>
                    <div className="t flex items-baseline justify-between text-xs font-medium uppercase tracking-wide">
                      <span>{g === "Total" ? "Produção total" : g}</span>
                      {g === "Total" && <span className="font-normal opacity-90">{rotuloPeriodo}</span>}
                    </div>
                    <div className="v my-1 text-center text-xl font-semibold">{valor(m, v)}</div>
                    <div className="flex items-center justify-between text-xs opacity-95">
                      <span>{taxaPct !== null ? `${taxaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : ""}</span>
                      <span title={`mesmo ${anual ? "ano" : "mês"} do ano anterior: ${valor(m, vp)}`}>
                        {pct === null ? "—" : `${pct > 0 ? "▲" : pct < 0 ? "▼" : ""} ${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {m === "com" && dados.meta_ok && metaPeriodo ? (
              <div className="rounded-lg border border-gray-200 px-4 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-[#01192e]">Meta de comissão {anual ? `de ${ano}` : `de ${rotuloPeriodo.toLowerCase()}`}{prod ? ` · ${PRODUTOS[prod]}` : ""}</span>
                  <span className="text-gray-700">{dec(metaPeriodo)} · realizado {dec(total(atual, "com"))} · <b>{((total(atual, "com") / metaPeriodo) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b></span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full rounded-full bg-[#F8540D]" style={{ width: `${Math.min(100, (total(atual, "com") / metaPeriodo) * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-gray-500">Meta de comissão lida da planilha de metas já guardada (corp_meta_comissao: por mês e agrupamento Fiança, Incêndio, Capitalização, Condomínio e Auto). O painel do Corp está com as metas desligadas; esta meta vem de outra fonte e passa a ser editável no ERP. Só vale sem filtro de seguradora, ramo, grupo ou imobiliária.</p>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              {/* rosca */}
              <div className="flex items-center justify-center rounded-lg border border-gray-100 p-3">
                <Rosca s={atual} m={m} />
                <div className="ml-4 space-y-1 text-xs text-gray-600">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{aba.unidade}</p>
                  {GRUPOS.map((g) => (
                    <p key={g} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-lg" style={{ background: COR[g] }} />{g}: <b className="text-gray-800">{valor(m, atual[g][m])}</b></p>
                  ))}
                </div>
              </div>
              {/* comparativo */}
              <div className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-[#01192e]">Comparativo <span className="text-xs font-normal text-gray-500">{subtituloComp}</span></p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                    {series.map((s) => (
                      <span key={s.rotulo} className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-4" style={{ background: s.cor }} />{s.rotulo}</span>
                    ))}
                  </div>
                </div>
                <Linhas series={series} eixoX={eixoX} m={m} />
              </div>
            </div>

            {/* demonstrativo */}
            <div className="rounded-lg border border-gray-100 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-[#01192e]">Demonstrativo <span className="text-xs font-normal text-gray-500">{anual ? "Últimos 10 Anos" : "Últimos 12 Meses"}</span></p>
                <div className="flex gap-x-3 text-xs text-gray-600">
                  {[...GRUPOS].reverse().map((g) => (
                    <span key={g} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-lg" style={{ background: COR[g] }} />{g}</span>
                  ))}
                  {m === "com" && dados.meta_ok && !anual && <span className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#F8540D]" />Meta</span>}
                </div>
              </div>
              <Barras barras={barras} m={m} max={maxBarra} destaque={anual ? String(ano) : `${MESES[mes! - 1]}/${String(ano).slice(2)}`} />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            {rk && (
              <>
                <PizzaRanking titulo="Seguradoras" linhas={(rk[0].data ?? []) as Rank[]} m={m} periodo={rotuloPeriodo} />
                <PizzaRanking titulo="Ramos" linhas={(rk[1].data ?? []) as Rank[]} m={m} periodo={rotuloPeriodo} />
                <div className="lg:col-span-2">
                  <BarrasProdutores linhas={(rk[2].data ?? []) as Rank[]} m={m} periodo={rotuloPeriodo} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Dados do ERP, atualizados na hora da consulta{dados.gerado_em ? ` (${new Date(dados.gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })})` : ""}. Passe o mouse sobre a variação para ver o valor do mesmo período do ano anterior.
      </p>
    </section>
  );
}

function Rosca({ s, m }: { s: Soma; m: Metrica }) {
  const itens = GRUPOS.map((g) => ({ g, v: Math.max(0, s[g][m]) }));
  const t = itens.reduce((a, b) => a + b.v, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let acum = 0;
  return (
    <svg viewBox="0 0 180 180" className="h-44 w-44" role="img" aria-label="Participação por tipo">
      <g transform="rotate(-90 90 90)">
        {t === 0 && <circle cx="90" cy="90" r={R} fill="none" stroke="#e5e5e5" strokeWidth="26" />}
        {itens.map(({ g, v }) => {
          const parte = t ? (v / t) * C : 0;
          const el = <circle key={g} cx="90" cy="90" r={R} fill="none" stroke={COR[g]} strokeWidth="26" strokeDasharray={`${parte} ${C - parte}`} strokeDashoffset={-acum} />;
          acum += parte;
          return el;
        })}
      </g>
      <text x="90" y="96" textAnchor="middle" fontSize="20" fill="#333">{curtoCentro(total(s, m), m)}</text>
    </svg>
  );
}
const curtoCentro = (v: number, m: Metrica) => (m === "docs" ? inteiro(v) : Math.round(v).toLocaleString("pt-BR"));

function Linhas({ series, eixoX, m }: { series: { rotulo: string; cor: string; pontos: number[]; espessa?: boolean }[]; eixoX: string[]; m: Metrica }) {
  const W = 560, H = 210, L = 44, B = 24, T = 8, R = 8;
  const maxV = Math.max(1, ...series.flatMap((s) => s.pontos.filter((p) => !Number.isNaN(p))));
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, eixoX.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / maxV);
  const ticks = [0, 0.5, 1].map((k) => k * maxV);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Comparativo acumulado">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eee" />
          <text x={L - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#777">{m === "docs" ? curto(t) : curto(t)}</text>
        </g>
      ))}
      {series.map((s) => {
        const segs: string[] = [];
        let atual = "";
        s.pontos.forEach((p, i) => {
          if (Number.isNaN(p)) { if (atual) segs.push(atual); atual = ""; return; }
          atual += `${atual ? " L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`;
        });
        if (atual) segs.push(atual);
        return segs.map((d, i) => <path key={s.rotulo + i} d={d} fill="none" stroke={s.cor} strokeWidth={s.espessa ? 2.6 : 1.8} strokeLinejoin="round" />);
      })}
      {eixoX.map((r, i) => (eixoX.length > 20 && i % 2 === 1 ? null : <text key={r} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#777">{r}</text>))}
    </svg>
  );
}

function Barras({ barras, m, max, destaque }: { barras: { rotulo: string; s: Soma; meta?: number }[]; m: Metrica; max: number; destaque: string }) {
  const W = 760, H = 230, L = 40, B = 24, T = 20;
  const larg = (W - L - 8) / barras.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ordem: Grupo[] = ["Renovações", "Novos", "Faturas", "Endossos"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Demonstrativo por período">
      {[0, 0.5, 1].map((k) => (
        <g key={k}>
          <line x1={L} x2={W - 8} y1={y(k * max)} y2={y(k * max)} stroke="#eee" />
          <text x={L - 4} y={y(k * max) + 3} textAnchor="end" fontSize="9" fill="#777">{curto(k * max)}</text>
        </g>
      ))}
      {barras.map((b, i) => {
        const x0 = L + i * larg + larg * 0.18;
        const w = larg * 0.64;
        let base = 0;
        const t = total(b.s, m);
        return (
          <g key={b.rotulo}>
            {ordem.map((g) => {
              const v = Math.max(0, b.s[g][m]);
              const el = v > 0 ? <rect key={g} x={x0} y={y(base + v)} width={w} height={Math.max(0, y(base) - y(base + v))} fill={COR[g]}><title>{`${b.rotulo} · ${g}: ${valor(m, b.s[g][m])}`}</title></rect> : null;
              base += v;
              return el;
            })}
            {t > 0 && <text x={x0 + w / 2} y={y(base) - 4} textAnchor="middle" fontSize="9" fill="#555">{m === "docs" ? inteiro(t) : curto(t)}</text>}
            {m === "com" && b.meta ? <line x1={x0 - 3} x2={x0 + w + 3} y1={y(b.meta)} y2={y(b.meta)} stroke="#F8540D" strokeWidth="2" strokeDasharray="4 3"><title>{`Meta ${b.rotulo}: ${dec(b.meta)}`}</title></line> : null}
            <text x={x0 + w / 2} y={H - 8} textAnchor="middle" fontSize="9" fontWeight={b.rotulo === destaque ? 700 : 400} fill={b.rotulo === destaque ? "#00447E" : "#777"}>{b.rotulo}</text>
          </g>
        );
      })}
    </svg>
  );
}

const PALETA = ["#00447E", "#F8540D", "#2fa9a6", "#7a1f8c", "#f2a31b", "#2b7bde", "#AF2505", "#8d8683", "#01192e", "#7fe8d4"];

// soma o valor da métrica por nome (os grupos Novos/Renovações/Faturas/Endossos entram juntos, como no total do painel)
function agrupar(linhas: Rank[], m: Metrica) {
  const por = new Map<string, number>();
  for (const l of linhas) por.set(l.nome, (por.get(l.nome) ?? 0) + num(l[m]));
  return [...por.entries()].map(([nome, v]) => ({ nome, v })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
}

// Ranking do Corp: pizza de Seguradoras e de Ramos (% do total da métrica) e barras de Produtores.
function PizzaRanking({ titulo, linhas, m, periodo }: { titulo: string; linhas: Rank[]; m: Metrica; periodo: string }) {
  const todos = agrupar(linhas, m);
  const topo = todos.slice(0, 8);
  const resto = todos.slice(8).reduce((s, x) => s + x.v, 0);
  const itens = resto > 0 ? [...topo, { nome: "Outros", v: resto }] : topo;
  const t = itens.reduce((s, x) => s + x.v, 0);
  const R = 62;
  const C = 2 * Math.PI * R;
  let acum = 0;
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <p className="text-sm font-semibold text-[#01192e]">{titulo} <span className="text-xs font-normal text-gray-500">· {periodo}</span></p>
      {t === 0 ? (
        <p className="py-8 text-center text-xs text-gray-500">Sem movimento no período.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <svg viewBox="0 0 160 160" className="h-40 w-40" role="img" aria-label={`Participação por ${titulo.toLowerCase()}`}>
            <g transform="rotate(-90 80 80)">
              {itens.map((x, i) => {
                const parte = (x.v / t) * C;
                const el = <circle key={x.nome} cx="80" cy="80" r={R} fill="none" stroke={PALETA[i % PALETA.length]} strokeWidth="30" strokeDasharray={`${parte} ${C - parte}`} strokeDashoffset={-acum}><title>{`${x.nome}: ${valor(m, x.v)}`}</title></circle>;
                acum += parte;
                return el;
              })}
            </g>
            <text x="80" y="86" textAnchor="middle" fontSize="16" fill="#333">{curtoCentro(t, m)}</text>
          </svg>
          <ul className="space-y-1 text-xs text-gray-600">
            {itens.map((x, i) => (
              <li key={x.nome} className="flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-2.5 rounded-lg" style={{ background: PALETA[i % PALETA.length] }} />
                <span className="w-24 truncate font-medium text-gray-800">{x.nome}</span>
                <span className="w-12 text-right">{((x.v / t) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                <span className="text-gray-500">{valor(m, x.v)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BarrasProdutores({ linhas, m, periodo }: { linhas: Rank[]; m: Metrica; periodo: string }) {
  const lista = agrupar(linhas, m).slice(0, 15);
  const max = Math.max(1, ...lista.map((x) => x.v));
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <p className="text-sm font-semibold text-[#01192e]">Maiores produtores <span className="text-xs font-normal text-gray-500">· {periodo}</span></p>
      {!lista.length ? (
        <p className="py-6 text-center text-xs text-gray-500">Sem movimento no período.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {lista.map((x) => (
            <li key={x.nome} className="flex items-center gap-2 text-xs">
              <span className="w-64 truncate text-gray-700" title={x.nome}>{x.nome}</span>
              <div className="h-3 flex-1 rounded-lg bg-gray-100">
                <div className="h-full rounded-lg bg-[#00447E]" style={{ width: `${(x.v / max) * 100}%` }} />
              </div>
              <span className="w-28 text-right font-medium text-gray-800">{valor(m, x.v)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
