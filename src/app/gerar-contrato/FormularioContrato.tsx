"use client";

import { useMemo, useState } from "react";
import { gerarContrato } from "./actions";
import CampoPessoas from "./CampoPessoas";
import CampoEndereco from "@/components/CampoEndereco";
import { limparDigitacaoMoeda, moedaParaNumero, formatarMoeda } from "@/lib/validacoesBr";

type TipoGarantia = { id: string; nome: string };
type Produto = {
  id: string;
  nome: string;
  tipo_garantia_id: string;
  seguradoras: { nome: string } | { nome: string }[] | null;
};
const NOME_TIPO_INCENDIO = "Seguro Incêndio Imobiliário";
const NOME_TIPO_FIADOR = "Fiador";
const NOME_TIPO_CAUCAO = "Caução";
const NOME_TIPO_TITULO = "Título de Capitalização";

export default function FormularioContrato({
  tiposGarantia,
  produtos,
}: {
  tiposGarantia: TipoGarantia[];
  produtos: Produto[];
}) {
  const tipoIncendio = tiposGarantia.find((t) => t.nome === NOME_TIPO_INCENDIO);
  const tiposGarantiaDaLocacao = tiposGarantia.filter((t) => t.nome !== NOME_TIPO_INCENDIO);
  const produtosIncendio = useMemo(
    () => (tipoIncendio ? produtos.filter((p) => p.tipo_garantia_id === tipoIncendio.id) : []),
    [produtos, tipoIncendio]
  );

  const [tipoGarantiaId, setTipoGarantiaId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [produtoIncendioId, setProdutoIncendioId] = useState("");
  const [laudoModo, setLaudoModo] = useState<"nenhum" | "link" | "arquivo_separado" | "arquivo_embutido">(
    "nenhum"
  );
  const [valorAluguel, setValorAluguel] = useState("");
  const [valorAluguelExibido, setValorAluguelExibido] = useState("");
  const [valorCaucao, setValorCaucao] = useState("");
  const [caucaoEditadaManualmente, setCaucaoEditadaManualmente] = useState(false);

  const sugestaoCaucao = valorAluguel ? (Number(valorAluguel) * 3).toFixed(2) : "";
  const valorCaucaoExibido = caucaoEditadaManualmente ? valorCaucao : sugestaoCaucao;

  const produtosFiltrados = useMemo(
    () => produtos.filter((p) => p.tipo_garantia_id === tipoGarantiaId),
    [produtos, tipoGarantiaId]
  );

  const tipoGarantiaSelecionado = tiposGarantiaDaLocacao.find((t) => t.id === tipoGarantiaId)?.nome;

  return (
    <form action={gerarContrato} className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">1. Partes</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Locador(es)</label>
            <CampoPessoas fieldName="locador" placeholder="Locador" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Locatário(s)</label>
            <CampoPessoas fieldName="locatario" placeholder="Locatário" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" name="locador_procurador" />
          Locador representado por procurador/administradora
        </label>

        <div>
          <label className="text-sm text-gray-600">Ocupantes adicionais autorizados (opcional)</label>
          <input
            name="ocupantes_adicionais"
            placeholder="Ocupantes adicionais autorizados (opcional)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
        </div>
      </section>

      <section className="space-y-3 border-t border-gray-200 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">2. Imóvel e locação</h2>
        <CampoEndereco name="endereco_imovel" label="Endereço do imóvel" required />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="text-sm text-gray-600">Finalidade</label>
            <select name="finalidade" required className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none" defaultValue="">
              <option value="">Finalidade...</option>
              <option value="residencial">Residencial</option>
              <option value="nao_residencial">Não residencial</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">Valor do aluguel</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-500">
                R$
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={valorAluguelExibido}
                onChange={(e) => {
                  const limpo = limparDigitacaoMoeda(e.target.value);
                  setValorAluguelExibido(limpo);
                  setValorAluguel(limpo ? String(moedaParaNumero(limpo)) : "");
                }}
                onBlur={() => {
                  if (valorAluguelExibido) setValorAluguelExibido(formatarMoeda(moedaParaNumero(valorAluguelExibido)));
                }}
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 focus:border-o2-coral focus:outline-none"
              />
              <input type="hidden" name="valor_aluguel" value={valorAluguel} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label className="text-sm text-gray-600">Data de início</label>
            <input name="data_inicio" type="date" required className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none" />
          </div>
          <div>
            <label className="text-sm text-gray-600">Prazo (meses)</label>
            <input
              name="prazo_meses"
              type="number"
              min={1}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Dia de vencimento do aluguel</label>
            <input
              name="dia_vencimento_aluguel"
              type="number"
              min={1}
              max={31}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t border-gray-200 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">3. Laudo de vistoria</h2>
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="mb-2 text-sm font-medium text-o2-navy">Como tratar o laudo desta locação?</p>
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                { valor: "nenhum", rotulo: "Não tem" },
                { valor: "link", rotulo: "Link online" },
                { valor: "arquivo_separado", rotulo: "Arquivo (anexo à parte)" },
                { valor: "arquivo_embutido", rotulo: "Arquivo (incluir no contrato)" },
              ] as const
            ).map((opcao) => (
              <label key={opcao.valor} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  name="laudo_modo"
                  value={opcao.valor}
                  checked={laudoModo === opcao.valor}
                  onChange={() => setLaudoModo(opcao.valor)}
                />
                {opcao.rotulo}
              </label>
            ))}
          </div>

          {laudoModo === "link" && (
            <div>
              <label className="text-sm text-gray-600">Link do laudo de vistoria</label>
              <input
                name="laudo_vistoria_url"
                placeholder="Link do laudo de vistoria (plataforma online)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
            </div>
          )}

          {laudoModo === "arquivo_separado" && (
            <div>
              <input
                name="laudo_arquivo"
                type="file"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                O arquivo original não é alterado. Fica disponível para baixar à parte; o
                contrato só cita que ele é parte integrante.
              </p>
            </div>
          )}

          {laudoModo === "arquivo_embutido" && (
            <div>
              <input
                name="laudo_arquivo"
                type="file"
                accept=".pdf"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                Precisa ser um PDF. As páginas originais do laudo (sem nenhuma alteração) são
                coladas ao final do contrato, gerando um único PDF completo para baixar.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3 border-t border-gray-200 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">4. Garantia da locação</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            name="tipo_garantia_id"
            value={tipoGarantiaId}
            onChange={(e) => {
              setTipoGarantiaId(e.target.value);
              setProdutoId("");
            }}
            required
            className="rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          >
            <option value="">Tipo de garantia...</option>
            {tiposGarantiaDaLocacao.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>

          {tipoGarantiaSelecionado !== NOME_TIPO_FIADOR && tipoGarantiaSelecionado !== NOME_TIPO_CAUCAO && (
            <select
              name="produto_id"
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
              required
              className="rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            >
              <option value="">Produto...</option>
              {produtosFiltrados.map((p) => {
                const seguradora = Array.isArray(p.seguradoras) ? p.seguradoras[0] : p.seguradoras;
                return (
                  <option key={p.id} value={p.id}>
                    {seguradora?.nome ? `${seguradora.nome} — ` : ""}
                    {p.nome}
                  </option>
                );
              })}
            </select>
          )}
        </div>

        {tipoGarantiaSelecionado === NOME_TIPO_FIADOR && (
          <div>
            <label className="mb-1 block text-sm text-gray-600">Fiador(es)</label>
            <CampoPessoas fieldName="fiador" placeholder="Fiador" />
          </div>
        )}

        {tipoGarantiaSelecionado === NOME_TIPO_TITULO && (
          <div>
            <label className="text-sm text-gray-600">Proposta do título de capitalização</label>
            <input
              name="titulo_capitalizacao_arquivo"
              type="file"
              accept=".pdf,.docx"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              O valor do título e o número da proposta/garantia são lidos automaticamente do
              arquivo e preenchidos na cláusula. O arquivo não é salvo, só usado nessa hora.
            </p>
          </div>
        )}

        {tipoGarantiaSelecionado === NOME_TIPO_CAUCAO && (
          <div>
            <label className="text-sm text-gray-600">Valor da caução (R$)</label>
            <input
              name="valor_caucao"
              type="number"
              step="0.01"
              required
              placeholder="Valor da caução (R$)"
              value={valorCaucaoExibido}
              onChange={(e) => {
                setValorCaucao(e.target.value);
                setCaucaoEditadaManualmente(true);
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              Preenchido automaticamente com 3x o valor do aluguel (o máximo permitido pela Lei
              do Inquilinato, art. 38 §2º). Pode editar se o valor combinado for menor.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-gray-200 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">5. Seguro incêndio</h2>
        <p className="text-xs text-gray-500">
          Item obrigatório à parte, protege o patrimônio do locador — não é a garantia da locação.
        </p>
        <select
          name="seguro_incendio_produto_id"
          value={produtoIncendioId}
          onChange={(e) => setProdutoIncendioId(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        >
          <option value="">Seguradora / produto do seguro incêndio (opcional por enquanto)...</option>
          {produtosIncendio.map((p) => {
            const seguradora = Array.isArray(p.seguradoras) ? p.seguradoras[0] : p.seguradoras;
            return (
              <option key={p.id} value={p.id}>
                {seguradora?.nome ? `${seguradora.nome} — ` : ""}
                {p.nome}
              </option>
            );
          })}
        </select>
      </section>

      <button
        className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90"
        type="submit"
      >
        Gerar contrato
      </button>
    </form>
  );
}
