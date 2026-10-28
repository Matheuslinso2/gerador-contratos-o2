import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CORRETORAS, FORMAS_PAGAMENTO, PARAMS_DO_CAMPO, PRODUTOS, type CampoFiltro, type ValoresFiltro } from "@/lib/erp/filtros";

// Barra de filtros padrão do ERP O2: mesmos nomes, rótulos e comportamento em todas as telas; cada tela escolhe
// os campos (níveis) que fazem sentido para ela. Formulário GET (filtros ficam na URL, dá para compartilhar o link).
// Muitos campos: a tela separa os básicos (sempre à vista) dos "avançados" (dropdown que abre sozinho quando algum
// avançado está em uso) — Matheus 25/10/2026.
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-o2-navy focus:outline-none";

export default async function FiltrosErp({
  caminho,
  campos,
  avancados = [],
  valores,
  rotuloBusca = "Buscar",
  placeholderBusca = "Código O2 do documento, nosso nº do Corp, nº da apólice, cliente…",
  rotuloPeriodo = "Período",
  situacoes,
  tipos,
  resumo,
}: {
  caminho: string;
  campos: CampoFiltro[];
  /** campos que ficam no dropdown "Filtros avançados" (também precisam estar em `campos`) */
  avancados?: CampoFiltro[];
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

  const busca = (nome: "inquilino" | "proprietario" | "imovel", placeholder: string, largura = "w-56") => (
    <input name={nome} defaultValue={valores[nome] ?? ""} placeholder={placeholder} className={`${input} ${largura}`} />
  );
  const render = (c: CampoFiltro): React.ReactNode => {
    switch (c) {
      case "busca":
        return campo(rotuloBusca, <input name="q" defaultValue={valores.q ?? ""} placeholder={placeholderBusca} className={`${input} w-72`} />);
      case "seguradora":
        return campo("Seguradora", select("seguradora", ((segs ?? []) as { abreviacao: string; nome: string }[]).map((s) => [s.abreviacao, s.nome])));
      case "corretora":
        return campo("Corretora", select("corretora", CORRETORAS.map((c) => [c, c]), "Ambas"));
      case "produto":
        return campo("Produto", select("produto", Object.entries(PRODUTOS), "Todos"));
      case "imobiliaria":
        return campo(
          "Imobiliária",
          <>
            <input name="imobiliaria" list="erp-imobiliarias" defaultValue={valores.imobiliaria ?? ""} placeholder="nome ou parte" className={`${input} w-56`} />
            <datalist id="erp-imobiliarias">
              {((imobs ?? []) as { nome: string }[]).map((i) => (
                <option key={i.nome} value={i.nome} />
              ))}
            </datalist>
          </>
        );
      case "inquilino":
        return campo("Inquilino", busca("inquilino", "nome ou CPF/CNPJ"));
      case "proprietario":
        return campo("Proprietário", busca("proprietario", "nome ou CPF/CNPJ"));
      case "imovel":
        return campo("Imóvel", busca("imovel", "rua, bairro ou CEP"));
      case "situacao":
        return situacoes ? campo("Situação", select("situacao", Object.entries(situacoes))) : null;
      case "tipo":
        return tipos ? campo("Tipo", select("tipo", Object.entries(tipos), "Todos")) : null;
      case "forma_pagamento":
        return campo("Forma de pagamento", select("forma", Object.entries(FORMAS_PAGAMENTO)));
      case "canal":
        return campo("Canal", select("canal", ((canais ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]), "Todos"));
      case "mes":
        return campo("Mês", <input type="month" name="mes" defaultValue={valores.mes ?? ""} className={input} />);
      case "periodo":
        return campo(
          rotuloPeriodo,
          <span className="flex items-center gap-1">
            <input type="date" name="de" defaultValue={valores.de ?? ""} className={input} />
            <span className="text-gray-400">a</span>
            <input type="date" name="ate" defaultValue={valores.ate ?? ""} className={input} />
          </span>
        );
    }
  };
  const basicos = campos.filter((c) => !avancados.includes(c));
  const extras = campos.filter((c) => avancados.includes(c));
  const extrasEmUso = extras.filter((c) => PARAMS_DO_CAMPO[c].some((k) => valores[k])).length;

  return (
    <form method="get" action={caminho} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        {basicos.map((c) => (
          <Fragment key={c}>{render(c)}</Fragment>
        ))}
        <button type="submit" className="rounded-lg bg-o2-navy px-4 py-2 text-sm font-medium text-white hover:bg-o2-indigo">
          Filtrar
        </button>
        {algum && (
          <Link href={caminho} className="py-2 text-sm text-gray-500 hover:text-o2-navy hover:underline">
            Limpar
          </Link>
        )}
      </div>
      {extras.length > 0 && (
        <details open={extrasEmUso > 0} className="group rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-o2-navy">
            Filtros avançados{extrasEmUso > 0 ? ` · ${extrasEmUso} em uso` : ""}
          </summary>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            {extras.map((c) => (
              <Fragment key={c}>{render(c)}</Fragment>
            ))}
          </div>
        </details>
      )}
      {resumo && <div className="text-xs text-gray-500">{resumo}</div>}
    </form>
  );
}
