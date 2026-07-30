-- Relatório de Preparação de Visita ("Prospecção"): ferramenta interna (só
-- colaboradores/admin da O2, nunca visível para imobiliárias) que ajuda um
-- colaborador a se preparar para uma visita comercial a uma imobiliária
-- prospect. Junta histórico de cotações (planilhas do Google Sheets, fases
-- seguintes), uma "ficha" da imobiliária (montada por IA a partir de
-- URLs/notas informadas pelo colaborador) e números da própria O2. Fica
-- salvo para consulta futura, evitando que um colega repita a pesquisa de
-- uma imobiliária já visitada. Não referencia a tabela `imobiliarias`
-- porque o prospect normalmente ainda não é uma imobiliária parceira
-- cadastrada no sistema.

create table if not exists relatorios_prospeccao (
  id uuid primary key default gen_random_uuid(),
  criado_por uuid not null references auth.users(id),
  criado_por_email text,
  nome_imobiliaria text not null,
  cnpj_imobiliaria text,
  url_site text,
  url_instagram text,
  notas_manuais text,
  ficha jsonb not null,
  historico_cotacoes jsonb not null default '{}'::jsonb,
  comparativo_regional jsonb not null default '{}'::jsonb,
  numeros_o2 jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table relatorios_prospeccao enable row level security;

-- Acesso interno O2: qualquer colaborador ou admin (mesmo domínio de
-- e-mail) pode ler e escrever qualquer relatório, não só os que ele mesmo
-- criou — a ideia é justamente evitar que um colega repita a pesquisa de
-- uma imobiliária que outro colaborador já visitou.
drop policy if exists "relatorios_prospeccao acesso o2" on relatorios_prospeccao;
create policy "relatorios_prospeccao acesso o2"
on relatorios_prospeccao for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
