import Link from "next/link";

export const PASSOS = ["Identificação", "Coberturas", "Documentos", "Favorecido", "Validação"];

// Barra dos 5 passos do assistente de abertura. Com `id`, os passos já
// liberados viram link (dá pra voltar e corrigir).
export default function Passos({ atual, id }: { atual: number; id?: string }) {
  return (
    <ol className="flex gap-1.5">
      {PASSOS.map((p, i) => {
        const n = i + 1;
        const cls =
          n === atual ? "bg-o2-coral text-white" : n < atual ? "bg-o2-navy text-white" : "bg-gray-100 text-gray-500";
        const conteudo = (
          <span className={`block rounded-md px-2 py-1.5 text-center text-xs font-semibold ${cls}`}>
            {n} · {p}
          </span>
        );
        return (
          <li key={p} className="flex-1">
            {id ? <Link href={`/sinistros/${id}?passo=${n}`}>{conteudo}</Link> : conteudo}
          </li>
        );
      })}
    </ol>
  );
}
