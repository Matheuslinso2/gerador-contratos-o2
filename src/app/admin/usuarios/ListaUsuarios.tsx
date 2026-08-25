"use client";

import { excluirUsuario } from "./actions";

function confirmarExclusao(e: React.FormEvent, email: string) {
  if (!confirm(`Excluir o login "${email}"? A pessoa perde acesso imediatamente. Essa ação não pode ser desfeita.`)) {
    e.preventDefault();
  }
}

type Usuario = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
};

export default function ListaUsuarios({ usuarios }: { usuarios: Usuario[] }) {
  return (
    <div className="space-y-3">
      {usuarios.map((u) => (
        <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-o2-navy/10 bg-white p-4">
          <div>
            <p className="font-medium text-o2-navy">{u.email}</p>
            <p className="text-xs text-gray-400">
              Criado em {new Date(u.created_at).toLocaleString("pt-BR")}
              {u.last_sign_in_at && ` · último acesso em ${new Date(u.last_sign_in_at).toLocaleString("pt-BR")}`}
            </p>
          </div>
          <form action={excluirUsuario} onSubmit={(e) => confirmarExclusao(e, u.email)}>
            <input type="hidden" name="id" value={u.id} />
            <input type="hidden" name="email" value={u.email} />
            <button
              type="submit"
              className="rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              Excluir login
            </button>
          </form>
        </div>
      ))}
      {!usuarios.length && <p className="text-sm text-gray-500">Nenhum login encontrado.</p>}
    </div>
  );
}
