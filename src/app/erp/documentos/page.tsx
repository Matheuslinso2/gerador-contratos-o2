import ListaDocumentos from "./ListaDocumentos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apólices" };

// Etapa "Apólices" do processo do ERP: todos os documentos (apólices, endossos, faturas), com os filtros padrão.
export default function ErpDocumentosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ListaDocumentos searchParams={searchParams} />;
}
