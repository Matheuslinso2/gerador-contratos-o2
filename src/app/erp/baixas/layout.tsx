import BaixasLateral from "./BaixasLateral";

// Baixas tem duas telas lado a lado: Conferência do mês (a tela de sempre) e Gestão das baixas.
export default function BaixasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1760px] flex-1 flex-col gap-4 px-4 pt-4 lg:flex-row lg:items-start">
      <BaixasLateral />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
