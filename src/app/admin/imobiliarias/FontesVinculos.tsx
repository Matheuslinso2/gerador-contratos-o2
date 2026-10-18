import { ROTULO_FONTE, ROTULO_METODO, dadosDasFontes, type RegistroFonte } from "@/lib/baseUnica/revisao";
import {
  confirmarSugestoesUnicas,
  definirGrupo,
  desfazerVinculo,
  ignorarRegistro,
  ligarRegistro,
  marcarRevisao,
  recusarSugestao,
  usarDadoNaFicha,
} from "./fontesActions";

// Seção "Fontes e vínculos" da ficha (Base Única — Fase 2, revisão uma a
// uma). Mostra o que cada fonte diz desta imobiliária e deixa a equipe
// confirmar, recusar, agrupar e levar dados para a ficha única.

type Ficha = {
  id: string;
  nome: string;
  telefone: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  grupo_id: string | null;
  revisao_status: string;
  revisada_em: string | null;
  revisada_por_email: string | null;
  receita_razao_social: string | null;
  receita_nome_fantasia: string | null;
  receita_situacao: string | null;
};

const botaoPrimario = "rounded-full bg-o2-coral px-3 py-1 text-xs font-medium text-white transition hover:opacity-90";
const botaoSecundario = "rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-o2-navy hover:text-o2-navy";
const botaoLink = "text-xs font-medium text-red-600 hover:underline";

function Anos({ anos }: { anos: number[] }) {
  if (!anos?.length) return null;
  const a = [...anos].sort();
  return <span>{a.length > 1 ? `${a[0]}–${a[a.length - 1]}` : a[0]}</span>;
}

function Hidden({ campos }: { campos: Record<string, string> }) {
  return (
    <>
      {Object.entries(campos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

export default function FontesVinculos({
  ficha,
  ligados,
  sugeridos,
  grupos,
  nomesFichas,
  buscaTermo,
  buscaResultados,
  voltarPara,
}: {
  ficha: Ficha;
  ligados: RegistroFonte[];
  sugeridos: RegistroFonte[];
  grupos: { id: string; nome: string }[];
  nomesFichas: Record<string, string>;
  buscaTermo: string;
  buscaResultados: RegistroFonte[];
  voltarPara: string;
}) {
  const base = { imobiliaria_id: ficha.id, voltar_para: voltarPara };
  const dados = dadosDasFontes(ligados);
  const valorAtual: Record<string, string | null> = {
    telefone: ficha.telefone, endereco: ficha.endereco, cidade: ficha.cidade, uf: ficha.uf, bairro: ficha.bairro,
  };
  const volumeLigado = ligados.reduce((s, r) => s + (r.volume ?? 0), 0);
  const volumeSugerido = sugeridos.reduce((s, r) => s + (r.volume ?? 0), 0);
  const revisada = ficha.revisao_status === "revisada";
  const unicas = sugeridos.filter((r) => r.metodo_vinculo === "nome_exato" && r.sugestoes.length === 1);

  return (
    <section id="fontes" className="space-y-5 rounded-xl border border-o2-navy/15 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Fontes e vínculos</h2>
          <p className="text-xs text-gray-500">
            Como cada sistema escreve esta imobiliária. Nada conta para ela sem vínculo confirmado.
          </p>
        </div>
        <form action={marcarRevisao} className="flex items-center gap-2">
          <Hidden campos={{ ...base, revisada: revisada ? "0" : "1" }} />
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${revisada ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}
          >
            {revisada
              ? `revisada${ficha.revisada_em ? ` em ${new Date(ficha.revisada_em).toLocaleDateString("pt-BR")}` : ""}`
              : "revisão pendente"}
          </span>
          <button type="submit" className={revisada ? botaoSecundario : botaoPrimario}>
            {revisada ? "Reabrir revisão" : "Marcar como revisada"}
          </button>
        </form>
      </div>

      {/* Receita + grupo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <p className="font-semibold text-o2-navy">Receita (CNPJ)</p>
          {ficha.receita_situacao ? (
            <>
              <p>{ficha.receita_razao_social}</p>
              {ficha.receita_nome_fantasia && <p>Nome fantasia: {ficha.receita_nome_fantasia}</p>}
              <p className={/ativa/i.test(ficha.receita_situacao) ? "text-green-700" : "font-medium text-red-700"}>
                Situação: {ficha.receita_situacao}
              </p>
            </>
          ) : (
            <p>Não consultada (CPF ou CNPJ inválido).</p>
          )}
        </div>
        <form action={definirGrupo} className="space-y-2 rounded-lg bg-gray-50 p-3 text-xs">
          <Hidden campos={base} />
          <p className="font-semibold text-o2-navy">Grupo</p>
          <select name="grupo_id" defaultValue={ficha.grupo_id ?? "__nenhum"} className="w-full rounded border border-gray-300 px-2 py-1">
            <option value="__nenhum">Sem grupo (ela é o próprio grupo)</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>{g.nome}</option>
            ))}
          </select>
          <input name="grupo_novo" placeholder="…ou criar grupo novo (nome)" className="w-full rounded border border-gray-300 px-2 py-1" />
          <button type="submit" className={botaoSecundario}>Salvar grupo</button>
        </form>
      </div>

      {/* Sugestões */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Sugestões para confirmar ({sugeridos.length}{volumeSugerido ? ` · ${volumeSugerido.toLocaleString("pt-BR")} aparições` : ""})
        </h3>
        {unicas.length > 1 && (
          <form action={confirmarSugestoesUnicas} className="flex flex-wrap items-center gap-2 rounded-lg bg-o2-navy/5 px-3 py-2 text-xs text-o2-navy">
            <Hidden campos={base} />
            <span>
              {unicas.length} sugestões têm o nome igual e apontam só para esta ficha ({unicas.map((r) => r.nome_original).slice(0, 4).join(", ")}
              {unicas.length > 4 ? "…" : ""}).
            </span>
            <button type="submit" className={botaoPrimario}>Confirmar todas ({unicas.length})</button>
          </form>
        )}
        {sugeridos.length === 0 && <p className="text-xs text-gray-400">Nenhuma sugestão pendente.</p>}
        {sugeridos.map((r) => {
          const minha = r.sugestoes.find((s) => s.imobiliaria_id === ficha.id);
          const outras = r.sugestoes.filter((s) => s.imobiliaria_id !== ficha.id);
          return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
              <div className="min-w-0 text-xs">
                <p className="text-sm font-medium text-o2-navy">“{r.nome_original}”</p>
                <p className="text-gray-600">
                  {ROTULO_FONTE[r.fonte] ?? r.fonte} · {r.volume.toLocaleString("pt-BR")} aparição(ões) · <Anos anos={r.anos} />
                  {minha && <> · {minha.motivo}</>}
                </p>
                {outras.length > 0 && (
                  <p className="text-yellow-800">Também sugerido para: {outras.map((s) => nomesFichas[s.imobiliaria_id] ?? "outra ficha").join(" · ")}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <form action={ligarRegistro}>
                  <Hidden campos={{ ...base, registro_id: r.id, metodo: r.metodo_vinculo ?? "manual" }} />
                  <button type="submit" className={botaoPrimario}>É esta</button>
                </form>
                <form action={recusarSugestao}>
                  <Hidden campos={{ ...base, registro_id: r.id }} />
                  <button type="submit" className={botaoSecundario}>Não é esta</button>
                </form>
                <form action={ignorarRegistro}>
                  <Hidden campos={{ ...base, registro_id: r.id }} />
                  <button type="submit" className={botaoLink} title="Nome que não é imobiliária (ex.: O2, TESTE)">Não é imobiliária</button>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ligados */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Ligados a esta ficha ({ligados.length}{volumeLigado ? ` · ${volumeLigado.toLocaleString("pt-BR")} aparições de produção` : ""})
        </h3>
        {ligados.length === 0 && <p className="text-xs text-gray-400">Nenhum vínculo confirmado ainda.</p>}
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {ligados.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <div className="min-w-0">
                <span className="font-medium text-o2-navy">{r.nome_original || r.chave_externa}</span>{" "}
                <span className="text-gray-500">
                  · {ROTULO_FONTE[r.fonte] ?? r.fonte}
                  {r.volume ? ` · ${r.volume.toLocaleString("pt-BR")}` : ""}
                  {r.anos?.length ? <> · <Anos anos={r.anos} /></> : null}
                  {" · "}
                  {r.confirmado_por_email === "automatico"
                    ? `automático (${ROTULO_METODO[r.metodo_vinculo ?? ""] ?? r.metodo_vinculo})`
                    : `confirmado por ${r.confirmado_por_email?.split("@")[0] ?? "—"}`}
                </span>
              </div>
              <form action={desfazerVinculo}>
                <Hidden campos={{ ...base, registro_id: r.id }} />
                <button type="submit" className={botaoLink}>Desfazer</button>
              </form>
            </li>
          ))}
        </ul>
      </div>

      {/* Dados das fontes */}
      {dados.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dados que as fontes ligadas trazem</h3>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {dados.map((d) => {
              const igual = (valorAtual[d.campo] ?? "").trim().toLowerCase() === d.valor.toLowerCase();
              return (
                <li key={`${d.campo}|${d.valor}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="text-gray-500">{d.campo}:</span> <span className="font-medium text-o2-navy">{d.valor}</span>
                    <span className="text-gray-400"> · {d.origem}</span>
                  </div>
                  {igual ? (
                    <span className="text-green-700">já está na ficha</span>
                  ) : (
                    <form action={usarDadoNaFicha}>
                      <Hidden campos={{ ...base, campo: d.campo, valor: d.valor }} />
                      <button type="submit" className={botaoSecundario}>
                        {valorAtual[d.campo] ? "Trocar na ficha" : "Usar na ficha"}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Ligar outro nome */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ligar outro nome a esta ficha</h3>
        <form method="get" action={`${voltarPara}#fontes`} className="flex gap-2">
          <input name="buscar_nome" defaultValue={buscaTermo} placeholder="Ex.: RENASCENÇA, R&SA…" className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          <button type="submit" className={botaoSecundario}>Buscar</button>
        </form>
        {buscaTermo && buscaResultados.length === 0 && <p className="text-xs text-gray-400">Nenhum nome solto encontrado.</p>}
        {buscaResultados.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs">
            <div>
              <span className="font-medium text-o2-navy">“{r.nome_original}”</span>{" "}
              <span className="text-gray-500">
                · {ROTULO_FONTE[r.fonte] ?? r.fonte} · {r.volume.toLocaleString("pt-BR")} · <Anos anos={r.anos} />
                {r.situacao === "sugerido" && r.sugestoes.length > 0 && (
                  <> · sugerido para {r.sugestoes.map((s) => nomesFichas[s.imobiliaria_id] ?? "outra ficha").join(" · ")}</>
                )}
              </span>
            </div>
            <form action={ligarRegistro}>
              <Hidden campos={{ ...base, registro_id: r.id, metodo: "manual" }} />
              <button type="submit" className={botaoPrimario}>Ligar a esta ficha</button>
            </form>
          </div>
        ))}
      </div>
    </section>
  );
}
