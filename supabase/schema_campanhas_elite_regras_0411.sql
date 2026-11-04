-- Regras exclusivas da Campanha Elite (04/11/2026, pedido do Matheus).
--
-- 1) Valor mínimo do título de Capitalização por participante, DENTRO da campanha
--    (campanhas_metas.cap_valor_minimo). Vazio = sem regra (todas as outras linhas
--    e campanhas continuam como estavam). Hoje só Expan e Adjuve têm: R$ 4.000,00.
--    O título abaixo do mínimo sai da apuração (cotações, contratações, base) e
--    também das oportunidades do participante.
-- 2) Silvério: meta total 18 contratações (6 por mês, Fiança e/ou Capitalização
--    somadas) de outubro a dezembro. Sem período individual: vale o da campanha
--    (01/10 a 31/12/2026). A meta mensal é a total ÷ meses do período (3).

alter table public.campanhas_metas add column if not exists cap_valor_minimo numeric;

-- Campanha Elite
update public.campanhas_metas
   set cap_valor_minimo = 4000
 where campanha_id = '5bdf0eb9-9fa1-4ef3-a4be-2f5db6854d32'
   and id in (
     '0b85a045-9507-4958-b8af-a6f9a485d5e6', -- Expan Imóveis
     'f869b3af-363c-4514-b0ed-ffb34ef51493', -- ADJUVE (grupo)
     '922e122c-284f-4188-9270-b01806789e74'  -- ADJUVE PETROPÓLIS (ficha; vale se o grupo voltar a modo filial)
   );

update public.campanhas_metas
   set meta = 18,
       periodo_inicio = null,
       periodo_fim = null,
       periodo_origem = 'pedido do Matheus 04/11: 6 por mês, out a dez, 18 no total'
 where campanha_id = '5bdf0eb9-9fa1-4ef3-a4be-2f5db6854d32'
   and id = '74ce901a-acf0-4e9b-a9e4-52f43068f53a'; -- Silverio Imoveis
