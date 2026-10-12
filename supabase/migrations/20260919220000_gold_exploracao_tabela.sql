-- Revenda R1b (parte 1) · tabela gold_exploracao (contexto 23752d5a)
-- O modo EXPLORADOR do robô (auditor Gold) grava aqui um registro por ESTADO de tela: a rota, a
-- empresa fotografada, o rótulo do estado (inicial / aba X / modal Y / filtro Z), o inventário do DOM
-- (botões, links, abas, inputs, cards/KPIs, tabelas, mensagens de vazio/erro) e a foto do estado.
-- Escrita: só o explorador server-side (service_role, que ignora RLS). Leitura: só equipe PS
-- (system_role PS_ADMIN/PS_ADMIN_CVM). SEM anon. Custo baixo (RD-42): jsonb enxuto, sem dado pessoal
-- além do que a tela já mostra em [BOT]/PS LTDA (trava LGPD é do explorador). RDs 25·38·41·65.

CREATE TABLE IF NOT EXISTS public.gold_exploracao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  rota         text NOT NULL,
  estado       text NOT NULL DEFAULT 'inicial',   -- 'inicial' | 'aba:<x>' | 'modal:<y>' | 'filtro:<z>' ...
  elementos    jsonb NOT NULL DEFAULT '{}'::jsonb, -- inventário do DOM daquele estado
  screenshot_url text,
  run_id       uuid,                               -- agrupa os estados de uma execução (lote)
  executado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gold_exploracao_rota      ON public.gold_exploracao (company_id, rota, executado_em DESC);
CREATE INDEX IF NOT EXISTS idx_gold_exploracao_run       ON public.gold_exploracao (run_id);

ALTER TABLE public.gold_exploracao ENABLE ROW LEVEL SECURITY;

-- Leitura só para equipe PS (dado interno de auditoria). Escrita é via service_role (ignora RLS).
DROP POLICY IF EXISTS gold_exploracao_select_ps ON public.gold_exploracao;
CREATE POLICY gold_exploracao_select_ps ON public.gold_exploracao
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')));

-- anon nunca lê/escreve; authenticated só lê via policy acima (sem INSERT/UPDATE/DELETE policy → negado).
REVOKE ALL ON public.gold_exploracao FROM anon;
GRANT SELECT ON public.gold_exploracao TO authenticated;
GRANT ALL ON public.gold_exploracao TO service_role;
