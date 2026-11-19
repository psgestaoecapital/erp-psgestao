-- Plano de Ação 5W2H — FK setor_id robusta ao reset (CEO 14/10, pós-incidente main vermelha #2561).
-- O fn_demo_reset apaga prod_setor da DEMO; com a FK em NO ACTION, uma ação que referenciava o setor TRAVAVA o reset
-- (409) e derrubava as specs LTCAT da mesma DEMO. ON DELETE SET NULL: apagar um setor zera o vínculo da ação (ela mantém
-- o "onde" em texto) em vez de travar. Migração ADITIVA (só troca o comportamento da FK da própria tabela nova).
ALTER TABLE public.erp_plano_acao DROP CONSTRAINT IF EXISTS erp_plano_acao_setor_id_fkey;
ALTER TABLE public.erp_plano_acao
  ADD CONSTRAINT erp_plano_acao_setor_id_fkey
  FOREIGN KEY (setor_id) REFERENCES public.prod_setor(id) ON DELETE SET NULL;
