-- Main vermelha acorda o gilberto-esteira NA HORA (CEO 30/10, spec do Eng. Chefe 36c3291f) — por evento, sem cron.
-- Aditiva: coluna nova + CREATE OR REPLACE de fn_dev_main_teste_set (mesma assinatura) com 2 acréscimos:
--   (1) só na TRANSIÇÃO para vermelho (verde era true/desconhecido) e esteira_acionado_em IS NULL → mensagem P0 ao esteira
--       (fn_agente_mensagem_enviar já aciona, aciona=true) e grava esteira_acionado_em;
--   (2) ao ficar verde, zera esteira_acionado_em (pronto para o próximo episódio). Anti-spam: 1 despertar por episódio.
-- O alerta ao CEO (30 min) fica como está.
ALTER TABLE public.erp_dev_main_teste ADD COLUMN IF NOT EXISTS esteira_acionado_em timestamptz;

CREATE OR REPLACE FUNCTION public.fn_dev_main_teste_set(
  p_verde boolean, p_spec text DEFAULT NULL, p_run_id bigint DEFAULT NULL,
  p_run_url text DEFAULT NULL, p_head_sha text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
-- ci-sem-guarda: fn_dev_main_teste_set — status global de CI (tabela de 1 linha, sem company_id); escrita só service_role
DECLARE
  v_antes boolean;
  v_acionado timestamptz;
BEGIN
  SELECT verde, esteira_acionado_em INTO v_antes, v_acionado FROM erp_dev_main_teste WHERE id = 1;

  INSERT INTO erp_dev_main_teste AS m (id, verde, desde, spec_falha, run_id, run_url, head_sha, alertado_em, atualizado_em)
  VALUES (1, p_verde, now(), p_spec, p_run_id, p_run_url, p_head_sha, NULL, now())
  ON CONFLICT (id) DO UPDATE SET
    verde         = EXCLUDED.verde,
    desde         = CASE WHEN m.verde IS DISTINCT FROM EXCLUDED.verde THEN now() ELSE m.desde END,
    spec_falha    = EXCLUDED.spec_falha,
    run_id        = EXCLUDED.run_id,
    run_url       = EXCLUDED.run_url,
    head_sha      = EXCLUDED.head_sha,
    alertado_em   = CASE WHEN EXCLUDED.verde THEN NULL ELSE m.alertado_em END,
    atualizado_em = now();

  IF p_verde THEN
    UPDATE erp_dev_main_teste SET esteira_acionado_em = NULL WHERE id = 1;
    UPDATE erp_truth_alerts
       SET status = 'resolvido', resolvido_em = now(), updated_at = now(),
           notas_resolucao = COALESCE(notas_resolucao, 'main @pos-migration voltou a verde')
     WHERE rule_id = 'dev_main_pos_migration_vermelha' AND status = 'novo';
  ELSIF v_antes IS DISTINCT FROM false AND v_acionado IS NULL THEN
    PERFORM public.fn_agente_mensagem_enviar(
      'gilberto-esteira', 'eng_chefe', 'aviso',
      'P0 AUTO: MAIN VERMELHA — conserte já',
      'A main ficou VERMELHA agora. Run: ' || COALESCE(p_run_url, '(sem url)')
        || E'\nSpec que falhou: ' || COALESCE(p_spec, '(não identificado)')
        || E'\nhead: ' || COALESCE(p_head_sha, '?')
        || E'\nConserte JÁ (playbook: anotações do check-run → quarentena / reverter PR culpada / consertar spec; crítico → alertar CEO).',
      false, 'main-vermelha-auto');
    UPDATE erp_dev_main_teste SET esteira_acionado_em = now() WHERE id = 1;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.fn_dev_main_teste_set(boolean,text,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_main_teste_set(boolean,text,bigint,text,text) TO service_role;
