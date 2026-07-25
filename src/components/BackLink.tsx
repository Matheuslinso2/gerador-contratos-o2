import Link from "next/link";

export default function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline"
    >
      ← Voltar para o início
    </Link>
  );
}
