-- Allowlist por FEATURE no porteiro P0 de custo de IA (CEO 17/11, RD-101): liberar SÓ o Consultor.
--
-- O Consultor IA (#5331) está no ar mas desligado: o porteiro global anthropic_budget_control (id=1) está
-- pausado=true com limites em US$0, e assertIAPermitida bloqueia toda IA paga. Religar o freeze global
-- reativaria TODA a IA paga — o CEO não quer isso. Esta migration deixa o freeze global intacto e só adiciona
-- uma allowlist: a feature 'consultor_ia' passa, protegida pelo SEU PRÓPRIO teto (fn_ia_global_pode_gastar,
-- US$2/dia, checado na rota antes do callAI). Aditiva e reversível; não toca pausado nem os limites globais.

ALTER TABLE public.anthropic_budget_control
  ADD COLUMN IF NOT EXISTS features_liberadas text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.anthropic_budget_control.features_liberadas IS
  'Features de IA que passam o freeze global (pausado/limite); cada uma protegida pelo próprio teto (ex.: consultor_ia = fn_ia_global_pode_gastar US$2/dia). CEO 17/11 (RD-101). Plano de volta: SET features_liberadas = ''{}'' recongela.';

-- Libera SÓ o Consultor. NÃO mexe em pausado nem nos limites globais (resto da IA segue congelado).
UPDATE public.anthropic_budget_control
   SET features_liberadas = ARRAY['consultor_ia'], atualizado_em = now()
 WHERE id = 1;

-- Reversível: UPDATE public.anthropic_budget_control SET features_liberadas = '{}'::text[] WHERE id = 1;
-- (recongela o Consultor também; a coluna aditiva pode ficar — default '{}' é inócuo).
