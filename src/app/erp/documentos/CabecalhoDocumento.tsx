import { formatarData } from "@/lib/sinistros/regras";
import { SITUACOES, tipoDoCabecalho } from "@/lib/erp/documentos";
import InfoLegenda from "@/components/InfoLegenda";

// ERP O2 — cabeçalho padrão do documento (Matheus 28/10/2026): compacto, com o que identifica o seguro de relance:
// Tipo de documento · Titular do seguro · Produto · Seguradora · Vigência. O mesmo padrão vale nas listas e nas demais telas.
// Titular: Fiança = proprietário (segurado/locador); demais produtos = segurado/cliente do documento.
export type DadosCabecalho = {
  tipo: string;
  tipo_corp: string | null;
  situacao: string;
  modo_cobranca: string | null;
  nosso_numero: number;
  nosso_numero_corp: number | null;
  numero_apolice: string | null;
  titular: string | null;
  titularPapel: string;
  produto_nome: string | null;
  seguradora_nome: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  inquilino: string | null;
  imovel: string | null;
  extras: { texto: string; cor: string }[];
};

function Celula({ rotulo, valor, sub, className = "", info }: { rotulo: string; valor: React.ReactNode; sub?: React.ReactNode; className?: string; info?: React.ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {rotulo}
        {info ? <InfoLegenda titulo={rotulo}>{info}</InfoLegenda> : null}
      </div>
      <div className="truncate text-sm font-semibold text-gray-900">{valor ?? <span className="font-normal text-gray-400">—</span>}</div>
      {sub ? <div className="truncate text-[11px] text-gray-500">{sub}</div> : null}
    </div>
  );
}

function situacaoDaVigencia(ini: string | null, fim: string | null, situacao: string): string | null {
  if (situacao !== "vigente" && situacao !== "vencido") return null;
  if (!fim) return null;
  const dias = Math.round((new Date(fim + "T00:00:00").getTime() - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime()) / 86400000);
  if (dias >= 0) return dias === 0 ? "vence hoje" : `faltam ${dias} dia(s)`;
  void ini;
  return `venceu há ${-dias} dia(s)`;
}

export default function CabecalhoDocumento({ c }: { c: DadosCabecalho }) {
  const tipo = tipoDoCabecalho(c);
  const vig = c.vigencia_inicio || c.vigencia_fim ? `${formatarData(c.vigencia_inicio)} a ${formatarData(c.vigencia_fim)}` : null;
  return (
    <header className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-xl border-b border-gray-100 bg-gray-50/70 px-4 py-2">
        <span className={`rounded-md px-2.5 py-0.5 text-sm font-bold uppercase tracking-wide ${tipo.cor}`}>{tipo.nome}</span>
        {tipo.detalhe ? <span className="text-xs text-gray-500">{tipo.detalhe}</span> : null}
        <span className="text-sm text-gray-600">
          Código O2 do documento <strong className="text-gray-900">{c.nosso_numero}</strong>
        </span>
        <span className="text-sm text-gray-600">
          Nº da apólice <strong className="text-gray-900">{c.numero_apolice ?? "não emitida"}</strong>
        </span>
        <span className="text-xs text-gray-500">{c.nosso_numero_corp ? `Nosso nº do Corp ${c.nosso_numero_corp}` : "nasceu no ERP"}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-o2-navy px-2.5 py-0.5 text-xs font-semibold text-white">{SITUACOES[c.situacao] ?? c.situacao}</span>
          {c.extras.map((e) => (
            <span key={e.texto} className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.cor}`}>
              {e.texto}
            </span>
          ))}
          <InfoLegenda titulo="Cabeçalho do documento" alinhar="direita">
            Resumo que identifica o documento. Tipo: Cotação, Proposta (fica em Emissão até virar apólice), Apólice (nova ou renovação), Apólice na Fatura (cobrada dentro da fatura da imobiliária), Fatura ou Endosso (cobrança, devolução, sem prêmio, restituição, cancelamento). Código O2 do documento é o número do ERP; Nº da apólice é o da seguradora (aparece “não emitida” enquanto não houver); Nosso nº do Corp é o número no Corp (“nasceu no ERP” quando não veio de lá). A etiqueta escura é a situação do documento. As etiquetas coloridas ao lado avisam: parcelas em aberto na seguradora (ela avisou que o cliente não pagou), pré-cadastro com revisão pendente, fora da conta do Power BI (documento que não entra na regra de produção copiada do Power BI) e mês fechado (documento de um mês já encerrado).
          </InfoLegenda>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 md:grid-cols-6">
        <Celula className="col-span-2" rotulo="Titular do seguro" info="Na Fiança, é o proprietário do imóvel (segurado e locador), lido do PDF da apólice quando existe, ou do card. Nos demais produtos, é o segurado/cliente do documento. Na Fiança, o inquilino (garantido) aparece na linha de baixo do cabeçalho. Sem titular ligado, aparece “titular não ligado”." valor={c.titular ?? <span className="font-normal text-gray-400">titular não ligado</span>} sub={c.titularPapel} />
        <Celula rotulo="Produto" valor={c.produto_nome} />
        <Celula rotulo="Seguradora" valor={c.seguradora_nome} />
        <Celula className="col-span-2" rotulo="Vigência" info="Período de cobertura do documento. Para documentos vigentes ou vencidos, a linha de baixo mostra quantos dias faltam para vencer ou há quantos dias venceu." valor={vig} sub={situacaoDaVigencia(c.vigencia_inicio, c.vigencia_fim, c.situacao)} />
      </div>
      {c.inquilino || c.imovel ? (
        <div className="flex flex-wrap gap-x-6 gap-y-0.5 border-t border-gray-100 px-4 py-1.5 text-xs text-gray-600">
          {c.inquilino ? (
            <span>
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Inquilino </span>
              <span className="font-medium text-gray-800">{c.inquilino}</span>
            </span>
          ) : null}
          {c.imovel ? (
            <span>
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Imóvel </span>
              <span className="font-medium text-gray-800">{c.imovel}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

