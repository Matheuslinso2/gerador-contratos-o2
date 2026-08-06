-- 1) Apaga os 2 pendentes duplicados de RDJ (já existe de verdade, com
--    Pottencial e Tokio corretos).
delete from faturas_esperadas
where nome_provisorio = 'RDJ' and imobiliaria_id is null;

-- 2) "Flavio Braga Monteiro" ainda não tinha virado registro de verdade --
--    resolve agora com o CNPJ já conhecido do CRM (GRATACOS IMOVEIS/FLAVIO
--    B. MONTEIRO), em vez de deixar pendente esperando alguém digitar.
insert into imobiliarias (nome, cnpj, texto_base_contrato, indice_reajuste,
  percentual_multa_atraso, percentual_juros_mora, percentual_honorarios_advocaticios,
  dia_vencimento_aluguel, cadastro_incompleto)
select 'GRATACOS IMOVEIS/FLAVIO B. MONTEIRO', '54888498000108', '', '', 0, 0, 0, 1, true
where not exists (select 1 from imobiliarias where cnpj = '54888498000108');

update faturas_esperadas fe
set imobiliaria_id = i.id, nome_provisorio = null
from imobiliarias i
where i.cnpj = '54888498000108'
  and fe.nome_provisorio = 'FLAVIO BRAGA MONTEIRO';

-- 3) Conferência final -- Tokio deve estar em 115 agora.
select count(*) from faturas_esperadas where seguradora = 'TOKIO' and ativo = true;
