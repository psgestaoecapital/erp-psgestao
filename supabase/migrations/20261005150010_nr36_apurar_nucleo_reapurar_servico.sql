-- NR-36 #587 · reapuração de setembro da Frioeste (Eng. Chefe 05/10, mensagem 066c313a): padrão "núcleo + porta".
--  • fn_nr36_classificar_eventos_nucleo / fn_nr36_apurar_nucleo: o MESMO cálculo vivo, SEM fn_nr36_assert (RD-91 intocada),
--    só service_role (REVOKE de PUBLIC/anon/authenticated). Geradas da definição VIVA no banco (lição #2010: nunca da do
--    repositório) — a âncora falha se a definição viva mudou de forma.
--  • fn_nr36_apurar (a porta da tela): continua = fn_nr36_assert + chamada ao núcleo. Uma fonte só do cálculo (RD-65).
--  • fn_nr36_reapurar_servico: só service_role, no máx. 31 dias; faz backup carimbado de nr36_pausa_apurada do período,
--    reapura pelo núcleo e devolve o relatório antes → depois por status (sem CPF, RD-LGPD).
-- Esta migration não altera nenhuma linha de cliente (só funções e uma tabela nova de backup, vazia).

CREATE TABLE IF NOT EXISTS public.nr36_pausa_apurada_backup (LIKE public.nr36_pausa_apurada);
ALTER TABLE public.nr36_pausa_apurada_backup
  ADD COLUMN IF NOT EXISTS backup_id uuid, ADD COLUMN IF NOT EXISTS backup_em timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS backup_motivo text;
CREATE INDEX IF NOT EXISTS ix_nr36_pausa_apurada_backup_id ON public.nr36_pausa_apurada_backup (backup_id);
ALTER TABLE public.nr36_pausa_apurada_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nr36_pausa_apurada_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.nr36_pausa_apurada_backup TO service_role;
DROP POLICY IF EXISTS nr36_pausa_apurada_backup_empresa ON public.nr36_pausa_apurada_backup;
CREATE POLICY nr36_pausa_apurada_backup_empresa ON public.nr36_pausa_apurada_backup FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) AND public.is_admin());

DO $mig$
DECLARE
  v_cls text; v_apu text; v_assert text := E'  PERFORM public.fn_nr36_assert(p_company_id);\n';
  v_call text := 'PERFORM public.fn_nr36_classificar_eventos(p_company_id);';
BEGIN
  SELECT pg_get_functiondef('public.fn_nr36_classificar_eventos(uuid)'::regprocedure) INTO v_cls;
  SELECT pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date,text)'::regprocedure) INTO v_apu;

  -- se a apurar viva já é a porta (esta migration já rodou), nada a fazer
  IF v_apu LIKE '%fn_nr36_apurar_nucleo%' THEN RETURN; END IF;

  IF position(v_assert IN v_cls) = 0 OR position('FUNCTION public.fn_nr36_classificar_eventos(' IN v_cls) = 0 THEN
    RAISE EXCEPTION 'nr36 núcleo: âncora de fn_nr36_classificar_eventos não bate';
  END IF;
  IF position(v_assert IN v_apu) = 0 OR position(v_call IN v_apu) = 0 OR position('FUNCTION public.fn_nr36_apurar(' IN v_apu) = 0 THEN
    RAISE EXCEPTION 'nr36 núcleo: âncora de fn_nr36_apurar não bate';
  END IF;

  v_cls := replace(replace(v_cls, v_assert, ''), 'FUNCTION public.fn_nr36_classificar_eventos(', 'FUNCTION public.fn_nr36_classificar_eventos_nucleo(');
  EXECUTE v_cls;

  v_apu := replace(replace(replace(v_apu, v_assert, ''), v_call, 'PERFORM public.fn_nr36_classificar_eventos_nucleo(p_company_id);'),
                   'FUNCTION public.fn_nr36_apurar(', 'FUNCTION public.fn_nr36_apurar_nucleo(');
  EXECUTE v_apu;
END $mig$;

REVOKE ALL ON FUNCTION public.fn_nr36_classificar_eventos_nucleo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_classificar_eventos_nucleo(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_nr36_apurar_nucleo(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar_nucleo(uuid, date, date, text) TO service_role;

-- ci-sem-guarda: fn_nr36_apurar_nucleo — só service_role (REVOKE de PUBLIC/anon/authenticated); a porta da tela confere o acesso
-- ci-sem-guarda: fn_nr36_classificar_eventos_nucleo — só service_role (REVOKE de PUBLIC/anon/authenticated)
-- ci-sem-guarda: fn_nr36_reapurar_servico — só service_role (REVOKE de PUBLIC/anon/authenticated); chamada pela rotina de serviço

-- a porta: mesma assinatura, mesma saída, mesmo acesso de antes
CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  RETURN public.fn_nr36_apurar_nucleo(p_company_id, p_dt_ini, p_dt_fim, p_cpf);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_apurar(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar(uuid, date, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_nr36_reapurar_servico(p_company uuid, p_ini date, p_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_bk uuid := gen_random_uuid(); v_n int; v_apur jsonb; v_rel jsonb; v_tot int;
BEGIN
  IF p_company IS NULL OR p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini THEN
    RAISE EXCEPTION 'periodo_invalido' USING errcode = '22023';
  END IF;
  IF p_fim - p_ini > 30 THEN
    RAISE EXCEPTION 'periodo_maximo_31_dias' USING errcode = '22023';
  END IF;
  INSERT INTO public.nr36_pausa_apurada_backup
    SELECT a.*, v_bk, now(), 'reapuracao_servico ' || p_ini || '..' || p_fim
      FROM public.nr36_pausa_apurada a
     WHERE a.company_id = p_company AND a.data BETWEEN p_ini AND p_fim;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_apur := public.fn_nr36_apurar_nucleo(p_company, p_ini, p_fim, NULL);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('de', x.de, 'para', x.para, 'dias', x.n) ORDER BY x.de, x.para), '[]'::jsonb),
         COALESCE(sum(x.n), 0)::int
    INTO v_rel, v_tot
    FROM (SELECT b.status AS de, COALESCE(a.status, '(sem linha)') AS para, count(*) AS n
            FROM public.nr36_pausa_apurada_backup b
            LEFT JOIN public.nr36_pausa_apurada a
              ON a.company_id = b.company_id AND a.cpf = b.cpf AND a.data = b.data AND a.tipo = b.tipo
           WHERE b.backup_id = v_bk
             AND b.status IS DISTINCT FROM COALESCE(a.status, '(sem linha)')
           GROUP BY 1, 2) x;
  RETURN jsonb_build_object('ok', true, 'backup_id', v_bk, 'linhas_backup', v_n, 'apuracao', v_apur,
                            'dias_mudaram', v_tot, 'mudancas', v_rel);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_reapurar_servico(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reapurar_servico(uuid, date, date) TO service_role;
