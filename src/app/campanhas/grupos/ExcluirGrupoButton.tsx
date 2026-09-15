"use client";

// Mesmo padrão de src/app/campanhas/[id]/ConfirmarDisparoButton.tsx
// -- excluir grupo não desfaz campanhas já enviadas, mas perde o atalho de
// reusar a lista, então pede confirmação antes de deixar o submit passar.
export function ExcluirGrupoButton({ nomeGrupo }: { nomeGrupo: string }) {
  return (
    <button
      type="submit"
      className="text-sm font-medium text-red-600 hover:underline"
      onClick={(e) => {
        if (!window.confirm(`Excluir o grupo "${nomeGrupo}"? Isso não afeta campanhas já enviadas, só o atalho pra reusar essa lista.`)) {
          e.preventDefault();
        }
      }}
    >
      Excluir grupo
    </button>
  );
}
