import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CORRETORAS, FORMAS_PAGAMENTO, PRODUTOS, type CampoFiltro, type ValoresFiltro } from "@/lib/erp/filtros";

// Barra de filtros padrão do ERP O2: mesmos nomes, rótulos e comportamento em todas as telas; cada tela escolhe
// os campos (níveis) que fazem sentido para ela. Formulário GET (filtros ficam na URL, dá para compartilhar o link).
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-o2-navy focus:outline-none";

export default async function FiltrosErp({
  caminho,
  campos,
  valores,
  rotuloBusca = "Buscar",
  placeholderBusca = "Código O2, Nosso Nº, apólice, cliente…",
  rotuloPeriodo = "Período",
  situacoes,
  tipos,
  resumo,
}: {
  caminho: string;
  campos: CampoFiltro[];
  valores: ValoresFiltro;
  rotuloBusca?: string;
  placeholderBusca?: string;
  rotuloPeriodo?: string;
  situacoes?: Record<string, string>;
  tipos?: Record<string, string>;
  resumo?: React.ReactNode;
}) {
  const supabase = await createClient();
  const precisa = (c: CampoFiltro) => campos.includes(c);
  const [{ data: segs }, { data: canais }, { data: imobs }] = await Promise.all([
    precisa("seguradora") ? supabase.from("erp_seguradoras").select("abreviacao, nome").eq("ativa", true).order("nome") : Promise.resolve({ data: [] }),
    precisa("canal") ? supabase.from("erp_canais").select("id, nome").order("nome") : Promise.resolve({ data: [] }),
    precisa("imobiliaria") ? supabase.from("imobiliarias").select("nome").order("nome").limit(800) : Promise.resolve({ data: [] }),
  ]);
  const algum = Object.values(valores).some(Boolean);

  const campo = (rotulo: string, filho: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
      {rotulo}
      {filho}
    </label>
  );
  const select = (nome: keyof ValoresFiltro, opcoes: [string, string][], todos = "Todas") => (
    <select name={nome} defaultValue={valores[nome] ?? ""} className={input}>
      <option value="">{todos}</option>
      {opcoes.map(([v, r]) => (
        <option key={v} value={v}>
          {r}
        </option>
      ))}
    </select>
  );

  return (
    <form method="get" action={caminho} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        {precisa("busca") && campo(rotuloBusca, <input name="q" defaultValue={valores.q ?? ""} placeholder={placeholderBusca} className={`${input} w-72`} />)}
        {precisa("seguradora") &&
          campo("Seguradora", select("seguradora", ((segs ?? []) as { abreviacao: string; nome: string }[]).map((s) => [s.abreviacao, s.nome])))}
        {precisa("corretora") && campo("Corretora", select("corretora", CORRETORAS.map((c) => [c, c]), "Ambas"))}
        {precisa("produto") && campo("Produto", select("produto", Object.entries(PRODUTOS), "Todos"))}
        {precisa("imobiliaria") &&
          campo(
            "Imobiliária",
            <>
              <input name="imobiliaria" list="erp-imobiliarias" defaultValue={valores.imobiliaria ?? ""} placeholder="nome ou parte" className={`${input} w-56`} />
              <datalist id="erp-imobiliarias">
                {((imobs ?? []) as { nome: string }[]).map((i) => (
                  <option key={i.nome} value={i.nome} />
                ))}
              </datalist>
            </>
          )}
        {precisa("situacao") && situacoes && campo("Situação", select("situacao", Object.entries(situacoes)))}
        {precisa("tipo") && tipos && campo("Tipo", select("tipo", Object.entries(tipos), "Todos"))}
        {precisa("forma_pagamento") && campo("Forma de pagamento", select("forma", Object.entries(FORMAS_PAGAMENTO)))}
        {precisa("canal") && campo("Canal", select("canal", ((canais ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]), "Todos"))}
        {precisa("mes") && campo("Mês", <input type="month" name="mes" defaultValue={valores.mes ?? ""} className={input} />)}
        {precisa("periodo") &&
          campo(
            rotuloPeriodo,
            <span className="flex items-center gap-1">
              <input type="date" name="de" defaultValue={valores.de ?? ""} className={input} />
              <span className="text-gray-400">a</span>
              <input type="date" name="ate" defaultValue={valores.ate ?? ""} className={input} />
            </span>
          )}
        <button type="submit" className="rounded-lg bg-o2-navy px-4 py-2 text-sm font-medium text-white hover:bg-o2-indigo">
          Filtrar
        </button>
        {algum && (
          <Link href={caminho} className="py-2 text-sm text-gray-500 hover:text-o2-navy hover:underline">
            Limpar
          </Link>
        )}
      </div>
      {resumo && <div className="text-xs text-gray-500">{resumo}</div>}
    </form>
  );
}
