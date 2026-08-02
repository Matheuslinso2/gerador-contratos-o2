-- Permite que colaboradores O2 criem um registro "casca" em imobiliarias
-- (nome + CNPJ, sem login/user_id) quando o módulo de Faturas identifica
-- uma imobiliária pela base de conhecidas mas ela ainda não tem conta no
-- Gerador de Contratos. Restrito a user_id nulo — não deixa criar/assumir
-- registro em nome de uma conta já existente.

drop policy if exists "imobiliarias insert o2 sem dono" on imobiliarias;
create policy "imobiliarias insert o2 sem dono"
on imobiliarias for insert
to authenticated
with check (
  auth.jwt() ->> 'email' like '%@o2seguros.com.br'
  and user_id is null
);
