-- Score de relacionamento com o cliente (P&M · tarefa eng_chefe 37420d3e) — PR (1): PESOS por empresa.
-- Fórmula aprovada pelo CEO com pesos EDITÁVEIS por empresa (padrão: prazo 30 + margem 30 +
-- pagamento 20 + atividade 20 = 100). Esta PR entrega só a CAMADA DE DADOS: a tabela de config
-- (uma linha por empresa, soma travada em 100 no banco) e as RPCs de leitura/escrita guardadas.
-- O cálculo do score (PR 2) e a tela de ajuste/ranking (PR 3) vêm em seguida.
-- ADITIVA: tabela/policy/funções NOVAS, RLS por company_id, REVOKE anon. Nada existente é alterado.

CREATE TABLE IF NOT EXISTS public.agency_score_pesos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  peso_prazo     int  NOT NULL DEFAULT 30,
  peso_margem    int  NOT NULL DEFAULT 30,
  peso_pagamento int  NOT NULL DEFAULT 20,
  peso_atividade int  NOT NULL DEFAULT 20,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  CONSTRAINT agency_score_pesos_company_uk UNIQUE (company_id),
  CONSTRAINT agency_score_pesos_nao_neg CHECK (peso_prazo >= 0 AND peso_margem >= 0 AND peso_pagamento >= 0 AND peso_atividade >= 0),
  CONSTRAINT agency_score_pesos_soma CHECK (peso_prazo + peso_margem + peso_pagamento + peso_atividade = 100)
);

ALTER TABLE public.agency_score_pesos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_score_pesos_access ON public.agency_score_pesos;
CREATE POLICY agency_score_pesos_access ON public.agency_score_pesos FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON TABLE public.agency_score_pesos FROM anon;
GRANT SELECT ON TABLE public.agency_score_pesos TO authenticated;

-- Leitura: config vigente ou o PADRÃO (30/30/20/20), com a flag `padrao`.
CREATE OR REPLACE FUNCTION public.fn_agency_score_pesos_get(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_r public.agency_score_pesos%ROWTYPE;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v_r FROM agency_score_pesos WHERE company_id = p_company_id;
  IF v_r.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'padrao', true,
      'peso_prazo', 30, 'peso_margem', 30, 'peso_pagamento', 20, 'peso_atividade', 20);
  END IF;
  RETURN jsonb_build_object('ok', true, 'padrao', false,
    'peso_prazo', v_r.peso_prazo, 'peso_margem', v_r.peso_margem,
    'peso_pagamento', v_r.peso_pagamento, 'peso_atividade', v_r.peso_atividade,
    'atualizado_em', v_r.atualizado_em);
END $function$;

-- Escrita: valida soma = 100 e não-negativos; upsert por empresa; rastro em audit_log_global.
CREATE OR REPLACE FUNCTION public.fn_agency_score_pesos_salvar(
  p_company_id uuid, p_prazo int, p_margem int, p_pagamento int, p_atividade int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_antes jsonb; v_soma int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_prazo IS NULL OR p_margem IS NULL OR p_pagamento IS NULL OR p_atividade IS NULL
     OR LEAST(p_prazo, p_margem, p_pagamento, p_atividade) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'peso_invalido'); END IF;
  v_soma := p_prazo + p_margem + p_pagamento + p_atividade;
  IF v_soma <> 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'soma_diferente_100', 'soma', v_soma); END IF;

  SELECT jsonb_build_object('peso_prazo', peso_prazo, 'peso_margem', peso_margem,
           'peso_pagamento', peso_pagamento, 'peso_atividade', peso_atividade)
    INTO v_antes FROM agency_score_pesos WHERE company_id = p_company_id;

  INSERT INTO agency_score_pesos (company_id, peso_prazo, peso_margem, peso_pagamento, peso_atividade, atualizado_em, atualizado_por)
  VALUES (p_company_id, p_prazo, p_margem, p_pagamento, p_atividade, now(), v_uid)
  ON CONFLICT (company_id) DO UPDATE
    SET peso_prazo = EXCLUDED.peso_prazo, peso_margem = EXCLUDED.peso_margem,
        peso_pagamento = EXCLUDED.peso_pagamento, peso_atividade = EXCLUDED.peso_atividade,
        atualizado_em = now(), atualizado_por = v_uid;

  IF v_uid IS NOT NULL THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
            'agency_score_pesos', p_company_id::text, 'score_pesos_salvar', v_antes,
            jsonb_build_object('peso_prazo', p_prazo, 'peso_margem', p_margem,
                               'peso_pagamento', p_pagamento, 'peso_atividade', p_atividade));
  END IF;

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_agency_score_pesos_get(uuid)                        FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_agency_score_pesos_salvar(uuid, int, int, int, int) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_agency_score_pesos_get(uuid)                        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_agency_score_pesos_salvar(uuid, int, int, int, int) TO authenticated, service_role;
