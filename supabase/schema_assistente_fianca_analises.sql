-- Assistente de Vendas de Seguro Fiança: registra cada análise gerada
-- (entrada + resultado) e o feedback do negociador sobre precisão e
-- utilidade, pra permitir revisar e melhorar o prompt com o tempo.
-- Aplicado direto no projeto em 25/08/2026 via MCP do Supabase -- este
-- arquivo é só o registro/documentação, igual aos demais schema_*.sql.

create table if not exists assistente_fianca_analises (
  id uuid primary key default gen_random_uuid(),
  criado_por text not null,
  entrada_tipo text not null check (entrada_tipo in ('texto', 'imagem')),
  entrada_texto text,
  entrada_imagem_nome text,
  resultado jsonb not null,
  feedback_precisao smallint check (feedback_precisao between 1 and 5),
  feedback_utilidade smallint check (feedback_utilidade between 1 and 5),
  feedback_comentario text,
  feedback_at timestamptz,
  created_at timestamptz not null default now()
);

alter table assistente_fianca_analises enable row level security;

-- Uso interno O2: qualquer colaborador vê todas as análises (permite
-- revisar qualidade em equipe), mas só quem gerou insere/atualiza a própria.
create policy "colaborador o2 le todas as analises" on assistente_fianca_analises
  for select
  using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

create policy "colaborador o2 insere a propria analise" on assistente_fianca_analises
  for insert
  with check (criado_por = auth.jwt() ->> 'email');

create policy "colaborador o2 atualiza o proprio feedback" on assistente_fianca_analises
  for update
  using (criado_por = auth.jwt() ->> 'email')
  with check (criado_por = auth.jwt() ->> 'email');
