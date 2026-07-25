-- Fase 2: configuração da imobiliária
-- Rode este script no Supabase (SQL Editor) do projeto gerador-contratos-o2

create table if not exists imobiliarias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text not null,
  creci text,
  endereco text,
  texto_base_contrato text not null,
  indice_reajuste text not null,
  percentual_multa_atraso numeric not null,
  percentual_juros_mora numeric not null,
  percentual_honorarios_advocaticios numeric not null,
  dia_vencimento_aluguel smallint not null check (dia_vencimento_aluguel between 1 and 31),
  plataforma_assinatura text,
  created_at timestamptz not null default now()
);
