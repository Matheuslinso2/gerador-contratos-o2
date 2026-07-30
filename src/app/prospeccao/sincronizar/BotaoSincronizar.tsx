"use client";

import { useFormStatus } from "react-dom";

export default function BotaoSincronizar() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Sincronizando... (pode levar até 1 minuto)" : "Sincronizar agora"}
    </button>
  );
}
