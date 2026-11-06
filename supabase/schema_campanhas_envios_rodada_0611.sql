-- Reenvio dentro da MESMA campanha (06/11/2026, correção do Matheus): reenviar não cria campanha nova no painel,
-- é uma nova rodada de envio da campanha. Cada linha de campanhas_envios passa a ter a rodada (1 = disparo original).
--
-- O reenvio de 05/11 (cópia "CAP FRIDAY (reenvio)", 42 e-mails, todos já presentes na original) é movido para a
-- campanha original como rodada 2, e a cópia vazia some do painel. A coluna reenvio_de (criada em 05/11 só para a cópia) sai.
alter table public.campanhas_envios add column if not exists rodada integer not null default 1;

alter table public.campanhas_envios drop constraint if exists campanhas_envios_campanha_id_email_key;
alter table public.campanhas_envios add constraint campanhas_envios_campanha_id_email_rodada_key unique (campanha_id, email, rodada);

-- Move o reenvio de 05/11 para a campanha original (só se a cópia ainda existir e não tiver nada além dos envios).
do $$
declare
  v_copia constant uuid := 'fd8e98a2-2b08-4707-a38e-411d15b7685c';
  v_original constant uuid := 'ed49ed00-f262-4e9d-97b4-71180ebb8f4d';
begin
  if exists (select 1 from public.campanhas where id = v_copia and reenvio_de = v_original)
     and not exists (select 1 from public.campanhas_producao where campanha_id = v_copia)
     and not exists (select 1 from public.campanhas_metas where campanha_id = v_copia)
     and not exists (select 1 from public.campanhas_cards_bitrix where campanha_id = v_copia)
     and not exists (select 1 from public.campanhas where campanha_pai_id = v_copia) then
    update public.campanhas_envios set campanha_id = v_original, rodada = 2 where campanha_id = v_copia;
    update public.campanhas_descadastros set origem_campanha_id = v_original where origem_campanha_id = v_copia;
    update public.campanhas c set
      total_destinatarios = (select count(*) from public.campanhas_envios e where e.campanha_id = v_original),
      total_enviados = (select count(*) from public.campanhas_envios e where e.campanha_id = v_original and e.status = 'enviado'),
      total_falhas = (select count(*) from public.campanhas_envios e where e.campanha_id = v_original and e.status = 'falhou')
    where c.id = v_original;
    delete from public.campanhas where id = v_copia;
  end if;
end $$;

alter table public.campanhas drop column if exists reenvio_de;
