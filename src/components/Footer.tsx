import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white py-4 text-center text-xs text-gray-500">
      <Link href="/termos" className="hover:text-o2-navy hover:underline">
        Termos de Uso e Política de Privacidade
      </Link>
      {" · "}O2 Seguros
    </footer>
  );
}
