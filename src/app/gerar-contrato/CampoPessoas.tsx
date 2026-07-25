"use client";

import { useRef, useState } from "react";

export default function CampoPessoas({
  fieldName,
  placeholder,
}: {
  fieldName: string;
  placeholder: string;
}) {
  const nextId = useRef(1);
  const [ids, setIds] = useState<number[]>([0]);

  return (
    <div className="space-y-2">
      {ids.map((id, i) => (
        <div key={id} className="flex gap-2">
          <input
            name={fieldName}
            placeholder={ids.length > 1 ? `${placeholder} ${i + 1}` : placeholder}
            required={i === 0}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          {ids.length > 1 && (
            <button
              type="button"
              onClick={() => setIds((prev) => prev.filter((x) => x !== id))}
              className="shrink-0 rounded-lg border border-gray-300 px-3 text-gray-500 hover:border-red-300 hover:text-red-600"
              aria-label={`Remover ${placeholder.toLowerCase()} ${i + 1}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setIds((prev) => [...prev, nextId.current++])}
        className="text-sm font-medium text-o2-navy hover:underline"
      >
        + Adicionar outro {placeholder.toLowerCase()} (solidário)
      </button>
    </div>
  );
}
