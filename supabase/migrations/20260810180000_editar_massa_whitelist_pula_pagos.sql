-- Jordana #6: blinda o motor de edição em massa (RD-57) — rejeita campos proibidos e PULA títulos
-- baixados quando o campo afeta a baixa (valor/vencimento) (RD-55). O allow efetivo continua sendo a
-- whitelist do fn_*_editar_completo (que já ignora id/company_id/valor_pago/status); aqui negamos
-- explicitamente esses + pulamos pagos. Novo campo de retorno: pulados_pago.
create or replace function public.fn_pagar_editar_massa(p_ids uuid[], p_campos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
DECLARE v_id uuid; v_res jsonb; v_ok int := 0; v_pulados int := 0; v_erros jsonb := '[]'::jsonb;
  v_sens boolean; v_baixado boolean;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_ids'); END IF;
  IF p_campos ?| ARRAY['id','company_id','valor_pago','status','conciliado','movimento_banco_id','baixado','created_at','updated_at','parcela_grupo_id'] THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'campo_nao_permitido'); END IF;
  v_sens := (p_campos ? 'valor') OR (p_campos ? 'data_vencimento');
  FOREACH v_id IN ARRAY p_ids LOOP
    IF v_sens THEN
      SELECT (status = 'pago' OR conciliado OR movimento_banco_id IS NOT NULL) INTO v_baixado FROM erp_pagar WHERE id = v_id;
      IF COALESCE(v_baixado, false) THEN v_pulados := v_pulados + 1; CONTINUE; END IF;
    END IF;
    v_res := public.fn_pagar_editar_completo(v_id, p_campos);
    IF (v_res->>'sucesso')::boolean IS TRUE THEN v_ok := v_ok + 1;
    ELSE v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', v_res->>'erro'); END IF;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'alterados', v_ok, 'pulados_pago', v_pulados,
    'falhas', jsonb_array_length(v_erros), 'detalhe_falhas', v_erros);
END; $function$;

create or replace function public.fn_receber_editar_massa(p_ids uuid[], p_campos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
DECLARE v_id uuid; v_res jsonb; v_ok int := 0; v_pulados int := 0; v_erros jsonb := '[]'::jsonb;
  v_sens boolean; v_baixado boolean;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_ids'); END IF;
  IF p_campos ?| ARRAY['id','company_id','valor_pago','status','conciliado','movimento_banco_id','baixado','created_at','updated_at','parcela_grupo_id'] THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'campo_nao_permitido'); END IF;
  v_sens := (p_campos ? 'valor') OR (p_campos ? 'data_vencimento');
  FOREACH v_id IN ARRAY p_ids LOOP
    IF v_sens THEN
      SELECT (status = 'pago' OR conciliado OR movimento_banco_id IS NOT NULL) INTO v_baixado FROM erp_receber WHERE id = v_id;
      IF COALESCE(v_baixado, false) THEN v_pulados := v_pulados + 1; CONTINUE; END IF;
    END IF;
    v_res := public.fn_receber_editar_completo(v_id, p_campos);
    IF (v_res->>'sucesso')::boolean IS TRUE THEN v_ok := v_ok + 1;
    ELSE v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', v_res->>'erro'); END IF;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'alterados', v_ok, 'pulados_pago', v_pulados,
    'falhas', jsonb_array_length(v_erros), 'detalhe_falhas', v_erros);
END; $function$;
