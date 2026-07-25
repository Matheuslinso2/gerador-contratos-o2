-- Auditor de Contratos: analisa um contrato já pronto (colado, .docx ou .pdf) e
-- devolve um diagnóstico de erros/inconsistências, sem gerar um contrato novo.
-- Mesma conta/login da imobiliária, isolado por dono como as demais tabelas.

create table if not exists auditorias_contrato (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references imobiliarias(id) on delete cascade,
  nome_arquivo text,
  status_geral text not null,
  tipo_garantia_identificada text,
  relatorio jsonb not null,
  created_at timestamptz not null default now()
);

alter table auditorias_contrato enable row level security;

drop policy if exists "auditorias por dono" on auditorias_contrato;
create policy "auditorias por dono"
on auditorias_contrato for all
using (imobiliaria_id in (select id from imobiliarias where user_id = auth.uid()))
with check (imobiliaria_id in (select id from imobiliarias where user_id = auth.uid()));
