"use client";

import { useState, useTransition } from "react";
import { BANCOS, rotuloBanco } from "@/lib/sinistros/bancos";
import { buscarNomePorDocumento } from "../operacao";
import { inputClass, labelClass } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any -- linha do Supabase sem tipos gerados */

const docBr = (d: string) => {
  const n = d.replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
};

// "341" ou "341 - Itaú" guardado antes -> o rótulo da lista ("341 – Itaú Unibanco").
function bancoInicial(valor: string | null) {
  if (!valor) return "";
  const cod = valor.trim().match(/^\d{1,3}/)?.[0]?.padStart(3, "0");
  const achado = cod ? BANCOS.find((b) => b.codigo === cod) : null;
  return achado ? rotuloBanco(achado) : valor;
}

// Etapa 4: ao digitar o CPF/CNPJ o sistema puxa o nome / razão social; o banco
// é uma lista com número e nome, como nos sistemas das seguradoras.
export default function CamposFavorecido({ s }: { s: any }) {
  const [nome, setNome] = useState<string>(s.favorecido_nome ?? "");
  const [documento, setDocumento] = useState<string>(s.favorecido_documento ?? "");
  const [banco, setBanco] = useState(bancoInicial(s.favorecido_banco));
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscando, iniciar] = useTransition();

  function aoSairDoDocumento() {
    const d = documento.replace(/\D/g, "");
    if (d.length !== 11 && d.length !== 14) return;
    setDocumento(docBr(documento));
    iniciar(async () => {
      const r = await buscarNomePorDocumento(d);
      if (r.nome) {
        setNome(r.nome);
        setAviso(`Nome preenchido (${r.origem}) — confira.`);
      } else setAviso(d.length === 11 ? "CPF não encontrado nas bases da O2: digite o nome." : "CNPJ não encontrado: digite a razão social.");
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass}>CPF/CNPJ do favorecido</label>
        <input
          name="favorecido_documento"
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
          onBlur={aoSairDoDocumento}
          inputMode="numeric"
          className={inputClass}
        />
        {(buscando || aviso) && <p className="mt-0.5 text-xs text-gray-500">{buscando ? "Buscando o nome…" : aviso}</p>}
      </div>
      <div>
        <label className={labelClass}>Nome / razão social do favorecido</label>
        <input name="favorecido_nome" value={nome} onChange={(e) => setNome(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Banco</label>
        <input
          name="favorecido_banco"
          list="bancos-favorecido"
          value={banco}
          onChange={(e) => setBanco(e.target.value)}
          placeholder="Escolha da lista: código – nome"
          className={inputClass}
        />
        <datalist id="bancos-favorecido">
          {BANCOS.map((b) => (
            <option key={b.codigo} value={rotuloBanco(b)} />
          ))}
        </datalist>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Agência</label>
          <input name="favorecido_agencia" defaultValue={s.favorecido_agencia ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Conta</label>
          <input name="favorecido_conta" defaultValue={s.favorecido_conta ?? ""} className={inputClass} />
        </div>
      </div>
    </div>
  );
}
