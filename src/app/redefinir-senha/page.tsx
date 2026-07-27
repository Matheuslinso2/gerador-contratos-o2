"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Estado = "verificando" | "invalido" | "pronto" | "enviando" | "sucesso";

export default function RedefinirSenhaPage() {
  const [estado, setEstado] = useState<Estado>("verificando");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    const { data: assinatura } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "PASSWORD_RECOVERY") setEstado("pronto");
    });

    // Se o evento já disparou antes deste componente montar, a sessão de
    // recuperação já existe — checamos direto pra não travar em "verificando".
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setEstado((atual) => (atual === "verificando" ? "pronto" : atual));
    });

    const semLink = setTimeout(() => {
      setEstado((atual) => (atual === "verificando" ? "invalido" : atual));
    }, 4000);

    return () => {
      assinatura.subscription.unsubscribe();
      clearTimeout(semLink);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (senha.length < 6) {
      setErro("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    setEstado("enviando");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      setErro(error.message);
      setEstado("pronto");
      return;
    }
    setEstado("sucesso");
    setTimeout(() => router.push("/"), 1500);
  }

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      <div className="flex justify-center">
        <Image src="/o2-logo-color.png" alt="O2 Seguros" width={140} height={83} priority />
      </div>
      <h1 className="text-center text-xl font-semibold text-o2-navy">Nova senha</h1>

      {estado === "verificando" && (
        <p className="text-center text-sm text-gray-600">Verificando o link...</p>
      )}

      {estado === "invalido" && (
        <div className="space-y-3 text-center">
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            Este link é inválido ou já expirou.
          </p>
          <Link href="/esqueci-senha" className="font-medium text-o2-navy underline">
            Solicitar um novo link
          </Link>
        </div>
      )}

      {estado === "sucesso" && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-center text-sm text-green-700">
          Senha redefinida! Entrando...
        </p>
      )}

      {(estado === "pronto" || estado === "enviando") && (
        <form onSubmit={handleSubmit} className="space-y-3">
          {erro && (
            <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
          )}
          <label htmlFor="nova-senha" className="sr-only">Nova senha</label>
          <input
            id="nova-senha"
            type="password"
            placeholder="Nova senha (mín. 6 caracteres)"
            required
            minLength={6}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <button
            type="submit"
            disabled={estado === "enviando"}
            className="w-full rounded-full bg-o2-coral px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {estado === "enviando" ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      )}
    </main>
  );
}
