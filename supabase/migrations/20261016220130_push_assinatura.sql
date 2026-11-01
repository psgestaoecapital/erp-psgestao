-- Chamado #120 (Tryo) — Web Push no celular, custo zero (REGRAS APROVADAS, CEO 13/10, ref 8cf0318d).
-- Passo 1 (independe da chave VAPID): onde guardar a assinatura de push de cada aparelho e a escolha do usuário.
-- O push é só mais um CANAL do aviso que já existe (erp_notificacao_usuario); nenhum evento novo.
--  - erp_push_assinatura: uma linha por aparelho (endpoint do serviço gratuito da Apple/Google);
--  - erp_push_preferencia: o usuário liga/desliga por TIPO de aviso (só envia a quem ATIVOU);
--  - o cliente só enxerga e mexe nas PRÓPRIAS linhas; o envio (service_role) é o único que lê todas.
-- RLS/grants novos = via revisada (label revisao-eng-chefe).

CREATE TABLE IF NOT EXISTS public.erp_push_assinatura (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  ultimo_envio_em timestamptz,
  CONSTRAINT erp_push_assinatura_endpoint_uk UNIQUE (endpoint)
);
CREATE INDEX IF NOT EXISTS erp_push_assinatura_user_idx ON public.erp_push_assinatura (user_id) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.erp_push_preferencia (
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tipo        text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tipo)
);

ALTER TABLE public.erp_push_assinatura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_push_preferencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_push_assinatura_proprio ON public.erp_push_assinatura;
CREATE POLICY erp_push_assinatura_proprio ON public.erp_push_assinatura
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = erp_push_assinatura.company_id));

DROP POLICY IF EXISTS erp_push_preferencia_proprio ON public.erp_push_preferencia;
CREATE POLICY erp_push_preferencia_proprio ON public.erp_push_preferencia
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.erp_push_assinatura FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.erp_push_preferencia FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.erp_push_assinatura TO authenticated;
GRANT UPDATE (ativo, user_agent) ON public.erp_push_assinatura TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_push_preferencia TO authenticated;
