"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { anexarArquivoPagamento } from "../operacao";

const ACEITOS = ".xls,.xlsx,.pdf,.png,.jpg,.jpeg";
const LIMITE_MB = 50;

function nomeSeguro(nome: string) {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-120);
}

// Sobe a planilha do pagamento direto do navegador para o bucket `sinistros`
// (a Server Action na Vercel não aguenta arquivo -- foi por isso que o anexo
// não entrava, 23/10/2026).
async function subir(id: string, arquivo: File): Promise<{ caminho?: string; erro?: string }> {
  if (arquivo.size > LIMITE_MB * 1024 * 1024) return { erro: `maior que ${LIMITE_MB} MB` };
  const caminho = `${id}/pagamentos/${Date.now()}-${nomeSeguro(arquivo.name)}`;
  const { error } = await createClient()
    .storage.from("sinistros")
    .upload(caminho, arquivo, { contentType: arquivo.type || "application/octet-stream" });
  return error ? { erro: error.message } : { caminho };
}

// Dentro do formulário "Registrar indenização": envia ao escolher o arquivo e
// guarda o caminho em campos ocultos.
export function CampoAnexoPagamento({ id }: { id: string }) {
  const [anexo, setAnexo] = useState<{ caminho: string; nome: string } | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setEstado("Enviando…");
    const r = await subir(id, arquivo);
    if (r.caminho) {
      setAnexo({ caminho: r.caminho, nome: arquivo.name });
      setEstado(null);
    } else setEstado(`Não foi possível enviar: ${r.erro}`);
  }
  return (
    <div className="text-xs">
      <input type="hidden" name="anexo_path" value={anexo?.caminho ?? ""} />
      <input type="hidden" name="anexo_nome" value={anexo?.nome ?? ""} />
      <input type="file" accept={ACEITOS} onChange={(e) => aoEscolher(e.target.files?.[0])} className="block w-full text-xs" />
      {anexo && <span className="text-green-700">✓ {anexo.nome} anexado</span>}
      {estado && <span className={estado.startsWith("Não") ? "text-red-600" : "text-gray-500"}>{estado}</span>}
    </div>
  );
}

// Na tabela do histórico de pagamento: anexa (ou troca) depois de registrado.
export function AnexarPagamento({ id, indenizacaoId, temAnexo }: { id: string; indenizacaoId: string; temAnexo: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<string | null>(null);
  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setEstado("Enviando…");
    const r = await subir(id, arquivo);
    if (!r.caminho) return setEstado(`Erro: ${r.erro}`);
    const g = await anexarArquivoPagamento(id, indenizacaoId, r.caminho, arquivo.name);
    setEstado(g.ok ? null : `Erro: ${g.erro}`);
    if (input.current) input.current.value = "";
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col">
      <input ref={input} type="file" accept={ACEITOS} className="hidden" onChange={(e) => aoEscolher(e.target.files?.[0])} />
      <button type="button" disabled={!!estado} onClick={() => input.current?.click()} className="text-left text-o2-coral hover:underline disabled:opacity-60">
        {estado ?? (temAnexo ? "trocar anexo" : "+ anexar")}
      </button>
    </span>
  );
}
