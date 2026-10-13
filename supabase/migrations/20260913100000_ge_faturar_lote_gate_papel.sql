-- ============================================================
-- Onda 0 · quem pode FATURAR — gate por papel no fn_os_faturar_lote (decisão (a) do CEO)
-- ============================================================
-- Faturar gera título financeiro: quem não pode NÃO deve conseguir nem por URL direta nem chamando a RPC
-- (rota/menu escondem, não impedem). Gate NO BACKEND.
--   Whitelist: is_admin() OU papel_gestao = 'CLIENT_OWNER'. Bloqueia OFICINA_* (o Gean é OFICINA_DONO),
--   operador e viewer. Recusa CLARA (RD-51), não erro genérico.
--
-- Escopo cirúrgico (cuidado do CEO): gateia SÓ o fn_os_faturar_lote (novo, chamado só pela fila da GE).
-- NÃO toca fn_os_faturar (compartilhada com /dashboard/os e commerce/otc) — a fila roteia o botão
-- por-OS pelo lote (1 item) no front, então a fila inteira fica protegida sem mexer na compartilhada.
-- O gate vem ANTES do check de lista vazia (assim um bloqueado nunca chega a iterar).

CREATE OR REPLACE FUNCTION public.fn_os_faturar_lote(p_company_id uuid, p_os_ids uuid[], p_conta_bancaria_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_os record; v_r jsonb; v_fat int := 0; v_val numeric := 0;
        v_ids jsonb := '[]'::jsonb; v_puladas jsonb := '[]'::jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- GATE por papel (decisão (a)): só dono/admin fatura. Recusa clara p/ o resto (RD-51).
  IF NOT (is_admin() OR public.fn_oficina_papel(p_company_id) = 'CLIENT_OWNER') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_faturar',
      'mensagem', 'Você não tem permissão para faturar. Fale com o financeiro.'); END IF;

  IF p_os_ids IS NULL OR array_length(p_os_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lista_vazia'); END IF;

  FOREACH v_id IN ARRAY p_os_ids LOOP
    SELECT o.id, o.company_id, o.numero, COALESCE(o.total,0) AS total, o.cliente_id,
           COALESCE(o.titulos_gerados,false) AS tg, o.lancamento_id
      INTO v_os FROM erp_os o WHERE o.id = v_id;
    IF v_os.id IS NULL OR v_os.company_id <> p_company_id THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'motivo', 'fora_da_empresa'); CONTINUE; END IF;
    IF v_os.tg OR v_os.lancamento_id IS NOT NULL THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', 'ja_faturada'); CONTINUE; END IF;
    IF v_os.total <= 0 THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', 'sem_valor'); CONTINUE; END IF;
    IF v_os.cliente_id IS NULL THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', 'sem_cliente'); CONTINUE; END IF;
    BEGIN
      v_r := public.fn_os_faturar(v_id, p_conta_bancaria_id);
      IF COALESCE((v_r->>'ok')::boolean, false) THEN
        v_fat := v_fat + 1; v_val := v_val + v_os.total; v_ids := v_ids || to_jsonb(v_r->>'receber_id');
      ELSE
        v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', COALESCE(v_r->>'erro', 'falhou'));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', 'erro: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'faturadas', v_fat, 'valor_faturado', v_val,
    'receber_ids', v_ids, 'puladas', v_puladas, 'qtd_puladas', jsonb_array_length(v_puladas));
END $function$;
