-- ============================================================
-- Chamado #4917 (jordana-code, pedido da Jordana pelo Canal PS, 26/10): desligar o Omie SÓ da
-- Gean Auto Mecânica e da Toy Tintas. R.R, M.M, Tryo Acabamentos e Tryo Gesso NÃO mudam.
-- Prova (RD-38, 26/10): erp_provider_config da Gean = omie/shadow_mode/ativo, Toy = omie/read_only/ativo;
-- a Gean tem 407 linhas 'pendente' em erp_outbox_sync (nunca enviadas: o cron erp-outbox-processar e os
-- crons omie_sync_* estão inativos). Decisão: "não processar os pendentes da Gean" -> viram 'cancelado'.
-- Backup em _bkp_omie_4917_20261027 (config das duas + id/status dos pendentes), só service_role lê.
-- ============================================================
DO $mig$
DECLARE
  v_gean constant uuid := 'a462e13f-0f51-4c54-abe8-4474b591633b';
  v_toy  constant uuid := '22a7f4fd-149d-47ee-8dd2-bfbb4c897f58';
  v_n int;
BEGIN
  SET LOCAL lock_timeout = '5s';

  CREATE TABLE IF NOT EXISTS public._bkp_omie_4917_20261027 (
    id bigserial PRIMARY KEY, tabela text NOT NULL, company_id uuid NOT NULL, dados jsonb NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public._bkp_omie_4917_20261027 ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public._bkp_omie_4917_20261027 FROM PUBLIC, anon, authenticated;

  -- banco de testes (vaga) não tem as empresas reais: sai sem gravar
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_gean) AND NOT EXISTS (SELECT 1 FROM companies WHERE id = v_toy) THEN
    RAISE NOTICE 'Gean/Toy Tintas não existem neste banco: nada a desligar.';
    RETURN;
  END IF;

  INSERT INTO public._bkp_omie_4917_20261027 (tabela, company_id, dados)
    SELECT 'erp_provider_config', pc.company_id, to_jsonb(pc) FROM erp_provider_config pc
     WHERE pc.company_id IN (v_gean, v_toy) AND pc.provider = 'omie';
  INSERT INTO public._bkp_omie_4917_20261027 (tabela, company_id, dados)
    SELECT 'erp_outbox_sync', o.company_id, jsonb_build_object('id', o.id, 'status', o.status, 'erro_mensagem', o.erro_mensagem)
      FROM erp_outbox_sync o
     WHERE o.company_id = v_gean AND o.provider = 'omie' AND o.status IN ('pendente', 'erro_temporario');

  -- 1) desliga a integração das duas (a config fica, só ativo = false: religar é um UPDATE)
  UPDATE erp_provider_config SET ativo = false, updated_at = now(),
         observacoes = concat_ws(' | ', nullif(observacoes, ''), 'Desligado em 27/10/2026 a pedido da Jordana (chamado #4917)')
   WHERE company_id IN (v_gean, v_toy) AND provider = 'omie' AND ativo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Omie desligado em % empresa(s) (Gean/Toy Tintas).', v_n;

  -- 2) pendentes da Gean não são processados
  UPDATE erp_outbox_sync SET status = 'cancelado',
         erro_mensagem = 'Cancelado: Omie desligado para a empresa (chamado #4917, 27/10/2026)'
   WHERE company_id = v_gean AND provider = 'omie' AND status IN ('pendente', 'erro_temporario');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Pendentes do outbox da Gean cancelados: %.', v_n;
END $mig$;
