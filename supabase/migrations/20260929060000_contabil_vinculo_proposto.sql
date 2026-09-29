-- Vínculo conta gerencial × conta contábil: PROPOSTO (editável) → CONFIRMADO (imutável) · CEO 29/09 (FC Pisos).
--
-- 1) Cardinalidade: o de-para aprovado da FC (ctx 1a09fbef) liga 116 contas CONTÁBEIS a ~30 contas GERENCIAIS —
--    várias contábeis por gerencial. O índice antigo (uma contábil ativa por GERENCIAL) impedia isso. A unicidade passa
--    para o lado CONTÁBIL: cada conta contábil tem no máximo um vínculo ativo; uma gerencial pode ter várias contábeis.
--    Prova: 0 vínculos no banco hoje e nenhum consumidor no código além do relatório (que já agrupa N por gerencial).
-- 2) Estado: 'proposto' (editável, descartável) e 'confirmado' (IMUTÁVEL — regra da contabilidade 15/09, ctx bda75838).
--    Linhas antigas (não há nenhuma) nasceriam 'confirmado', que era a semântica anterior.
-- 3) Trava no banco: vínculo confirmado não muda de conta nem volta a proposto, e nenhum vínculo é apagado (RD-30:
--    descartar proposta = ativo=false). Inativar um vínculo (fn_conta_contabil_inativar_vinculo) continua permitido.
-- 4) Funções da tela: propor (uma ou várias contábeis → uma gerencial), confirmar em massa, descartar proposta, listar.
--    fn_conta_contabil_vincular passa a checar pela contábil e confirma a proposta igual. O relatório ganha o status.

ALTER TABLE public.erp_conta_contabil_vinculo
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmado',
  ADD COLUMN IF NOT EXISTS confirmado_em timestamptz,
  ADD COLUMN IF NOT EXISTS confirmado_por uuid,
  ADD COLUMN IF NOT EXISTS origem text,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_conta_contabil_vinculo_status_check') THEN
    ALTER TABLE public.erp_conta_contabil_vinculo
      ADD CONSTRAINT erp_conta_contabil_vinculo_status_check CHECK (status IN ('proposto', 'confirmado'));
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_vinculo_gerencial_ativo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vinculo_contabil_ativo
  ON public.erp_conta_contabil_vinculo (company_id, conta_contabil_id) WHERE ativo;

-- Trava: confirmado é imutável; nada se apaga.
CREATE OR REPLACE FUNCTION public.tg_conta_contabil_vinculo_guarda()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- só a limpeza dos testes na empresa de demonstração apaga; em empresa real nada se apaga
    IF EXISTS (SELECT 1 FROM companies WHERE id = OLD.company_id AND is_demo) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'vinculo_nao_se_apaga: descarte a proposta (ativo=false) — RD-30' USING errcode = '42501';
  END IF;
  IF OLD.status = 'confirmado' AND (
       NEW.plano_conta_id IS DISTINCT FROM OLD.plano_conta_id
    OR NEW.conta_contabil_id IS DISTINCT FROM OLD.conta_contabil_id
    OR NEW.status IS DISTINCT FROM 'confirmado'
    OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    RAISE EXCEPTION 'vinculo_imutavel: o vínculo contábil confirmado não pode ser alterado. Crie uma nova conta gerencial e inative a anterior.'
      USING errcode = '42501';
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_conta_contabil_vinculo_guarda ON public.erp_conta_contabil_vinculo;
CREATE TRIGGER trg_conta_contabil_vinculo_guarda
  BEFORE UPDATE OR DELETE ON public.erp_conta_contabil_vinculo
  FOR EACH ROW EXECUTE FUNCTION public.tg_conta_contabil_vinculo_guarda();

-- Propor: liga uma ou várias contábeis (analíticas, da empresa) a UMA gerencial. Sem vínculo → cria proposto;
-- proposto → troca a gerencial; confirmado → ignora (imutável) e conta em "ignoradas_confirmadas".
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vinculo_propor(
  p_company_id uuid, p_conta_contabil_ids uuid[], p_plano_conta_id uuid, p_origem text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_id uuid; v_anal boolean; v_vinc record;
        v_novos int := 0; v_trocados int := 0; v_iguais int := 0; v_conf int := 0; v_inval int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_plano_contas WHERE id = p_plano_conta_id AND company_id = p_company_id AND ativo
                   AND NOT COALESCE(is_totalizador, false)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'gerencial_invalida',
      'mensagem', 'Escolha uma conta gerencial ativa desta empresa que não seja totalizadora.'); END IF;
  FOREACH v_id IN ARRAY COALESCE(p_conta_contabil_ids, ARRAY[]::uuid[]) LOOP
    SELECT analitica INTO v_anal FROM erp_conta_contabil WHERE id = v_id AND company_id = p_company_id AND ativo;
    IF NOT FOUND OR NOT v_anal THEN v_inval := v_inval + 1; CONTINUE; END IF;
    SELECT id, status, plano_conta_id INTO v_vinc FROM erp_conta_contabil_vinculo
     WHERE company_id = p_company_id AND conta_contabil_id = v_id AND ativo;
    IF NOT FOUND THEN
      INSERT INTO erp_conta_contabil_vinculo (company_id, plano_conta_id, conta_contabil_id, status, origem, created_by)
      VALUES (p_company_id, p_plano_conta_id, v_id, 'proposto', NULLIF(trim(p_origem), ''), auth.uid());
      v_novos := v_novos + 1;
    ELSIF v_vinc.status = 'confirmado' THEN
      v_conf := v_conf + 1;
    ELSIF v_vinc.plano_conta_id = p_plano_conta_id THEN
      v_iguais := v_iguais + 1;
    ELSE
      UPDATE erp_conta_contabil_vinculo SET plano_conta_id = p_plano_conta_id WHERE id = v_vinc.id;
      v_trocados := v_trocados + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'propostos', v_novos, 'trocados', v_trocados, 'inalterados', v_iguais,
    'ignoradas_confirmadas', v_conf, 'invalidas', v_inval);
END $fn$;

-- Confirmar em massa: só propostos ativos da empresa viram confirmados (imutáveis a partir daqui).
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vinculo_confirmar(p_company_id uuid, p_vinculo_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_conta_contabil_vinculo SET status = 'confirmado', confirmado_em = now(), confirmado_por = auth.uid()
   WHERE company_id = p_company_id AND id = ANY(COALESCE(p_vinculo_ids, ARRAY[]::uuid[])) AND ativo AND status = 'proposto';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'confirmados', v_n);
END $fn$;

-- Descartar proposta: ativo=false (nunca apaga — RD-30). Confirmado não se descarta.
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vinculo_descartar(p_company_id uuid, p_vinculo_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_conta_contabil_vinculo SET ativo = false
   WHERE company_id = p_company_id AND id = ANY(COALESCE(p_vinculo_ids, ARRAY[]::uuid[])) AND ativo AND status = 'proposto';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'descartados', v_n);
END $fn$;

-- Lista da tela: cada conta contábil analítica ativa com o vínculo ativo (se houver) e a gerencial.
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vinculo_tela(p_company_id uuid)
RETURNS TABLE(conta_contabil_id uuid, cont_codigo text, cont_descricao text, cont_codigo_antigo text,
              vinculo_id uuid, status text, plano_conta_id uuid, ger_codigo text, ger_descricao text,
              confirmado_em timestamptz, origem text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'acesso_negado'; END IF;
  RETURN QUERY
  SELECT c.id, c.codigo, c.descricao, c.codigo_antigo, v.id, v.status, v.plano_conta_id, g.codigo, g.descricao,
         v.confirmado_em, v.origem
  FROM erp_conta_contabil c
  LEFT JOIN erp_conta_contabil_vinculo v ON v.conta_contabil_id = c.id AND v.company_id = p_company_id AND v.ativo
  LEFT JOIN erp_plano_contas g ON g.id = v.plano_conta_id
  WHERE c.company_id = p_company_id AND c.ativo AND c.analitica
  ORDER BY c.codigo;
END $fn$;

-- Vincular direto (botão do relatório): agora checa pela CONTÁBIL. Proposta para a mesma gerencial → confirma;
-- vínculo ativo para outra gerencial → não altera (confirmado é imutável; proposto se troca na tela de vínculos).
CREATE OR REPLACE FUNCTION public.fn_conta_contabil_vincular(p_company_id uuid, p_plano_conta_id uuid, p_conta_contabil_id uuid, p_observacao text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_anal boolean; v_vinc record;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_plano_contas WHERE id = p_plano_conta_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'gerencial_nao_encontrada'); END IF;
  SELECT analitica INTO v_anal FROM erp_conta_contabil WHERE id = p_conta_contabil_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'contabil_nao_encontrada'); END IF;
  IF NOT v_anal THEN RETURN jsonb_build_object('ok', false, 'erro', 'contabil_sintetica_nao_vinculavel'); END IF;

  SELECT id, status, plano_conta_id INTO v_vinc FROM erp_conta_contabil_vinculo
   WHERE company_id = p_company_id AND conta_contabil_id = p_conta_contabil_id AND ativo;
  IF FOUND THEN
    IF v_vinc.plano_conta_id = p_plano_conta_id THEN
      IF v_vinc.status = 'proposto' THEN
        UPDATE erp_conta_contabil_vinculo SET status = 'confirmado', confirmado_em = now(), confirmado_por = auth.uid()
         WHERE id = v_vinc.id;
        RETURN jsonb_build_object('ok', true, 'confirmado', true);
      END IF;
      RETURN jsonb_build_object('ok', true, 'inalterado', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'erro', 'vinculo_imutavel',
      'mensagem', 'Esta conta contábil já tem vínculo. Confirmado não se altera: crie uma nova conta gerencial e inative a anterior.');
  END IF;

  INSERT INTO erp_conta_contabil_vinculo (company_id, plano_conta_id, conta_contabil_id, observacao, status,
                                          confirmado_em, confirmado_por, created_by)
  VALUES (p_company_id, p_plano_conta_id, p_conta_contabil_id, NULLIF(trim(p_observacao), ''), 'confirmado',
          now(), auth.uid(), auth.uid());
  RETURN jsonb_build_object('ok', true);
END $fn$;

-- Relatório: mesma consulta + status do vínculo (o PDF diferencia proposto de confirmado).
DROP FUNCTION IF EXISTS public.fn_plano_contas_relatorio(uuid);
CREATE FUNCTION public.fn_plano_contas_relatorio(p_company_id uuid)
RETURNS TABLE(origem text, ger_codigo text, ger_descricao text, ger_grupo text, ger_tipo text, ger_nivel integer,
              ger_is_totalizador boolean, cont_codigo text, cont_descricao text, cont_nivel integer, cont_analitica boolean,
              cont_codigo_antigo text, vinculo_observacao text, vinculo_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
#variable_conflict use_column
DECLARE
  v_exclusivo boolean := false;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  SELECT COALESCE(c.plano_contas_proprio, false) INTO v_exclusivo
    FROM public.companies c WHERE c.id = p_company_id;
  IF v_exclusivo AND NOT EXISTS (
    SELECT 1 FROM public.erp_plano_contas pc
     WHERE pc.company_id = p_company_id AND pc.ativo = true) THEN
    v_exclusivo := false;
  END IF;

  RETURN QUERY
  WITH ger AS (
    SELECT DISTINCT ON (pc.codigo)
      pc.id, pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.is_totalizador
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND ( pc.company_id = p_company_id
         OR (pc.company_id IS NULL AND NOT v_exclusivo) )
    ORDER BY pc.codigo, (CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END)
  ),
  lado_gerencial AS (
    SELECT 'gerencial'::text AS origem,
           ger.codigo, ger.descricao, ger.grupo, ger.tipo, ger.nivel, ger.is_totalizador,
           cc.codigo, cc.descricao, cc.nivel, cc.analitica, cc.codigo_antigo,
           v.observacao, v.status
    FROM ger
    LEFT JOIN public.erp_conta_contabil_vinculo v
           ON v.plano_conta_id = ger.id
          AND v.company_id = p_company_id
          AND v.ativo = true
    LEFT JOIN public.erp_conta_contabil cc
           ON cc.id = v.conta_contabil_id
          AND cc.ativo = true
  ),
  lado_contabil_orfao AS (
    SELECT 'contabil_sem_vinculo'::text,
           NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::boolean,
           cc.codigo, cc.descricao, cc.nivel, cc.analitica, cc.codigo_antigo,
           NULL::text, NULL::text
    FROM public.erp_conta_contabil cc
    WHERE cc.company_id = p_company_id
      AND cc.ativo = true
      AND cc.analitica = true
      AND NOT EXISTS (
        SELECT 1 FROM public.erp_conta_contabil_vinculo v
         WHERE v.conta_contabil_id = cc.id AND v.ativo = true)
  )
  SELECT * FROM lado_gerencial
  UNION ALL
  SELECT * FROM lado_contabil_orfao
  ORDER BY 1, 2 NULLS LAST, 8 NULLS LAST;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_conta_contabil_vinculo_propor(uuid, uuid[], uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculo_propor(uuid, uuid[], uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_conta_contabil_vinculo_confirmar(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculo_confirmar(uuid, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_conta_contabil_vinculo_descartar(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculo_descartar(uuid, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_conta_contabil_vinculo_tela(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculo_tela(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_conta_contabil_vincular(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vincular(uuid, uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_plano_contas_relatorio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_relatorio(uuid) TO authenticated, service_role;
