-- Omie DESCONECTADO EM DEFINITIVO (CEO 02/10/2026). O histórico importado continua no sistema; nada de dado de negócio é apagado.
--
-- Estado antes (conferido no banco, 02/10 ~13h):
--   · crons 3 (omie_sync_orquestrador), 4 (omie_sync_processar_respostas) e 14 (erp-outbox-processar) já INATIVOS
--     (o 14 desligado pelo Eng. Chefe às 12h50); último ultima_sync do ETL Omie: 10h20;
--   · triggers trg_outbox_pagar / trg_outbox_receber ainda LIGADOS (enfileiram na erp_outbox_sync);
--   · 8 funções ainda fazem HTTP ao Omie (direto ou pela rota /api/omie/sync) e fn_sync_controle ainda deixava
--     "Sincronizar agora" e "Reativar todos" (recriaria os crons) na tela /admin/sync-status;
--   · erp_credencial: 12 credenciais Omie (app_key + app_secret) de 6 empresas, todas no cofre.
--
-- Esta migration:
--   (1) desliga os triggers que enfileiram na erp_outbox_sync e cancela os pendentes ('Omie desligado em 02/10/2026');
--   (2) garante os 3 crons do Omie inativos (sem apagar o job — fica o registro);
--   (3) trava as funções que chamam o Omie: a primeira linha do corpo passa a ser RAISE (nenhuma chamada sai);
--   (4) fn_sync_controle: "sync_agora" e "reativar_todos" recusam; "pausar_todos" segue;
--   (5) erp_provider_config do Omie: ativo = false;
--   (6) CREDENCIAIS (CEO, com travas): remove do cofre SÓ os segredos do Omie pelo padrão do nome
--       omie_app_(key|secret)_<company_id> das 6 empresas; ABORTA se a contagem não for exatamente 12; registra nome,
--       empresa e data em audit_log_global (NUNCA o valor); confere que o total do cofre caiu exatamente 12;
--       erp_credencial fica inativa com a observação.

-- (1) outbox: não enfileira mais; pendentes cancelados com motivo
ALTER TABLE public.erp_pagar   DISABLE TRIGGER trg_outbox_pagar;
ALTER TABLE public.erp_receber DISABLE TRIGGER trg_outbox_receber;
UPDATE public.erp_outbox_sync
   SET status = 'cancelado', erro_mensagem = 'Omie desligado em 02/10/2026', updated_at = now()
 WHERE provider = 'omie' AND status IN ('pendente', 'em_processamento', 'erro_temporario');

-- (2) crons do Omie inativos (idempotente)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job
            WHERE jobname IN ('omie_sync_orquestrador', 'omie_sync_processar_respostas', 'erp-outbox-processar') AND active LOOP
    PERFORM cron.alter_job(r.jobid, active := false);
  END LOOP;
END $$;

-- (3) funções que chamam o Omie: RAISE na primeira linha do corpo (patch por âncora; aborta se a âncora não existir)
DO $$
DECLARE
  v_fn regprocedure; v_def text; v_novo text;
  v_guarda constant text := E'\n  -- Omie desligado em 02/10/2026 (CEO): nenhuma chamada ao Omie sai daqui.\n  RAISE EXCEPTION ''Omie desligado em 02/10/2026'' USING ERRCODE = ''P0001'';\n';
BEGIN
  FOR v_fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname IN (
                 'fn_omie_sync_empresa', 'fn_omie_sync_etapa', 'fn_omie_test_consulta', 'fn_omie_validar_credenciais_e_lancamento',
                 'fn_outbox_omie_dispatch', 'fn_outbox_omie_processar', 'fn_outbox_processar_lote',
                 'fn_sync_empresa', 'fn_sync_produtos_empresa', 'fn_sync_orquestrador', 'fn_processar_respostas_sync') LOOP
    v_def := pg_get_functiondef(v_fn);
    CONTINUE WHEN position('Omie desligado em 02/10/2026' IN v_def) > 0;
    v_novo := regexp_replace(v_def, E'(\\nBEGIN[ \\t]*)\\n', E'\\1' || replace(v_guarda, '\', '\\'));
    IF v_novo = v_def THEN RAISE EXCEPTION 'âncora BEGIN não encontrada em %', v_fn; END IF;
    EXECUTE v_novo;
  END LOOP;
END $$;

-- (4) controle de sync: não dispara nem reativa mais o Omie
CREATE OR REPLACE FUNCTION public.fn_sync_controle(p_acao text, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- PR A2 (CEO 28/09): só a equipe PS (ou chamada de serviço/cron, sem usuário)
  IF auth.uid() IS NOT NULL AND NOT (public.is_admin() OR EXISTS (SELECT 1 FROM public.users u
       WHERE u.id = auth.uid() AND u.system_role IS NOT NULL)) THEN
    RAISE EXCEPTION 'Acesso restrito à equipe PS' USING ERRCODE = '42501';
  END IF;

  IF p_acao IN ('sync_agora', 'reativar_todos') THEN
    -- Omie desligado em 02/10/2026 (CEO): não há mais sincronização nem crons para reativar.
    RETURN jsonb_build_object('erro', 'Omie desligado em 02/10/2026', 'mensagem', 'Omie desligado em 02/10/2026');

  ELSIF p_acao = 'pausar_todos' THEN
    PERFORM cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname LIKE 'omie_sync%' AND active = true;
    RETURN jsonb_build_object('sucesso', true, 'mensagem', 'Crons pausados');

  ELSE
    RETURN jsonb_build_object('erro', 'ação inválida: ' || p_acao);
  END IF;
END;
$function$;

-- (5) provedor Omie inativo em todas as empresas
UPDATE public.erp_provider_config
   SET ativo = false, updated_at = now(),
       observacoes = concat_ws(' · ', nullif(observacoes, ''), 'Omie desligado em 02/10/2026')
 WHERE provider = 'omie' AND ativo;

-- (6) credenciais do Omie fora do cofre — com as travas do CEO
DO $$
DECLARE
  c_padrao constant text := '^omie_app_(key|secret)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_nomes text[]; v_empresas int; v_no_cofre int; v_apagados int; v_total_antes bigint; v_total_depois bigint;
BEGIN
  -- só segredos do Omie, pelo padrão do nome, cujo company_id do nome é o da própria credencial
  SELECT array_agg(e.nome_secret_vault), count(DISTINCT e.company_id)
    INTO v_nomes, v_empresas
    FROM public.erp_credencial e
   WHERE e.provider = 'omie' AND e.nome_secret_vault ~ c_padrao
     AND right(e.nome_secret_vault, 36) = e.company_id::text;

  SELECT count(*) INTO v_no_cofre FROM vault.secrets s WHERE s.name = ANY(v_nomes) AND s.name ~ c_padrao;
  IF coalesce(array_length(v_nomes, 1), 0) <> 12 OR v_empresas <> 6 OR v_no_cofre <> 12 THEN
    RAISE EXCEPTION 'Omie: esperadas exatamente 12 credenciais de 6 empresas no cofre; registro=%, empresas=%, cofre=% — nada foi removido',
      coalesce(array_length(v_nomes, 1), 0), v_empresas, v_no_cofre;
  END IF;

  SELECT count(*) INTO v_total_antes FROM vault.secrets;

  -- registro: nome, empresa e data — NUNCA o valor
  INSERT INTO public.audit_log_global (company_id, tabela, registro_id, acao, valor_anterior, valor_novo, created_at)
  SELECT e.company_id, 'vault.secrets', s.id::text, 'omie_credencial_removida',
         jsonb_build_object('nome', s.name, 'empresa', co.nome_fantasia, 'company_id', e.company_id),
         jsonb_build_object('motivo', 'Omie desligado em 02/10/2026', 'removido_em', now()),
         now()
    FROM vault.secrets s
    JOIN public.erp_credencial e ON e.nome_secret_vault = s.name AND e.provider = 'omie'
    LEFT JOIN public.companies co ON co.id = e.company_id
   WHERE s.name = ANY(v_nomes) AND s.name ~ c_padrao;

  DELETE FROM vault.secrets s WHERE s.name = ANY(v_nomes) AND s.name ~ c_padrao;
  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  SELECT count(*) INTO v_total_depois FROM vault.secrets;
  IF v_apagados <> 12 OR v_total_antes - v_total_depois <> 12 THEN
    RAISE EXCEPTION 'Omie: remoção fora do esperado (removidos=%, antes=%, depois=%) — desfeito', v_apagados, v_total_antes, v_total_depois;
  END IF;

  UPDATE public.erp_credencial
     SET ativo = false, atualizado_em = now(),
         observacao = concat_ws(' · ', nullif(observacao, ''), 'Omie desligado em 02/10/2026 — segredo removido do cofre')
   WHERE provider = 'omie' AND nome_secret_vault = ANY(v_nomes);

  RAISE NOTICE 'Omie: 12 credenciais de 6 empresas removidas do cofre (total % → %)', v_total_antes, v_total_depois;
END $$;
