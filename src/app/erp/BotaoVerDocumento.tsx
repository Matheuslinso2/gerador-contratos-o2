import Link from "next/link";

// Botão padrão de abertura de documento (Matheus 28/10): sempre na PRIMEIRA coluna de qualquer listagem que abre um documento.
export default function BotaoVerDocumento({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="text-gray-300">—</span>;
  return (
    <Link
      href={`/erp/documentos/${id}`}
      className="inline-block whitespace-nowrap rounded-lg bg-o2-navy px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-o2-indigo"
    >
      Ver documento
    </Link>
  );
}
