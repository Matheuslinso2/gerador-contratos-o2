// Nº da apólice de um documento. Cartão de LOTE do Bitrix (renovação de várias apólices da imobiliária) guarda todos os números num campo só,
// separados por ";" — isso é um lote, não o número de uma apólice (Matheus, 03/11/2026). Mostra "Lote de N apólices" e a lista recolhida.
export function numerosDoLote(numero: string | null): string[] {
  return (numero ?? "").split(";").map((s) => s.trim()).filter(Boolean);
}

export default function NumeroApolice({ numero, vazio = "não emitida" }: { numero: string | null; vazio?: string }) {
  const lista = numerosDoLote(numero);
  if (lista.length <= 1) return <>{numero ?? vazio}</>;
  return (
    <details className="inline-block align-top">
      <summary className="cursor-pointer font-semibold text-gray-900">
        lote de {lista.length} apólices <span className="text-xs font-normal text-gray-500">(ver os números)</span>
      </summary>
      <span className="mt-1 block max-w-3xl whitespace-normal break-words text-xs font-normal text-gray-600">{lista.join("; ")}</span>
    </details>
  );
}
