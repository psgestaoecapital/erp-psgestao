-- CEO/Eng. Chefe 27/11 (revisão da #6431) — levar a trava "ativação só pelo financeiro" para um TRIGGER na tabela.
--
-- A trava dentro de fn_contrato_mudar_status (merge #6431) está correta, mas é CONTORNÁVEL por 3 caminhos (provado no
-- banco pelo Eng. Chefe): (1) fn_contrato_editar aceita status no patch (ativo/suspenso); (2) fn_contrato_salvar cria/
-- atualiza com status livre (COALESCE(..., 'ativo')); (3) UPDATE direto pela API (RLS authenticated com UPDATE).
--
-- Solução: um ÚNICO ponto de enforcement — BEFORE INSERT OR UPDATE OF status ON erp_contratos — cobre o RPC e os 3
-- caminhos. A checagem no RPC fica (mensagem amigável), mas a GARANTIA passa a ser o trigger.
--
-- Regra (idêntica à do RPC): empresa com erp_contratos_config.ativacao_pelo_financeiro = true e NEW.status em
-- (em_elaboracao, ativo), para contrato de receita (fee):
--   • UPDATE que muda o status → só financeiro/master (ou PS); o SOLICITANTE nunca move o próprio pedido → 42501;
--   • INSERT sem papel financeiro → nasce 'solicitado' (em vez de erro) — o vendedor continua conseguindo PEDIR;
--   • interno (migrations/cron, request.jwt.claims vazio), service_role e is_admin() (PS) passam;
--   • opção DESLIGADA, ou natureza != receita → nada muda (comportamento de hoje).
--
-- REVOKE anon / GRANT (check:fn-guards). ci-sem-guarda: é gatilho do próprio contrato (a guarda de empresa é a regra).

CREATE OR REPLACE FUNCTION public.fn_contrato_segregacao_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ci-sem-guarda: fn_contrato_segregacao_status — gatilho do próprio contrato; a guarda de empresa É a regra que ele aplica
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_uid uuid := auth.uid();
  v_eh_fin boolean;
BEGIN
  -- interno/service_role/PS passam; status não protegido ou contrato não-receita seguem como hoje
  IF v_interno OR auth.role() = 'service_role' OR is_admin() THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('em_elaboracao', 'ativo') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.natureza, 'receita') <> 'receita' THEN RETURN NEW; END IF;
  -- só com a opção LIGADA na empresa
  IF NOT COALESCE((SELECT ativacao_pelo_financeiro FROM erp_contratos_config WHERE company_id = NEW.company_id), false) THEN
    RETURN NEW;
  END IF;

  v_eh_fin := EXISTS (SELECT 1 FROM user_companies uc
                      WHERE uc.user_id = v_uid AND uc.company_id = NEW.company_id AND uc.role IN ('financeiro', 'master'));

  IF TG_OP = 'INSERT' THEN
    -- INSERT sem papel financeiro → nasce 'solicitado' (o vendedor continua PEDINDO), em vez de erro.
    IF NOT v_eh_fin THEN NEW.status := 'solicitado'; END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: só quando o status REALMENTE muda para em_elaboracao/ativo.
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.solicitante_id IS NOT NULL AND NEW.solicitante_id = v_uid THEN
      RAISE EXCEPTION 'Pedido enviado ao financeiro — ele elabora e ativa o contrato.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_eh_fin THEN
      RAISE EXCEPTION 'Pedido enviado ao financeiro — ele elabora e ativa o contrato.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contrato_segregacao_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_segregacao_status() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_contrato_segregacao_status ON public.erp_contratos;
CREATE TRIGGER trg_contrato_segregacao_status
  BEFORE INSERT OR UPDATE OF status ON public.erp_contratos
  FOR EACH ROW EXECUTE FUNCTION public.fn_contrato_segregacao_status();

-- ── PROVA RD-38 — o trigger e o gatilho existem ─────────────────────────────────────────────────────────────────
DO $$
DECLARE v_fn boolean; v_trg boolean;
BEGIN
  SELECT pg_get_functiondef('public.fn_contrato_segregacao_status'::regproc) LIKE '%Pedido enviado ao financeiro%' INTO v_fn;
  IF NOT v_fn THEN RAISE EXCEPTION 'RD-38: fn_contrato_segregacao_status ausente/sem a trava'; END IF;
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_contrato_segregacao_status' AND NOT tgisinternal) INTO v_trg;
  IF NOT v_trg THEN RAISE EXCEPTION 'RD-38: trigger trg_contrato_segregacao_status ausente'; END IF;
  RAISE NOTICE 'RD-38 OK: trigger de segregação BEFORE INSERT OR UPDATE OF status em erp_contratos';
END $$;
