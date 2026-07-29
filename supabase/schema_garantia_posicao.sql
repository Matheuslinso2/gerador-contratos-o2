-- Guarda em qual posição (quantas cláusulas vêm antes) a cláusula de
-- garantia estava no texto-base original da imobiliária, antes de ser
-- removida. Cada imobiliária estrutura o próprio contrato do seu jeito —
-- a garantia deve voltar exatamente na mesma posição relativa quando o
-- sistema gera um contrato específico, não só ser colada no final.

alter table imobiliarias add column if not exists garantia_posicao_apos_clausula integer;
