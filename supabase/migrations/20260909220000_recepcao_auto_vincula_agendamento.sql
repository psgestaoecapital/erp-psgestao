-- ============================================================
-- Agenda -> pátio: o veículo agendado não aparecia nos recebidos, e os já atendidos ficavam
-- eternamente "agendados". (Chamados 1 e 2 do KGF — o mesmo bug.)
--
-- Diagnóstico no dado (RD-38): os 25 agendamentos do KGF têm os_id NULL — nenhum virou OS pelo
-- caminho da agenda. O fio do "Apontar chegada" (pátio -> recepção com ?ag=, e a recepção chama
-- fn_agendamento_vincular_os no fim) JÁ está ligado (OFIC-A #10). fn_agenda_patio_hoje já mostra
-- atrasados (data <= CURRENT_DATE). O buraco que sobra: quando o operador cria a OS DIRETO na
-- recepção (busca por placa, sem passar pelo "Apontar chegada"), o agendamento não é consumido.
--
-- Correção (decisão do CEO): casar por PLACA. Ao criar a OS pela recepção, se houver EXATAMENTE 1
-- agendamento aberto (os_id nulo, agendado/confirmado, data <= hoje) com a mesma placa, vincula
-- automático — reusando fn_agendamento_vincular_os (RD-26). Guard "exatamente 1" evita mislink.
-- Idempotente com o caminho explícito do "Apontar chegada" (vincular_os já é idempotente).
--
-- Os agendamentos antigos já atendidos (sem OS) NÃO são tocados aqui — saída é o editar/cancelar
-- (chamado 3) ou limpeza pontual autorizada.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_oficina_recepcao_criar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_os_id uuid; v_placa text; v_ag uuid; v_ag_count int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  v_res := public.fn_os_criar(
    p_company_id,
    coalesce(nullif(btrim(p_dados->>'queixa'), ''), 'Recepção'),
    nullif(p_dados->>'cliente_id', '')::uuid,
    (p_dados->>'cliente_nome')::varchar, (p_dados->>'cliente_cnpj')::varchar,
    NULL::varchar, p_dados->>'queixa',
    NULL::uuid, NULL::varchar, coalesce(nullif(p_dados->>'prioridade', ''), 'normal')::varchar,
    (p_dados->>'placa')::varchar, (p_dados->>'modelo')::varchar);
  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_os_id := (v_res->>'os_id')::uuid;
  UPDATE erp_os SET
    marca = nullif(p_dados->>'marca', ''), ano = nullif(p_dados->>'ano', '')::int,
    km = nullif(p_dados->>'km', '')::int, chassi = nullif(p_dados->>'chassi', ''), updated_at = now()
  WHERE id = v_os_id AND company_id = p_company_id;
  INSERT INTO erp_os_recepcao (
    company_id, os_id, km_entrada, combustivel, checklist, avarias, objetos_veiculo, observacoes, fotos,
    peca_descricao, peca_material, peca_medidas, peca_quantidade, criado_por)
  VALUES (
    p_company_id, v_os_id, nullif(p_dados->>'km','')::int, nullif(p_dados->>'combustivel',''),
    coalesce(p_dados->'checklist', '{}'::jsonb), nullif(p_dados->>'avarias',''), nullif(p_dados->>'objetos',''),
    nullif(p_dados->>'observacoes',''), coalesce(p_dados->'fotos', '[]'::jsonb),
    nullif(p_dados->>'peca_descricao',''), nullif(p_dados->>'peca_material',''),
    nullif(p_dados->>'peca_medidas',''), nullif(p_dados->>'peca_quantidade','')::numeric, auth.uid());

  -- F2 (RD-52): as fotos da recepção também vão pra fonte única erp_os_registro_foto (etapa='recepcao'),
  -- pra aparecerem no Histórico Fotográfico da OS. Idempotente por (os_id, foto_path).
  INSERT INTO erp_os_registro_foto (company_id, os_id, foto_path, descricao, etapa, created_at)
  SELECT p_company_id, v_os_id, (f->>'path'), COALESCE(NULLIF(f->>'legenda',''), 'Foto da recepção'), 'recepcao', now()
  FROM jsonb_array_elements(COALESCE(p_dados->'fotos','[]'::jsonb)) f
  WHERE (f->>'path') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM erp_os_registro_foto g WHERE g.os_id = v_os_id AND g.foto_path = (f->>'path'));

  -- Auto-vínculo por placa (chamados 1 e 2): cobre a recepção direta, sem passar pelo "Apontar
  -- chegada". Só vincula se houver EXATAMENTE 1 agendamento aberto desta placa (anti-mislink).
  v_placa := upper(regexp_replace(coalesce(p_dados->>'placa',''), '[^A-Za-z0-9]', '', 'g'));
  IF v_placa <> '' THEN
    SELECT count(*), (array_agg(a.id))[1] INTO v_ag_count, v_ag
    FROM erp_agendamento a
    WHERE a.company_id = p_company_id AND a.os_id IS NULL
      AND a.status IN ('agendado','confirmado') AND a.data <= CURRENT_DATE
      AND upper(regexp_replace(coalesce(a.dados->>'placa',''), '[^A-Za-z0-9]', '', 'g')) = v_placa;
    IF v_ag_count = 1 THEN
      PERFORM fn_agendamento_vincular_os(v_ag, v_os_id);   -- RD-26: reusa (os_id + status em_atendimento, idempotente)
    ELSE
      v_ag := NULL;   -- 0 ou >1 candidatos → não arrisca
    END IF;
  ELSE
    v_ag := NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'os_id', v_os_id, 'numero', v_res->>'numero',
    'agendamento_vinculado', v_ag);
END $function$;
