"use client";

import { useMemo, useState } from "react";
import { apenasDigitos } from "@/lib/pdfComSenha";
import ImobiliariaCard, { type ImobiliariaAdminRow } from "./ImobiliariaCard";

function normalizar(valor: string | null | undefined): string {
  return (valor ?? "").toLowerCase();
}

export default function ListaImobiliarias({ imobiliarias }: { imobiliarias: ImobiliariaAdminRow[] }) {
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return imobiliarias;
    const termoDigitos = apenasDigitos(termo);

    return imobiliarias.filter((i) => {
      if (normalizar(i.nome).includes(termo)) return true;
      if (normalizar(i.email).includes(termo)) return true;
      if (normalizar(i.creci).includes(termo)) return true;
      // Busca por CNPJ/telefone funciona digitando só números, com ou sem
      // máscara -- compara dígito a dígito em vez do texto formatado.
      if (termoDigitos && apenasDigitos(i.cnpj ?? "").includes(termoDigitos)) return true;
      if (termoDigitos && apenasDigitos(i.telefone ?? "").includes(termoDigitos)) return true;
      return false;
    });
  }, [imobiliarias, busca]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CNPJ, e-mail, CRECI ou telefone..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-o2-coral focus:outline-none"
        />
      </div>

      {busca && (
        <p className="text-xs text-gray-500">
          {filtradas.length} de {imobiliarias.length} cadastro(s)
        </p>
      )}

      {filtradas.map((i) => (
        <ImobiliariaCard key={i.id} imobiliaria={i} />
      ))}
      {filtradas.length === 0 && (
        <p className="text-sm text-gray-500">
          {imobiliarias.length === 0 ? "Nenhuma imobiliária cadastrada ainda." : "Nenhum cadastro encontrado pra essa busca."}
        </p>
      )}
    </div>
  );
}
