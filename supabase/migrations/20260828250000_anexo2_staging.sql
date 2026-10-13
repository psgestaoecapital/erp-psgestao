-- SPEC ANEXO-2 · anexar ANTES de salvar. O problema é de MOMENTO: numa proposta nova ainda não há id.
-- Solução: staging no cliente (upload real p/ crm-anexos/{company}/tmp/{sessao}/), metadados no estado da
-- tela, e persistência em LOTE no CRIAR (move tmp → proposta/{id}/ + fn_crm_anexo_adicionar). RD-52: sem
-- 2º componente; sem rascunho fantasma no banco. Base ANEXO-1 (#1166) auditada em produção (RD-38).

-- ── ENTREGA 1 · persistir o lote de uma vez (uma chamada, não N) ───────────────────────────────────
-- Robustez: um anexo que falhar NÃO derruba os outros nem a proposta. Checa o ok interno de cada
-- fn_crm_anexo_adicionar e devolve a lista de erros — a tela avisa quais não subiram.
CREATE OR REPLACE FUNCTION public.fn_crm_anexo_confirmar_lote(
  p_company_id uuid, p_vinculo_tipo text, p_vinculo_id uuid, p_anexos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a jsonb; v_res jsonb; v_n int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_vinculo_tipo NOT IN ('proposta','oportunidade','visita') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vinculo_invalido'); END IF;

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_anexos,'[]'::jsonb))
  LOOP
    BEGIN
      v_res := fn_crm_anexo_adicionar(
        p_company_id, p_vinculo_tipo, p_vinculo_id,
        COALESCE(NULLIF(a->>'tipo',''),'arquivo'), a->>'categoria', a->>'descricao',
        a->>'nome', a->>'path', a->>'mime',
        NULLIF(a->>'tamanho','')::bigint, a->>'url');
      IF COALESCE((v_res->>'ok')::boolean, false) THEN
        v_n := v_n + 1;
      ELSE
        v_erros := v_erros || jsonb_build_object('nome', a->>'nome', 'erro', COALESCE(v_res->>'erro','falhou'));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros || jsonb_build_object('nome', a->>'nome', 'erro', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'confirmados', v_n, 'erros', v_erros);
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_anexo_confirmar_lote(uuid,text,uuid,jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_anexo_confirmar_lote(uuid,text,uuid,jsonb) TO authenticated, service_role;

-- ── ENTREGA 2 · limpeza dos temporários (só /tmp/, nunca anexo confirmado) ─────────────────────────
-- Apaga objetos em crm-anexos cujo caminho contém '/tmp/' e mais velhos que p_horas. Só service_role
-- (a cron roda como service_role). NÃO agendar sem autorização do CEO (cron.schedule exige aprovação).
CREATE OR REPLACE FUNCTION public.fn_crm_anexo_limpar_temporarios(p_horas int DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  WITH del AS (
    DELETE FROM storage.objects
     WHERE bucket_id = 'crm-anexos'
       AND position('/tmp/' in name) > 0                     -- só a área de espera
       AND created_at < now() - make_interval(hours => GREATEST(COALESCE(p_horas,24), 1))
    RETURNING 1)
  SELECT count(*) INTO v_n FROM del;
  RETURN jsonb_build_object('ok', true, 'apagados', v_n, 'horas', GREATEST(COALESCE(p_horas,24), 1));
END $function$;
REVOKE ALL ON FUNCTION public.fn_crm_anexo_limpar_temporarios(int) FROM anon, PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crm_anexo_limpar_temporarios(int) TO service_role;

-- CRON SUGERIDO (⬜ NÃO agendar sem OK do CEO — RD): diário 03h
--   SELECT cron.schedule('crm_anexo_limpar_tmp', '0 3 * * *',
--     $$SELECT public.fn_crm_anexo_limpar_temporarios(24)$$);
