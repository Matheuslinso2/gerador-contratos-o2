-- Fase 4: login e multi-tenant
-- Rode este script no Supabase (SQL Editor) do projeto gerador-contratos-o2

alter table imobiliarias add column if not exists user_id uuid unique references auth.users(id);

-- A partir daqui é RLS (proteção por conta). Antes disso o app já filtra por usuário no código,
-- então isso é a camada extra de segurança no próprio banco.

alter table imobiliarias enable row level security;
alter table contratos enable row level security;
alter table contratos_coberturas enable row level security;
alter table tipos_garantia enable row level security;
alter table seguradoras enable row level security;
alter table produtos enable row level security;
alter table coberturas_adicionais enable row level security;

-- imobiliarias: cada usuário só vê/edita a própria
drop policy if exists "imobiliarias por dono" on imobiliarias;
create policy "imobiliarias por dono"
on imobiliarias for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- contratos: só vê/edita contratos da própria imobiliária
drop policy if exists "contratos por dono" on contratos;
create policy "contratos por dono"
on contratos for all
using (imobiliaria_id in (select id from imobiliarias where user_id = auth.uid()))
with check (imobiliaria_id in (select id from imobiliarias where user_id = auth.uid()));

drop policy if exists "contratos_coberturas por dono" on contratos_coberturas;
create policy "contratos_coberturas por dono"
on contratos_coberturas for all
using (
  contrato_id in (
    select c.id from contratos c
    join imobiliarias i on i.id = c.imobiliaria_id
    where i.user_id = auth.uid()
  )
)
with check (
  contrato_id in (
    select c.id from contratos c
    join imobiliarias i on i.id = c.imobiliaria_id
    where i.user_id = auth.uid()
  )
);

-- biblioteca de cláusulas: leitura livre para qualquer usuário autenticado,
-- escrita só para os e-mails admin (ajuste a lista de e-mails abaixo)
drop policy if exists "tipos_garantia leitura" on tipos_garantia;
create policy "tipos_garantia leitura" on tipos_garantia for select using (auth.uid() is not null);
drop policy if exists "tipos_garantia escrita admin" on tipos_garantia;
create policy "tipos_garantia escrita admin" on tipos_garantia for all
using (auth.jwt() ->> 'email' in ('matheus@o2seguros.com.br'))
with check (auth.jwt() ->> 'email' in ('matheus@o2seguros.com.br'));

drop policy if exists "seguradoras leitura" on seguradoras;
create policy "seguradoras leitura" on seguradoras for select using (auth.uid() is not null);
drop policy if exists "seguradoras escrita admin" on seguradoras;
create policy "seguradoras escrita admin" on seguradoras for all
using (auth.jwt() ->> 'email' in ('matheus@o2seguros.com.br'))
with check (auth.jwt() ->> 'email' in ('matheus@o2seguros.com.br'));

drop policy if exists "produtos leitura" on produtos;
create policy "produtos leitura" on produtos for select using (auth.uid() is not null);
drop policy if exists "produtos escrita admin" on produtos;
create policy "produtos escrita admin" on produtos for all
using (auth.jwt() ->> 'email' in ('matheus@o2seguros.com.br'))
with check (auth.jwt() ->> 'email' in ('matheus@o2seguros.com.br'));

drop policy if exists "coberturas_adicionais leitura" on coberturas_adicionais;
create policy "coberturas_adicionais leitura" on coberturas_adicionais for select using (auth.uid() is not null);
drop policy if exists "coberturas_adicionais escrita admin" on coberturas_adicionais;
create policy "coberturas_adicionais escrita admin" on coberturas_adicionais for all
using (auth.jwt() ->> 'email' in ('matheus@o2seguros.com.br'))
with check (auth.jwt() ->> 'email' in ('matheus@o2seguros.com.br'));
