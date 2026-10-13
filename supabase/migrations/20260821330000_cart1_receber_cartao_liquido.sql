-- CART-1 · Bandeira + líquido do cartão na conta a receber.
-- Ao registrar uma receita com Cartão, o form calcula (via fn_cartao_calcular — RD-26, motor
-- existente) e grava os dados do cartão + o líquido projetado no recebível. A PARCELA continua
-- com o valor BRUTO (é o que o cliente deve); o líquido é o que de fato entra no repasse.
--
-- erp_receber já tem adquirente_id. Adiciona o resto (todas nullable, aditivo, RD-53).
ALTER TABLE public.erp_receber
  ADD COLUMN IF NOT EXISTS bandeira          text,
  ADD COLUMN IF NOT EXISTS modalidade_cartao text,
  ADD COLUMN IF NOT EXISTS cartao_parcelas   integer,
  ADD COLUMN IF NOT EXISTS taxa_percentual   numeric(6,3),
  ADD COLUMN IF NOT EXISTS valor_taxa        numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_liquido     numeric(14,2),
  ADD COLUMN IF NOT EXISTS data_repasse      date;
