"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const ativo = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition ${
        ativo ? "border-o2-coral text-white" : "border-transparent text-white/60 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}
