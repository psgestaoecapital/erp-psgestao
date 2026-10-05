-- NR-36 (#587 · Eng. Chefe 05/10): padrão "núcleo + porta" para reapurar período sem forjar identidade.
--  * fn_nr36_classificar_eventos_nucleo / fn_nr36_apurar_nucleo: o cálculo SEM fn_nr36_assert, só service_role.
--  * fn_nr36_classificar_eventos / fn_nr36_apurar (a porta da tela) = fn_nr36_assert + chamada ao núcleo (resultado idêntico).
--  * fn_nr36_reapurar_servico: só service_role; backup carimbado de nr36_pausa_apurada, reapura pelo núcleo, devolve antes→depois.
-- O núcleo é derivado da definição VIVA no banco (pg_get_functiondef), por âncora; falha se a âncora não bater.
-- Nenhuma linha de cliente muda nesta migration.

DO $mig$
DECLARE
  v_def text; v_nuc text;
BEGIN
  -- ── classificar_eventos ────────────────────────────────────────────────────────────────────────────────────────
  IF to_regprocedure('public.fn_nr36_classificar_eventos_nucleo(uuid)') IS NULL THEN
    v_def := pg_get_functiondef('public.fn_nr36_classificar_eventos(uuid)'::regprocedure);
    IF position('PERFORM public.fn_nr36_assert(p_company_id);' IN v_def) = 0
       OR position('FUNCTION public.fn_nr36_classificar_eventos(' IN v_def) = 0 THEN
      RAISE EXCEPTION 'âncora de fn_nr36_classificar_eventos não bateu com a definição viva';
    END IF;
    v_nuc := replace(v_def, 'FUNCTION public.fn_nr36_classificar_eventos(', 'FUNCTION public.fn_nr36_classificar_eventos_nucleo(');
    v_nuc := replace(v_nuc, E'  PERFORM public.fn_nr36_assert(p_company_id);\n', '');
    IF position('fn_nr36_assert' IN v_nuc) > 0 THEN RAISE EXCEPTION 'núcleo de classificar ainda tem assert'; END IF;
    EXECUTE v_nuc;
  END IF;

  -- ── apurar ─────────────────────────────────────────────────────────────────────────────────────────────────────
  IF to_regprocedure('public.fn_nr36_apurar_nucleo(uuid,date,date,text)') IS NULL THEN
    v_def := pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date,text)'::regprocedure);
    IF position('PERFORM public.fn_nr36_assert(p_company_id);' IN v_def) = 0
       OR position('PERFORM public.fn_nr36_classificar_eventos(p_company_id);' IN v_def) = 0
       OR position('FUNCTION public.fn_nr36_apurar(' IN v_def) = 0 THEN
      RAISE EXCEPTION 'âncora de fn_nr36_apurar não bateu com a definição viva';
    END IF;
    v_nuc := replace(v_def, 'FUNCTION public.fn_nr36_apurar(', 'FUNCTION public.fn_nr36_apurar_nucleo(');
    v_nuc := replace(v_nuc, E'  PERFORM public.fn_nr36_assert(p_company_id);\n', '');
    v_nuc := replace(v_nuc, 'PERFORM public.fn_nr36_classificar_eventos(p_company_id);', 'PERFORM public.fn_nr36_classificar_eventos_nucleo(p_company_id);');
    IF position('fn_nr36_assert' IN v_nuc) > 0 THEN RAISE EXCEPTION 'núcleo de apurar ainda tem assert'; END IF;
    EXECUTE v_nuc;

    -- a porta: assert + núcleo (a porta de classificar só é trocada aqui, depois de o núcleo existir)
    EXECUTE $p$
      CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_cpf text DEFAULT NULL::text)
       RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $f$
      BEGIN
        PERFORM public.fn_nr36_assert(p_company_id);
        RETURN public.fn_nr36_apurar_nucleo(p_company_id, p_dt_ini, p_dt_fim, p_cpf);
      END $f$ $p$;
    EXECUTE $p$
      CREATE OR REPLACE FUNCTION public.fn_nr36_classificar_eventos(p_company_id uuid)
       RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $f$
      BEGIN
        PERFORM public.fn_nr36_assert(p_company_id);
        RETURN public.fn_nr36_classificar_eventos_nucleo(p_company_id);
      END $f$ $p$;
  END IF;
END $mig$;

REVOKE ALL ON FUNCTION public.fn_nr36_classificar_eventos_nucleo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_classificar_eventos_nucleo(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_nr36_apurar_nucleo(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar_nucleo(uuid, date, date, text) TO service_role;

-- ── backup carimbado (RD-55) ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nr36_pausa_apurada_backup (
  backup_id   uuid        NOT NULL,
  backup_em   timestamptz NOT NULL DEFAULT now(),
  motivo      text,
  linha       jsonb       NOT NULL,              -- a linha inteira de nr36_pausa_apurada antes da reapuração
  company_id  uuid        NOT NULL,
  cpf         text        NOT NULL,
  data        date        NOT NULL,
  tipo        text        NOT NULL,
  status_antes text
);
CREATE INDEX IF NOT EXISTS nr36_pausa_apurada_backup_idx ON public.nr36_pausa_apurada_backup (backup_id);
CREATE INDEX IF NOT EXISTS nr36_pausa_apurada_backup_emp_idx ON public.nr36_pausa_apurada_backup (company_id, data);
ALTER TABLE public.nr36_pausa_apurada_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_pausa_apurada_backup_select ON public.nr36_pausa_apurada_backup;
CREATE POLICY nr36_pausa_apurada_backup_select ON public.nr36_pausa_apurada_backup FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON TABLE public.nr36_pausa_apurada_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.nr36_pausa_apurada_backup TO authenticated;
GRANT ALL ON TABLE public.nr36_pausa_apurada_backup TO service_role;

-- ── reapurar_servico ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_reapurar_servico(p_company uuid, p_ini date, p_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid := gen_random_uuid(); v_bkp int; v_ap jsonb; v_rel jsonb; v_mudaram int;
BEGIN
  IF p_company IS NULL OR p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini THEN
    RAISE EXCEPTION 'periodo_invalido' USING errcode='22023';
  END IF;
  IF (p_fim - p_ini) > 30 THEN
    RAISE EXCEPTION 'periodo_maximo_31_dias' USING errcode='22023';
  END IF;

  INSERT INTO public.nr36_pausa_apurada_backup (backup_id, motivo, linha, company_id, cpf, data, tipo, status_antes)
  SELECT v_id, 'reapuracao_servico', to_jsonb(a), a.company_id, a.cpf, a.data, a.tipo, a.status
    FROM public.nr36_pausa_apurada a
   WHERE a.company_id = p_company AND a.data BETWEEN p_ini AND p_fim;
  GET DIAGNOSTICS v_bkp = ROW_COUNT;

  v_ap := public.fn_nr36_apurar_nucleo(p_company, p_ini, p_fim, NULL);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('de', de, 'para', para, 'dias', n) ORDER BY de, para), '[]'::jsonb),
         COALESCE(sum(n) FILTER (WHERE de IS DISTINCT FROM para), 0)
    INTO v_rel, v_mudaram
    FROM (SELECT b.status_antes AS de, a.status AS para, count(*) n
            FROM public.nr36_pausa_apurada_backup b
            LEFT JOIN public.nr36_pausa_apurada a
              ON a.company_id=b.company_id AND a.cpf=b.cpf AND a.data=b.data AND a.tipo=b.tipo
           WHERE b.backup_id = v_id
           GROUP BY 1,2) x;

  RETURN jsonb_build_object('ok', true, 'backup_id', v_id, 'linhas_backup', v_bkp, 'apuracao', v_ap,
                            'dias_que_mudaram', v_mudaram, 'antes_para_depois', v_rel);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_reapurar_servico(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reapurar_servico(uuid, date, date) TO service_role;
