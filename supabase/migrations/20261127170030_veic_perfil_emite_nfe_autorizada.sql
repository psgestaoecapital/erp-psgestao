-- #9787 · Libera a EMISSÃO AUTORIZADA (transmissão à SEFAZ) das operações de ENTRADA do veículo, POR OPERAÇÃO.
-- Hoje a entrada só gera prévia/espelho ("SEM VALOR FISCAL"); o motor transmite só a VENDA. Esta coluna é o gate
-- seguro: default FALSE = comportamento atual (só prévia). A CONTADORA liga por operação DEPOIS de validar em
-- homologação supervisionada (decisão reservada ao Eng. Chefe + contadora: quais operações e a partir de quando).
-- NÃO confundir com `emite_nota_entrada` (que marca que a operação conceitualmente tem nota de entrada e já vem true
-- em vários perfis) — este flag é o "liberado para transmitir de verdade". Aditiva/idempotente (RD-52).

ALTER TABLE public.veic_perfil_fiscal_operacao
  ADD COLUMN IF NOT EXISTS emite_nfe_autorizada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.veic_perfil_fiscal_operacao.emite_nfe_autorizada IS
  '#9787 · libera a emissão AUTORIZADA (transmite à SEFAZ) desta operação de entrada. Default false = só prévia/espelho. A contadora liga por operação após validar em homologação supervisionada.';
