import ListaDocumentos from "../documentos/ListaDocumentos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Emissão" };

// Etapa "Efetivadas / Emissão": o ERP começa na efetivação da proposta (Matheus 26/10). Fila das propostas
// efetivadas aguardando emissão da apólice, de todos os produtos — a mesma busca de Apólices, com a situação
// "efetivada · em emissão" como filtro padrão (pode trocar no próprio filtro).
export default function ErpEmissaoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ListaDocumentos
      searchParams={searchParams}
      caminho="/erp/emissao"
      titulo="ERP O2 — Efetivadas / Emissão"
      subtitulo="Propostas efetivadas aguardando a emissão da apólice, de todos os produtos. O card vale até a emissão; a apólice emitida confirma ou corrige os dados."
      padrao={{ situacao: "digitado" }}
    />
  );
}
