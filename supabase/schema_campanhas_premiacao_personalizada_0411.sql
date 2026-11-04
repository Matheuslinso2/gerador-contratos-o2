-- Premiação personalizada por cliente na Campanha Elite (04/11/2026, pedido do Matheus).
--
-- O e-mail da parcial tem UM modelo de texto compartilhado. Só o BLOCO DE PREMIAÇÃO pode
-- ter exceção por participante: ele fica na linha de meta do participante dentro da
-- campanha (campanhas_metas), nunca como cópia do e-mail inteiro. Vazio = premiação
-- padrão do modelo. Quem grava: ações "Salvar premiação personalizada" e "Restaurar
-- premiação padrão" da tela Enviar parciais; as quatro iniciais (Adjuve, Chez, Expan,
-- Silvério) são semeadas por scripts/campanhas/semear-premiacoes-elite.ts.
--
-- Conteúdo: linhas HTML do editor (<tr><td ...>...</td></tr>), sem o título; o título
-- "Confira a premiação da sua campanha:" é colocado pelo código na montagem do e-mail.

alter table public.campanhas_metas add column if not exists premiacao_personalizada_html text;
