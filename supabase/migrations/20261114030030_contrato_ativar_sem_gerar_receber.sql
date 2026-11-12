-- P2 (CEO 12/11, teste real): ao ATIVAR um contrato nem sempre se deve gerar as contas a receber
-- (contrato cobrado por fora, permuta, ou o financeiro vai lançar à mão). Hoje ativar SEMPRE gera as
-- parcelas (fn_contrato_mudar_status -> fn_contrato_gerar_parcelas). Aqui o "gerar contas a receber"
-- passa a ser opcional (LIGADO por padrão), sem quebrar quem chama hoje.
--
-- ADITIVA e idempotente:
--  (1) coluna nova erp_contratos.sem_contas_receber (DEFAULT false) para o selo/auditoria;
--  (2) fn_contrato_mudar_status ganha o parâmetro p_gerar_receber boolean DEFAULT true — a assinatura
--      antiga de 3 args (a única usada hoje: pelo ContratoFeeModal e por nenhuma função do banco) é
--      substituída pela de 4 args com o default, então todo chamador de 3 args continua gerando como
--      antes (RD-97, sem quebra); desligado = ativa sem gerar nada e registra o evento no histórico;
--  (3) "?" (RD-95) do novo interruptor.
-- Nenhuma policy/RLS/grant permissivo é afrouxado: a função segue SECURITY DEFINER com REVOKE de PUBLIC
-- e EXECUTE só para authenticated/service_role (igual à versão anterior). Nenhum dado de cliente é apagado.

-- (1) coluna nova
ALTER TABLE public.erp_contratos
  ADD COLUMN IF NOT EXISTS sem_contas_receber boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.erp_contratos.sem_contas_receber IS
  'Contrato ativado sem gerar contas a receber (cobrança externa/permuta/lançamento manual). Selo e botão "Gerar agora".';

-- (2) nova assinatura (4 args) com o interruptor; corpo = o de hoje + o caminho "não gerar"
CREATE OR REPLACE FUNCTION public.fn_contrato_mudar_status(
  p_contrato_id uuid, p_status text, p_mensagem text DEFAULT NULL::text, p_gerar_receber boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_uid uuid := auth.uid(); v_n_arq int; v_soma numeric; v_ger jsonb;
  v_exige_anexo boolean;
  v_validos text[] := ARRAY['solicitado','em_elaboracao','aguardando_info','em_revisao','aguardando_aprovacao','ativo','cancelado','suspenso','encerrado'];
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF NOT (p_status = ANY(v_validos)) THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF p_status = 'aguardando_info' AND COALESCE(btrim(p_mensagem),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'erro','mensagem_obrigatoria'); END IF;

  IF p_status = 'ativo' THEN
    -- #2a3909d9: a exigência do anexo é configurável por empresa (padrão true = como antes).
    v_exige_anexo := COALESCE((SELECT exigir_contrato_anexado FROM erp_contratos_config WHERE company_id = v_c.company_id), true);
    IF v_exige_anexo THEN
      SELECT count(*) INTO v_n_arq FROM erp_contratos_arquivos WHERE contrato_id = p_contrato_id AND tipo IN ('contrato','contrato_assinado');
      IF v_n_arq < 1 THEN RETURN jsonb_build_object('ok',false,'erro','anexo_contrato_obrigatorio'); END IF;
    END IF;
    -- exigir plano com valor só faz sentido quando vamos gerar as contas a receber
    IF p_gerar_receber THEN
      SELECT COALESCE(SUM(valor),0) INTO v_soma FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;
      IF v_soma <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','plano_sem_valor'); END IF;
    END IF;
  END IF;

  UPDATE erp_contratos
     SET status = p_status, updated_at = now(),
         sem_contas_receber = CASE WHEN p_status = 'ativo' THEN NOT p_gerar_receber ELSE sem_contas_receber END
   WHERE id = p_contrato_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_contrato_id, v_c.company_id, 'status_'||p_status,
    COALESCE(NULLIF(btrim(p_mensagem),''), format('Status alterado de %s para %s', v_c.status, p_status)),
    jsonb_build_object('de', v_c.status, 'para', p_status), v_uid, now());

  IF p_status = 'ativo' THEN
    IF p_gerar_receber THEN
      v_ger := fn_contrato_gerar_parcelas(p_contrato_id);
    ELSE
      -- ativado sem gerar: fica no histórico (quem/quando) para o selo e a auditoria
      INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
      VALUES (p_contrato_id, v_c.company_id, 'ativado_sem_contas_receber',
        'Contrato ativado sem gerar contas a receber (cobrança externa, permuta ou lançamento manual).',
        jsonb_build_object('por', v_uid), v_uid, now());
      v_ger := jsonb_build_object('gerados', 0, 'total', 0, 'sem_contas_receber', true);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'gerador', v_ger,
    'sem_contas_receber', CASE WHEN p_status = 'ativo' THEN NOT p_gerar_receber ELSE NULL END);
END;
$function$;

-- remove a assinatura antiga de 3 args (o 4-args cobre todo chamador pelo default; evita ambiguidade)
DROP FUNCTION IF EXISTS public.fn_contrato_mudar_status(uuid, text, text);

-- grants iguais à versão anterior: nada para PUBLIC/anon
REVOKE ALL ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text, boolean) TO authenticated, service_role;

-- (3) "?" (RD-95) do interruptor novo
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Contratos', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/contratos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.contrato.ativar.gerar_receber', 'Gerar contas a receber ao ativar',
  'Deixe ligado para o sistema lançar as parcelas do contrato em Contas a Receber na hora de ativar. Desligue quando o contrato for cobrado por fora, for permuta, ou o financeiro for lançar os títulos à mão.',
  'Evita títulos duplicados quando a cobrança não sai pelo ERP. Desligado, o contrato ativa sem gerar nada — depois dá para gerar pelo botão "Gerar agora" no contrato.',
  'Permuta de serviços: desligue para ativar sem lançar cobrança.',
  'Desligar por engano num contrato que é cobrado pelo ERP: ative o botão "Gerar agora" para lançar as parcelas.', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
