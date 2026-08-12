import Image from "next/image";
import CapitalizacaoForm from "./CapitalizacaoForm";

export default function FormularioCapitalizacaoPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <Image src="/o2-logo-color.png" alt="O2 Seguros" width={140} height={83} priority />
        <div>
          <h1 className="text-xl font-semibold text-o2-navy">Ficha Online — Título de Capitalização</h1>
          <p className="mt-1 text-sm text-gray-600">
            Preencha os dados abaixo para dar entrada no título de capitalização junto à O2 Seguros.
          </p>
        </div>
      </div>

      <CapitalizacaoForm />
    </main>
  );
}
