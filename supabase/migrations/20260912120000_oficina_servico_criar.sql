-- ============================================================
-- Oficina Onda 1 · 3.2 — fn_oficina_servico_criar: "cadastrar serviço na hora" com dedup embutido
-- ============================================================
-- A tela de diagnóstico passa a ter "cadastrar na hora" quando o serviço não está no catálogo (hoje só
-- 3 serviços cobrem a rotina). Guard do CEO: o catálogo não pode nascer sujo — o mesmo item hoje aparece
-- como "filtro óleo / filtro oleo / filtro de óleo". Por isso a criação DEDUPLICA por nome NORMALIZADO
-- (unaccent + minúsculas + espaço simples): se já existe algo com o mesmo nome normalizado, devolve o
-- EXISTENTE (ja_existia=true) em vez de criar duplicata. Não migra histórico (RD-30/RD-61) — o catálogo
-- cresce do uso novo.

CREATE OR REPLACE FUNCTION public.fn_oficina_servico_criar(p_company_id uuid, p_nome text, p_tempo_padrao_h numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_nome text := btrim(coalesce(p_nome,'')); v_norm text; v_id uuid; v_ex_nome text; v_tp numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_vazio'); END IF;

  v_norm := unaccent(lower(btrim(regexp_replace(v_nome, '\s+', ' ', 'g'))));

  -- dedup: já existe serviço ativo com o mesmo nome normalizado? devolve o existente (catálogo limpo)
  SELECT id, nome, tempo_padrao_h INTO v_id, v_ex_nome, v_tp
    FROM erp_oficina_servicos
   WHERE company_id = p_company_id AND COALESCE(ativo, true) AND NOT COALESCE(excluida, false)
     AND unaccent(lower(btrim(regexp_replace(coalesce(nome,''), '\s+', ' ', 'g')))) = v_norm
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_existia', true, 'id', v_id, 'nome', v_ex_nome, 'tempo_padrao_h', v_tp);
  END IF;

  INSERT INTO erp_oficina_servicos (company_id, nome, tempo_padrao_h, ativo, criado_por)
  VALUES (p_company_id, v_nome, p_tempo_padrao_h, true, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'ja_existia', false, 'id', v_id, 'nome', v_nome, 'tempo_padrao_h', p_tempo_padrao_h);
END $function$;
