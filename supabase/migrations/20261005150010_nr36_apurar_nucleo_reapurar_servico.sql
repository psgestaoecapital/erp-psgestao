-- NR-36 · reapuração de setembro da Frioeste (#587) — padrão "núcleo + porta" (Eng. Chefe 05/10, msg 066c313a).
-- O cálculo sai de fn_nr36_apurar para fn_nr36_apurar_nucleo (SEM fn_nr36_assert, só service_role). A porta
-- fn_nr36_apurar continua = fn_nr36_assert + núcleo (resultado idêntico para a tela, uma fonte só, RD-65).
-- O guarda fn_nr36_assert NÃO é tocado (RD-91). Idem para fn_nr36_classificar_eventos (também chama o assert).
-- A definição do núcleo é derivada da definição VIVA no banco (pg_get_functiondef), não de cópia do repositório:
-- âncoras exatas, e a migration FALHA se a âncora não existir (nada é aplicado pela metade).
-- fn_nr36_reapurar_servico: só service_role; backup carimbado das linhas do período em nr36_pausa_apurada_backup,
-- reapura pelo núcleo e devolve o relatório antes→depois por status. Máximo 31 dias por chamada.

CREATE TABLE IF NOT EXISTS public.nr36_pausa_apurada_backup (
  backup_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_ref    uuid NOT NULL,
  backup_em     timestamptz NOT NULL DEFAULT now(),
  backup_motivo text,
  LIKE public.nr36_pausa_apurada
);
ALTER TABLE public.nr36_pausa_apurada_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nr36_pausa_apurada_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.nr36_pausa_apurada_backup TO service_role;
CREATE INDEX IF NOT EXISTS nr36_pausa_apurada_backup_ref_idx ON public.nr36_pausa_apurada_backup (backup_ref);

DO $mig$
DECLARE d text; n text;
BEGIN
  IF to_regprocedure('public.fn_nr36_classificar_eventos_nucleo(uuid)') IS NULL THEN
    d := pg_get_functiondef('public.fn_nr36_classificar_eventos(uuid)'::regprocedure);
    IF position('PERFORM public.fn_nr36_assert(p_company_id);' in d) = 0 THEN
      RAISE EXCEPTION 'âncora ausente em fn_nr36_classificar_eventos (definição viva mudou)';
    END IF;
    n := replace(d, 'FUNCTION public.fn_nr36_classificar_eventos(', 'FUNCTION public.fn_nr36_classificar_eventos_nucleo(');
    n := replace(n, 'PERFORM public.fn_nr36_assert(p_company_id);', '');
    EXECUTE n;
  END IF;
  IF to_regprocedure('public.fn_nr36_apurar_nucleo(uuid,date,date,text)') IS NULL THEN
    d := pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date,text)'::regprocedure);
    IF position('PERFORM public.fn_nr36_assert(p_company_id);' in d) = 0
       OR position('PERFORM public.fn_nr36_classificar_eventos(p_company_id);' in d) = 0 THEN
      RAISE EXCEPTION 'âncora ausente em fn_nr36_apurar (definição viva mudou)';
    END IF;
    n := replace(d, 'FUNCTION public.fn_nr36_apurar(', 'FUNCTION public.fn_nr36_apurar_nucleo(');
    n := replace(n, 'PERFORM public.fn_nr36_assert(p_company_id);', '');
    n := replace(n, 'PERFORM public.fn_nr36_classificar_eventos(p_company_id);', 'PERFORM public.fn_nr36_classificar_eventos_nucleo(p_company_id);');
    EXECUTE n;
  END IF;
END
$mig$;

REVOKE ALL ON FUNCTION public.fn_nr36_classificar_eventos_nucleo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_classificar_eventos_nucleo(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_nr36_apurar_nucleo(uuid,date,date,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar_nucleo(uuid,date,date,text) TO service_role;

-- Portas: assert + núcleo (mesma assinatura e mesmo retorno de hoje).
CREATE OR REPLACE FUNCTION public.fn_nr36_classificar_eventos(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  RETURN public.fn_nr36_classificar_eventos_nucleo(p_company_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_classificar_eventos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_classificar_eventos(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  RETURN public.fn_nr36_apurar_nucleo(p_company_id, p_dt_ini, p_dt_fim, p_cpf);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_apurar(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar(uuid,date,date,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_nr36_reapurar_servico(p_company uuid, p_ini date, p_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_ref uuid := gen_random_uuid(); v_bkp int; v_res jsonb; v_antes jsonb; v_depois jsonb; v_mud jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company);
  IF p_company IS NULL OR p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini THEN
    RAISE EXCEPTION 'periodo_invalido' USING errcode = '22023';
  END IF;
  IF p_fim - p_ini > 30 THEN
    RAISE EXCEPTION 'periodo_maior_que_31_dias' USING errcode = '22023';
  END IF;
  INSERT INTO public.nr36_pausa_apurada_backup (backup_ref, backup_motivo, id, company_id, colaborador_id, cpf, data, tipo,
      jornada_seg, devido_min, realizado_min, diferenca_min, status, detalhe, apurado_em)
    SELECT v_ref, 'reapuracao_servico ' || p_ini || ' a ' || p_fim, a.id, a.company_id, a.colaborador_id, a.cpf, a.data, a.tipo,
      a.jornada_seg, a.devido_min, a.realizado_min, a.diferenca_min, a.status, a.detalhe, a.apurado_em
    FROM public.nr36_pausa_apurada a WHERE a.company_id = p_company AND a.data BETWEEN p_ini AND p_fim;
  GET DIAGNOSTICS v_bkp = ROW_COUNT;
  v_res := public.fn_nr36_apurar_nucleo(p_company, p_ini, p_fim, NULL);
  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_antes
    FROM (SELECT status, count(*) n FROM public.nr36_pausa_apurada_backup WHERE backup_ref = v_ref GROUP BY 1) x;
  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_depois
    FROM (SELECT status, count(*) n FROM public.nr36_pausa_apurada WHERE company_id = p_company AND data BETWEEN p_ini AND p_fim GROUP BY 1) x;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('de', t.de, 'para', t.para, 'dias', t.n) ORDER BY t.de, t.para), '[]'::jsonb) INTO v_mud
    FROM (SELECT b.status AS de, a.status AS para, count(*) n
            FROM public.nr36_pausa_apurada_backup b
            JOIN public.nr36_pausa_apurada a ON a.company_id = b.company_id AND a.cpf = b.cpf AND a.data = b.data AND a.tipo = b.tipo
           WHERE b.backup_ref = v_ref AND a.status IS DISTINCT FROM b.status GROUP BY 1, 2) t;
  RETURN jsonb_build_object('ok', true, 'backup_ref', v_ref, 'linhas_backup', v_bkp, 'apuracao', v_res,
    'status_antes', v_antes, 'status_depois', v_depois, 'mudancas', v_mud);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_reapurar_servico(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reapurar_servico(uuid,date,date) TO service_role;
