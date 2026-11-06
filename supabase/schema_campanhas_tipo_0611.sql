-- Tipo da campanha (06/11/2026, pedido do Matheus): o painel de campanhas separa Marketing e Campanhas comerciais.
-- Daqui para frente o tipo é escolhido ao criar (botões "Nova campanha comercial" / "Nova campanha de marketing").
-- Para as campanhas JÁ criadas, a regra do passado é só identificar pelo criador: as de marketing foram todas criadas pelo
-- login da Jessika; as comerciais, por Henrique, Vanessa, Livia e Dayane (e as do Matheus, que ficam como comerciais).
alter table public.campanhas add column if not exists tipo text not null default 'comercial' check (tipo in ('comercial', 'marketing'));
update public.campanhas set tipo = 'marketing' where criado_por_email = 'jessika@o2seguros.com.br';
