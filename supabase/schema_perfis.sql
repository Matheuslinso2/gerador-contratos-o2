-- 3 níveis de perfil: imobiliária (padrão), colaborador da O2 (login
-- @o2seguros.com.br que não é o admin) e admin (matheus@o2seguros.com.br).
-- Colaborador e admin enxergam os dados de todas as imobiliárias (leitura),
-- além de poder usar Gerar Contrato/Auditor sem precisar de um cadastro de
-- imobiliária parceira (o sistema cria um registro interno simples pra eles).

alter table imobiliarias add column if not exists email text;

drop policy if exists "imobiliarias leitura o2" on imobiliarias;
create policy "imobiliarias leitura o2"
on imobiliarias for select
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "contratos leitura o2" on contratos;
create policy "contratos leitura o2"
on contratos for select
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

drop policy if exists "auditorias leitura o2" on auditorias_contrato;
create policy "auditorias leitura o2"
on auditorias_contrato for select
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br');
