-- ============================================================
-- fn_sugestao_rascunho_ia — a IA grava RASCUNHO de resposta na trilha, sem poder aprovar nem enviar
-- ============================================================
-- Motivo: o rascunho de resposta hoje é escrito no chat e copiado à mão pra tela — mensagem avulsa fora
-- do chamado, fora da trilha. Esta RPC deixa a IA gravar o rascunho DIRETO no chamado. fn_sugestao_responder
-- exige auth.uid() (e barra service_role, corretamente — quem responde cliente tem que ser identificável);
-- não contornamos aquele guard. Esta função é um caminho SEPARADO, desenhado para ser incapaz de causar dano:
--   1. SEMPRE resposta_aprovada = false — sem parâmetro para mudar. A RPC não aprova nada.
--   2. SEMPRE resposta_origem = 'ia' e resposta_redigida_por = NULL — fica claro na tela que foi a IA.
--   3. RECUSA se resposta_aprovada já for true (não sobrescreve resposta aprovada/enviada) → 'ja_aprovada'.
--   4. RECUSA se o chamado estiver em status terminal → 'status_terminal'.
--   5. Só service_role chama (GRANT abaixo; REVOKE de public/anon/authenticated — não exposta ao app).
--   6. NÃO envia e-mail: não há trigger em sugestoes (só fn_sugestao_aprovar_resposta envia, na aprovação
--      do CEO — fluxo intocado).
-- O CEO segue o ÚNICO que aprova: lê o rascunho na tela, aprova/corrige/descarta. Salvaguarda intacta.

CREATE OR REPLACE FUNCTION public.fn_sugestao_rascunho_ia(p_numero int, p_texto text, p_modelo text DEFAULT 'claude')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_aprovada boolean; v_status text;
BEGIN
  IF COALESCE(btrim(p_texto),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_vazia'); END IF;
  SELECT id, COALESCE(resposta_aprovada,false), status INTO v_id, v_aprovada, v_status
    FROM sugestoes WHERE numero = p_numero;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  -- regra 3: não sobrescreve resposta já aprovada (e possivelmente já enviada ao cliente)
  IF v_aprovada THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_aprovada'); END IF;
  -- regra 4: chamado terminal não recebe rascunho novo
  IF LOWER(TRIM(COALESCE(v_status,''))) IN ('concluida','concluido','cancelada','cancelado','recusada','duplicada','arquivada','resolvida','implementado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_terminal', 'status', v_status); END IF;

  UPDATE sugestoes SET
    resposta = p_texto,
    resposta_aprovada = false,               -- regra 1 (imutável)
    resposta_aprovada_por = NULL, resposta_aprovada_em = NULL,
    resposta_origem = 'ia',                  -- regra 2
    resposta_redigida_por = NULL,            -- regra 2
    status = CASE WHEN status IN ('nova','em_analise') THEN 'em_desenvolvimento' ELSE status END,
    updated_at = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'numero', p_numero, 'resposta_aprovada', false,
    'origem', 'ia', 'modelo', COALESCE(NULLIF(btrim(p_modelo),''),'claude'), 'aguardando_aprovacao', true);
END $function$;

-- regra 5: só service_role. Não exposta ao app (authenticated/anon) nem ao público.
REVOKE ALL ON FUNCTION public.fn_sugestao_rascunho_ia(int, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sugestao_rascunho_ia(int, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sugestao_rascunho_ia(int, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_rascunho_ia(int, text, text) TO service_role;
