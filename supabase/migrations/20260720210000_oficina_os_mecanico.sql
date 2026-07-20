-- BLOCO 2.1 · Designar mecânico: RESPONSÁVEL (espelha erp_os.tecnico_id) + N AUXILIARES com trilha de
-- entrada/saída. Aditivo (RD-55): erp_os.tecnico_* preservado. Seletor limpo: dedup por identidade,
-- Title Case, sem e-mail, sem "TESTE", e STAFF DA PS (system_role IS NOT NULL) NUNCA é mecânico (regra geral).
-- Comissão multi-mecânico = ESTRUTURA (preview proporcional às horas apontadas); zera sem apontamento (não trava).
-- Provado (KGF, autenticado): seletor=[Gean|Joao], OS-0007=Gean(responsável)+auxiliar, comissão zerada c/ aviso.
-- Reverter: DROP das funções + DROP TABLE erp_os_mecanico (erp_os.tecnico_* nunca foi tocado destrutivamente).

CREATE TABLE IF NOT EXISTS public.erp_os_mecanico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL REFERENCES public.erp_os(id) ON DELETE CASCADE,
  mecanico_nome text NOT NULL,
  mecanico_id uuid,
  papel text NOT NULL CHECK (papel IN ('responsavel','auxiliar')),
  entrou_em timestamptz NOT NULL DEFAULT now(),
  saiu_em timestamptz,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_os_mecanico_os ON public.erp_os_mecanico(os_id, ativo);
ALTER TABLE public.erp_os_mecanico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS os_mecanico_sel ON public.erp_os_mecanico;
CREATE POLICY os_mecanico_sel ON public.erp_os_mecanico FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Lista LIMPA de mecânicos p/ o seletor (dedup identidade + Title Case + sem e-mail/TESTE/staff PS).
CREATE OR REPLACE FUNCTION public.fn_oficina_mecanicos(p_company_id uuid)
RETURNS TABLE(nome text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  RETURN QUERY
  WITH crus AS (
    SELECT o.tecnico_nome AS nm, o.tecnico_id AS uid FROM erp_os o
      WHERE o.company_id=p_company_id AND coalesce(o.excluida,false)=false AND o.tecnico_nome IS NOT NULL
    UNION ALL
    SELECT m.mecanico_nome, m.mecanico_id FROM erp_os_mecanico m
      WHERE m.company_id=p_company_id AND m.ativo AND m.mecanico_nome IS NOT NULL
  )
  SELECT DISTINCT initcap(btrim(c.nm))
  FROM crus c
  WHERE btrim(c.nm) <> '' AND c.nm NOT ILIKE '%@%' AND upper(btrim(c.nm)) <> 'TESTE'
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=c.uid AND u.system_role IS NOT NULL)
  ORDER BY 1;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_mecanicos(uuid) TO authenticated;

-- Mecânicos de uma OS (responsável + auxiliares, ativos e histórico).
CREATE OR REPLACE FUNCTION public.fn_os_mecanicos_listar(p_os_id uuid)
RETURNS TABLE(id uuid, mecanico_nome text, mecanico_id uuid, papel text, entrou_em timestamptz, saiu_em timestamptz, ativo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_comp uuid;
BEGIN
  SELECT o.company_id INTO v_comp FROM erp_os o WHERE o.id=p_os_id;
  IF v_comp IS NULL OR NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta OS';
  END IF;
  RETURN QUERY
  SELECT m.id, m.mecanico_nome, m.mecanico_id, m.papel, m.entrou_em, m.saiu_em, m.ativo
  FROM erp_os_mecanico m WHERE m.os_id=p_os_id
  ORDER BY (m.papel='responsavel') DESC, m.ativo DESC, m.entrou_em;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_os_mecanicos_listar(uuid) TO authenticated;

-- Designar/trocar RESPONSÁVEL (espelha erp_os.tecnico_*, trilha da troca).
CREATE OR REPLACE FUNCTION public.fn_os_designar_responsavel(p_os_id uuid, p_nome text, p_mecanico_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_os erp_os; v_nome text; v_ant text; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id=p_os_id;
  IF v_os IS NULL OR NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;
  v_nome := initcap(btrim(coalesce(p_nome,'')));
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome do mecânico.'); END IF;

  SELECT mecanico_nome INTO v_ant FROM erp_os_mecanico
    WHERE os_id=p_os_id AND papel='responsavel' AND ativo LIMIT 1;
  IF v_ant IS NOT NULL AND initcap(btrim(v_ant)) = v_nome THEN
    RETURN jsonb_build_object('ok', true, 'nome', v_nome, 'inalterado', true);
  END IF;
  UPDATE erp_os_mecanico SET ativo=false, saiu_em=now()
    WHERE os_id=p_os_id AND papel='responsavel' AND ativo;
  INSERT INTO erp_os_mecanico (company_id, os_id, mecanico_nome, mecanico_id, papel, criado_por)
    VALUES (v_os.company_id, p_os_id, v_nome, p_mecanico_id, 'responsavel', v_uid);
  UPDATE erp_os SET tecnico_nome=v_nome, tecnico_id=p_mecanico_id, updated_at=now() WHERE id=p_os_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_os.company_id, v_uid, 'erp_os', v_os.numero,
      CASE WHEN v_ant IS NULL THEN 'DESIGNOU_RESPONSAVEL' ELSE 'TROCOU_RESPONSAVEL' END,
      jsonb_build_object('responsavel', v_ant), jsonb_build_object('responsavel', v_nome));
  RETURN jsonb_build_object('ok', true, 'nome', v_nome, 'anterior', v_ant);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_os_designar_responsavel(uuid, text, uuid) TO authenticated;

-- Adicionar AUXILIAR (entrada com trilha).
CREATE OR REPLACE FUNCTION public.fn_os_add_auxiliar(p_os_id uuid, p_nome text, p_mecanico_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_os erp_os; v_nome text; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id=p_os_id;
  IF v_os IS NULL OR NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;
  v_nome := initcap(btrim(coalesce(p_nome,'')));
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome do auxiliar.'); END IF;
  IF EXISTS (SELECT 1 FROM erp_os_mecanico WHERE os_id=p_os_id AND ativo AND initcap(btrim(mecanico_nome))=v_nome) THEN
    RETURN jsonb_build_object('ok', true, 'nome', v_nome, 'inalterado', true);
  END IF;
  INSERT INTO erp_os_mecanico (company_id, os_id, mecanico_nome, mecanico_id, papel, criado_por)
    VALUES (v_os.company_id, p_os_id, v_nome, p_mecanico_id, 'auxiliar', v_uid);
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (v_os.company_id, v_uid, 'erp_os', v_os.numero, 'ADD_AUXILIAR', jsonb_build_object('auxiliar', v_nome));
  RETURN jsonb_build_object('ok', true, 'nome', v_nome);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_os_add_auxiliar(uuid, text, uuid) TO authenticated;

-- Remover mecânico (soft: saída com trilha). Se for o responsável, limpa erp_os.tecnico_*.
CREATE OR REPLACE FUNCTION public.fn_os_remover_mecanico(p_os_mecanico_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row erp_os_mecanico; v_num text; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_row FROM erp_os_mecanico WHERE id=p_os_mecanico_id;
  IF v_row IS NULL OR NOT (v_row.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso');
  END IF;
  UPDATE erp_os_mecanico SET ativo=false, saiu_em=now() WHERE id=p_os_mecanico_id;
  IF v_row.papel='responsavel' THEN
    UPDATE erp_os SET tecnico_nome=NULL, tecnico_id=NULL, updated_at=now() WHERE id=v_row.os_id;
  END IF;
  SELECT numero INTO v_num FROM erp_os WHERE id=v_row.os_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior)
    VALUES (v_row.company_id, v_uid, 'erp_os', v_num, 'REMOVEU_MECANICO',
      jsonb_build_object('papel', v_row.papel, 'mecanico', v_row.mecanico_nome));
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_os_remover_mecanico(uuid) TO authenticated;

-- Comissão multi-mecânico (ESTRUTURA · não trava o resto). Preview proporcional às horas apontadas.
CREATE OR REPLACE FUNCTION public.fn_os_comissao_preview(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_os erp_os; v_total_h numeric; v_base numeric; v_itens jsonb;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id=p_os_id;
  IF v_os IS NULL OR NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;
  v_base := coalesce(v_os.valor_servico, 0);  -- base da comissão = mão de obra (serviço)
  SELECT coalesce(sum(tempo_real_h),0) INTO v_total_h FROM erp_os_apontamento WHERE os_id=p_os_id;
  IF v_total_h <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'modo', 'proporcional_horas', 'total_horas', 0,
      'itens', '[]'::jsonb, 'aviso', 'Sem apontamento ainda — comissão fica zerada até Iniciar/Concluir.');
  END IF;
  SELECT jsonb_agg(jsonb_build_object('mecanico', mecanico_nome, 'horas', h,
           'pct', round(100*h/v_total_h,1), 'valor', round(v_base*h/v_total_h,2)) ORDER BY h DESC)
    INTO v_itens
  FROM (SELECT coalesce(mecanico_nome,'(sem nome)') mecanico_nome, sum(tempo_real_h) h
        FROM erp_os_apontamento WHERE os_id=p_os_id GROUP BY 1) s;
  RETURN jsonb_build_object('ok', true, 'modo', 'proporcional_horas', 'total_horas', v_total_h,
    'base', v_base, 'itens', coalesce(v_itens,'[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION public.fn_os_comissao_preview(uuid) TO authenticated;
