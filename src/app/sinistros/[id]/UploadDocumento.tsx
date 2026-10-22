"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { registrarDocumento } from "../actions";

const ACEITOS = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx";
const LIMITE_MB = 50;

function nomeSeguro(nome: string) {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-120);
}

// Sobe o arquivo direto do navegador pro bucket privado `sinistros` (o
// corpo de Server Action na Vercel tem teto de ~4,5 MB) e só depois
// registra a linha em sinistro_documentos. Mesmo padrão das Faturas.
export default function UploadDocumento({ id, tipo, rotulo = "Enviar arquivo", pasta = null }: { id: string; tipo: string; rotulo?: string; pasta?: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolher(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErro(null);
    const supabase = createClient();
    const lista = Array.from(arquivos);
    for (const [i, arquivo] of lista.entries()) {
      if (arquivo.size > LIMITE_MB * 1024 * 1024) {
        setErro(`${arquivo.name}: maior que ${LIMITE_MB} MB.`);
        continue;
      }
      setEstado(`Enviando ${i + 1} de ${lista.length}…`);
      const caminho = `${id}/${tipo}/${Date.now()}-${nomeSeguro(arquivo.name)}`;
      const { error } = await supabase.storage
        .from("sinistros")
        .upload(caminho, arquivo, { contentType: arquivo.type || "application/octet-stream" });
      if (error) {
        setErro(`${arquivo.name}: ${error.message}`);
        continue;
      }
      const r = await registrarDocumento(id, tipo, caminho, arquivo.name, arquivo.size, pasta);
      if (!r.ok) setErro(`${arquivo.name}: ${r.erro}`);
    }
    setEstado(null);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input ref={input} type="file" multiple accept={ACEITOS} className="hidden" onChange={(e) => aoEscolher(e.target.files)} />
      <button
        type="button"
        disabled={!!estado}
        onClick={() => input.current?.click()}
        className="whitespace-nowrap rounded-full border border-o2-coral px-3 py-1 text-xs font-semibold text-o2-coral hover:bg-o2-coral hover:text-white disabled:opacity-60"
      >
        {estado ?? rotulo}
      </button>
      {erro && <span className="text-xs text-red-600">{erro}</span>}
    </div>
  );
}
