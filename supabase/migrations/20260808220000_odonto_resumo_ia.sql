-- SPEC IA-1.1 · Odonto — Resumo Inteligente do Paciente (Onda IA-1). RD-56/RD-41/RD-42/LGPD.
-- Cache do resumo (não chama a IA a cada load) + RPC de CONTEXTO read-only (agrega os dados que a IA lê).
-- A chamada ao modelo é na rota Next /api/odonto/resumo-paciente (padrão dos endpoints de IA do app).

CREATE TABLE IF NOT EXISTS public.erp_odonto_paciente_resumo_ia (
  paciente_id uuid PRIMARY KEY REFERENCES public.erp_odonto_paciente(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  resumo text,
  risco text,          -- 'baixo' | 'medio' | 'alto'
  motivo text,
  sugestao text,
  modelo text,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  gerado_por uuid DEFAULT auth.uid()
);
ALTER TABLE public.erp_odonto_paciente_resumo_ia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_odonto_resumo_ia_sel ON public.erp_odonto_paciente_resumo_ia;
CREATE POLICY pol_odonto_resumo_ia_sel ON public.erp_odonto_paciente_resumo_ia FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- CONTEXTO read-only p/ a IA: agrega idade, alertas (anamnese+alergias), plano+progresso, financeiro,
-- agenda (última consulta + faltas 6m), última evolução. SECURITY DEFINER + guard de empresa (Pilar 2).
CREATE OR REPLACE FUNCTION public.fn_odonto_paciente_contexto_ia(p_company_id uuid, p_paciente_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_pac record; v_idade int; v_alertas jsonb; v_plano record;
  v_tot int; v_conc int; v_deb record; v_ultima date; v_faltas int; v_totag int; v_evo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  SELECT nome, data_nascimento, sexo, alergias INTO v_pac
    FROM erp_odonto_paciente WHERE id = p_paciente_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'paciente não encontrado'); END IF;
  v_idade := CASE WHEN v_pac.data_nascimento IS NOT NULL THEN date_part('year', age(v_pac.data_nascimento))::int END;

  -- alertas da anamnese mais recente (resposta bate com alerta_se) + alergia do cadastro
  SELECT coalesce(jsonb_agg(DISTINCT pg->>'alerta_label') FILTER (
           WHERE (pg->>'alerta_se') IS NOT NULL AND coalesce(pg->>'alerta_label','') <> ''
             AND lower(coalesce(ult.respostas->>(pg->>'id'),'')) = lower(pg->>'alerta_se')), '[]'::jsonb)
    INTO v_alertas
  FROM (SELECT a.respostas, m.perguntas FROM erp_odonto_anamnese a
        JOIN erp_odonto_anamnese_modelo m ON m.id = a.modelo_id
        WHERE a.company_id = p_company_id AND a.paciente_id = p_paciente_id
        ORDER BY a.created_at DESC LIMIT 1) ult,
       LATERAL jsonb_array_elements(ult.perguntas) pg;

  -- plano ativo (mais recente) + progresso
  SELECT id, titulo, status, valor_total INTO v_plano
    FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id AND paciente_id = p_paciente_id
    ORDER BY created_at DESC LIMIT 1;
  IF v_plano.id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE status <> 'cancelado'),
           count(*) FILTER (WHERE status = 'concluido')
      INTO v_tot, v_conc FROM erp_odonto_plano_item WHERE plano_id = v_plano.id AND company_id = p_company_id;
  END IF;

  -- financeiro (view agregada)
  SELECT total_recebido, total_aberto INTO v_deb
    FROM v_odonto_debitos_paciente WHERE paciente_id = p_paciente_id AND company_id = p_company_id;

  -- agenda: última consulta, faltas nos últimos 6 meses, total
  SELECT max(data) FILTER (WHERE data <= current_date),
         count(*) FILTER (WHERE status = 'faltou' AND data >= current_date - INTERVAL '6 months'),
         count(*)
    INTO v_ultima, v_faltas, v_totag
    FROM erp_odonto_agendamento WHERE company_id = p_company_id AND paciente_id = p_paciente_id;

  -- última evolução (texto)
  SELECT texto INTO v_evo FROM erp_odonto_prontuario
    WHERE company_id = p_company_id AND paciente_id = p_paciente_id
    ORDER BY data_atendimento DESC, created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'idade', v_idade,
    'sexo', v_pac.sexo,
    'alergias', v_pac.alergias,
    'alertas', v_alertas,
    'plano', CASE WHEN v_plano.id IS NOT NULL THEN jsonb_build_object(
        'titulo', v_plano.titulo, 'status', v_plano.status, 'valor_total', v_plano.valor_total,
        'itens_total', coalesce(v_tot,0), 'itens_concluidos', coalesce(v_conc,0),
        'progresso_pct', CASE WHEN coalesce(v_tot,0) > 0 THEN round(100.0 * coalesce(v_conc,0) / v_tot)::int ELSE 0 END) END,
    'financeiro', jsonb_build_object('total_aberto', coalesce(v_deb.total_aberto,0), 'total_recebido', coalesce(v_deb.total_recebido,0)),
    'agenda', jsonb_build_object('ultima_consulta', v_ultima, 'faltas_6m', coalesce(v_faltas,0), 'total_agendamentos', coalesce(v_totag,0)),
    'ultima_evolucao', left(coalesce(v_evo,''), 500)
  );
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_paciente_contexto_ia(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_paciente_contexto_ia(uuid,uuid) TO authenticated;

-- upsert do cache do resumo (a rota chama após gerar)
CREATE OR REPLACE FUNCTION public.fn_odonto_resumo_ia_salvar(p_company_id uuid, p_paciente_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_paciente WHERE id = p_paciente_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'paciente não pertence à empresa'); END IF;
  INSERT INTO erp_odonto_paciente_resumo_ia (paciente_id, company_id, resumo, risco, motivo, sugestao, modelo, gerado_em, gerado_por)
  VALUES (p_paciente_id, p_company_id, p_dados->>'resumo', p_dados->>'risco', p_dados->>'motivo', p_dados->>'sugestao', p_dados->>'modelo', now(), auth.uid())
  ON CONFLICT (paciente_id) DO UPDATE SET
    resumo = EXCLUDED.resumo, risco = EXCLUDED.risco, motivo = EXCLUDED.motivo,
    sugestao = EXCLUDED.sugestao, modelo = EXCLUDED.modelo, gerado_em = now(), gerado_por = auth.uid();
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_resumo_ia_salvar(uuid,uuid,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_resumo_ia_salvar(uuid,uuid,jsonb) TO authenticated;
