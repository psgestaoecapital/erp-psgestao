-- feat(consultor-ia · PR B): tabela de feedback 👍/👎 + "o que faltou" do agente Consultor IA.
--
-- SPEC Eng. Chefe (PR B, item 4): "👍/👎 + 'o que faltou' → tabela consultor_ia_feedback
-- (RLS por empresa; leitura dono/gestor/PS)". Espelha a RLS do consultor_ia_pergunta_log:
-- lê quem é admin (PS), o próprio autor, ou dono/gestor da empresa (CLIENT_OWNER/CLIENT_MANAGER).
-- Escrita só pela RPC guardada (SECURITY DEFINER + fn__guarda_empresa) — sem INSERT direto do cliente.
-- Aditiva/idempotente (RD-52): CREATE TABLE/FUNCTION IF NOT EXISTS + policy recriada.

CREATE TABLE IF NOT EXISTS public.consultor_ia_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  user_id        uuid DEFAULT auth.uid(),
  sessao_id      text,
  pergunta       text,
  resposta_resumo text,
  util           boolean NOT NULL,
  o_que_faltou   text,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_consultor_ia_feedback_empresa_data
  ON public.consultor_ia_feedback (company_id, criado_em DESC);

ALTER TABLE public.consultor_ia_feedback ENABLE ROW LEVEL SECURITY;

-- Leitura: PS (admin), o próprio autor, ou dono/gestor da empresa — mesma régua do pergunta_log.
DROP POLICY IF EXISTS consultor_ia_feedback_sel ON public.consultor_ia_feedback;
CREATE POLICY consultor_ia_feedback_sel ON public.consultor_ia_feedback
  FOR SELECT USING (
    public.is_admin()
    OR (user_id = auth.uid())
    OR (
      company_id IN (SELECT public.get_user_company_ids())
      AND COALESCE(public.fn_acesso_efetivo(auth.uid(), company_id) ->> 'papel_gestao', '')
          = ANY (ARRAY['CLIENT_OWNER', 'CLIENT_MANAGER'])
    )
  );

-- Sem policy de INSERT/UPDATE/DELETE: a escrita é só pela RPC guardada abaixo (SECURITY DEFINER,
-- dona postgres, ignora RLS). Fecha o acesso direto do anon/authenticated à escrita.
REVOKE ALL ON public.consultor_ia_feedback FROM anon;
GRANT SELECT ON public.consultor_ia_feedback TO authenticated;

-- Writer guardado: confere o acesso do chamador à empresa e grava com user_id = auth.uid().
CREATE OR REPLACE FUNCTION public.fn_consultor_feedback_registrar(
  p_company_id uuid,
  p_sessao_id text,
  p_pergunta text,
  p_resposta_resumo text,
  p_util boolean,
  p_o_que_faltou text DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);  -- 42501 para quem não tem acesso à empresa; libera service_role/admin
  INSERT INTO public.consultor_ia_feedback (company_id, user_id, sessao_id, pergunta, resposta_resumo, util, o_que_faltou)
  VALUES (
    p_company_id, auth.uid(), left(p_sessao_id, 80), left(p_pergunta, 500),
    left(p_resposta_resumo, 1000), COALESCE(p_util, false), left(p_o_que_faltou, 1000)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.fn_consultor_feedback_registrar(uuid, text, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_feedback_registrar(uuid, text, text, text, boolean, text) TO authenticated, service_role;
