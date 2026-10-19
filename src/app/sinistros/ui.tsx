import { CLASSE_VEZ, ETAPAS, type EtapaSinistro } from "@/lib/sinistros/regras";

export const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";
export const labelClass = "mb-1 block text-xs font-medium text-gray-600";
export const botaoPrimario =
  "inline-flex items-center justify-center rounded-full bg-o2-coral px-5 py-2 text-sm font-semibold text-white hover:opacity-90";
export const botaoSecundario =
  "inline-flex items-center justify-center rounded-full border border-o2-navy px-5 py-2 text-sm font-semibold text-o2-navy hover:bg-o2-navy hover:text-white";
export const cartao = "rounded-xl border border-gray-200 bg-white p-5";

export function EtiquetaEtapa({ etapa, visao }: { etapa: string; visao: "imobiliaria" | "o2" }) {
  const e = ETAPAS[etapa as EtapaSinistro];
  if (!e) return <span className="text-xs">{etapa}</span>;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${CLASSE_VEZ[e.vez]}`}>
      {visao === "imobiliaria" ? e.tituloImobiliaria : e.titulo}
    </span>
  );
}

export function Aviso({ tipo, children }: { tipo: "erro" | "sucesso" | "alerta" | "info"; children: React.ReactNode }) {
  const cls = {
    erro: "border-red-300 bg-red-50 text-red-700",
    sucesso: "border-green-300 bg-green-50 text-green-800",
    alerta: "border-orange-300 bg-orange-50 text-orange-900",
    info: "border-blue-200 bg-blue-50 text-blue-900",
  }[tipo];
  return <div className={`rounded-lg border p-3 text-sm ${cls}`}>{children}</div>;
}

export function enderecoCurto(s: { imovel_logradouro?: string | null; imovel_numero?: string | null; imovel_complemento?: string | null }) {
  return [s.imovel_logradouro, s.imovel_numero, s.imovel_complemento].filter(Boolean).join(", ") || "—";
}
