-- ============================================================
-- Auto-vinculo agenda->patio: FALLBACK por cliente_id (chamados 1 e 2 · decisao do CEO 09/09)
--
-- O #1317 vincula o agendamento a OS na recepcao casando por PLACA. Mas a placa e OPCIONAL no
-- +Agendar (regra da oficina generica: torneria/usinagem nao tem veiculo), e na pratica quase
-- nunca vem: dos 16 agendamentos abertos do KGF, so 3 tinham placa. 5 tinham cliente_id sem placa,
-- 8 so o nome digitado. O casar-por-placa alcancava 3/16.
--
-- Fallback (decisao do CEO — (a)): quando NAO casou por placa, tenta por cliente_id, com o MESMO
-- guard anti-mislink ("EXATAMENTE 1" agendamento aberto do mesmo cliente, data <= hoje). Dobra o
-- alcance para 8/16. Os 8 so-nome (sem placa e sem cliente_id) nao casam sozinhos — saem na mao
-- pelo editar/cancelar (#1319). cliente_nome e texto livre e casa errado com folga — NAO entra no
-- match (RD-38: so casa no que e chave confiavel).
--
-- Ordem do match: PLACA primeiro (mais especifico), CLIENTE_ID so se a placa nao resolveu.
-- O retorno ganha 'vinculo_por' ('placa'|'cliente'|null) para a tela e a auditoria saberem como casou.
-- RD-26: reusa fn_agendamento_vincular_os nos dois caminhos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_oficina_recepcao_criar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_os_id uuid; v_placa text; v_ag uuid; v_ag_count int;
  v_cli uuid; v_por text := NULL;
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
      v_por := 'placa';
    ELSE
      v_ag := NULL;   -- 0 ou >1 candidatos → não arrisca
    END IF;
  ELSE
    v_ag := NULL;
  END IF;

  -- Fallback por cliente_id (decisao do CEO — (a)): so quando a placa NAO resolveu. Mesmo guard
  -- "EXATAMENTE 1" agendamento aberto do mesmo cliente cadastrado, data <= hoje. cliente_nome
  -- (texto livre) NAO entra — casa errado. Alcanca os agendamentos com cliente do cadastro e sem placa.
  IF v_ag IS NULL THEN
    v_cli := nullif(p_dados->>'cliente_id','')::uuid;
    IF v_cli IS NOT NULL THEN
      SELECT count(*), (array_agg(a.id))[1] INTO v_ag_count, v_ag
      FROM erp_agendamento a
      WHERE a.company_id = p_company_id AND a.os_id IS NULL
        AND a.status IN ('agendado','confirmado') AND a.data <= CURRENT_DATE
        AND a.cliente_id = v_cli;
      IF v_ag_count = 1 THEN
        PERFORM fn_agendamento_vincular_os(v_ag, v_os_id);   -- RD-26: mesmo caminho de vinculo
        v_por := 'cliente';
      ELSE
        v_ag := NULL;   -- 0 ou >1 → não arrisca (frota do mesmo cliente etc.)
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'os_id', v_os_id, 'numero', v_res->>'numero',
    'agendamento_vinculado', v_ag, 'vinculo_por', v_por);
END $function$;
