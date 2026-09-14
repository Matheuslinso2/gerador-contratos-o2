import type { ReactNode } from "react";

// Cabeçalho padrão de toda ferramenta simples do Workspace (formulário/tela
// de ação, sem tabela densa) -- ícone + título + subtítulo opcional. Nasceu
// em Faturas/Repasses; padronizado (10/09/2026) pro resto das ferramentas
// simples usar o mesmo componente em vez de replicar a marcação.
export default function PageHeader({
  icon,
  titulo,
  subtitulo,
}: {
  icon: ReactNode;
  titulo: string;
  subtitulo?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-o2-coral text-white shadow-sm">
        {icon}
      </span>
      <div>
        <h1 className="text-xl font-semibold text-o2-navy">{titulo}</h1>
        {subtitulo && <p className="text-sm text-gray-500">{subtitulo}</p>}
      </div>
    </div>
  );
}
