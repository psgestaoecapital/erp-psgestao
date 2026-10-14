-- Portão vermelho (14/10): o fn_demo_reset apaga prod_setor do DEMO e a FK erp_plano_acao.setor_id (#2561) não tinha ON DELETE,
-- então o reset falhava (409 23503) e derrubava os specs LTCAT do @pos-migration. Setor é só o "ONDE" opcional da ação:
-- ao apagar o setor, a ação fica sem setor (SET NULL) em vez de bloquear. Nenhum dado é apagado.
ALTER TABLE public.erp_plano_acao DROP CONSTRAINT IF EXISTS erp_plano_acao_setor_id_fkey;
ALTER TABLE public.erp_plano_acao
  ADD CONSTRAINT erp_plano_acao_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.prod_setor(id) ON DELETE SET NULL;
