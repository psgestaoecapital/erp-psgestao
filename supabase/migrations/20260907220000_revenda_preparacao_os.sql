-- ============================================================
-- ONDA 9 · Preparacao do veiculo usando a OS da Oficina (D12: reusar erp_os)
-- erp_os ja e orientada a veiculo (163 OS, 152 com placa). Falta o vinculo REAL
-- (FK), nao casar por string. O custo da OS volta para o chassi certo [->GE via veic_custo].
-- Nao mexe no fluxo de OS da Oficina: erp_os so ganha uma coluna opcional.
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 · o vinculo real: OS de preparacao -> veiculo do estoque
-- ------------------------------------------------------------
ALTER TABLE public.erp_os
  ADD COLUMN IF NOT EXISTS veic_veiculo_id uuid
  REFERENCES public.veic_veiculo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_erp_os_veic_veiculo
  ON public.erp_os (veic_veiculo_id) WHERE veic_veiculo_id IS NOT NULL;

COMMENT ON COLUMN public.erp_os.veic_veiculo_id IS
  'Veiculo do estoque de revenda que esta OS prepara. NULL = OS comum de oficina.';

-- ------------------------------------------------------------
-- 2.2 · de onde veio o custo: da OS de preparacao e/ou da vistoria
-- ------------------------------------------------------------
ALTER TABLE public.veic_custo
  ADD COLUMN IF NOT EXISTS os_id uuid REFERENCES public.erp_os(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS insp_resposta_id uuid REFERENCES public.insp_resposta(id) ON DELETE SET NULL;

-- uma OS gera no maximo um custo (fechar duas vezes nao duplica lancamento)
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_custo_os
  ON public.veic_custo (os_id) WHERE os_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3.1 · abre a OS de preparacao a partir do veiculo
--       copia placa/marca/modelo/ano/km/chassi do veic_veiculo (nao pede de novo)
--       se houver vistoria concluida, pre-carrega os itens em reparo/troca na descricao
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_preparacao_abrir(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_vec record; v_numero text; v_os_id uuid;
  v_desc text; v_itens_txt text; v_vist_id uuid;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT id, placa, marca, modelo, ano_modelo, ano_fabricacao, km_atual, chassi
    INTO v_vec FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_vec.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;

  -- descricao: usa a informada; se vazia e houver vistoria concluida, monta dos itens em reparo/troca
  v_desc := NULLIF(btrim(p_dados->>'descricao_servico'), '');
  IF v_desc IS NULL THEN
    SELECT id INTO v_vist_id FROM insp_vistoria
      WHERE alvo_tabela='veic_veiculo' AND alvo_id=p_veiculo_id AND situacao='concluida'
      ORDER BY concluida_em DESC NULLS LAST LIMIT 1;
    IF v_vist_id IS NOT NULL THEN
      SELECT string_agg(
               i.nome
               || COALESCE(' — ' || NULLIF(btrim(resp.descricao),''), '')
               || CASE WHEN resp.gasto_previsto IS NOT NULL
                       THEN ' (prev. R$ ' || resp.gasto_previsto::text || ')' ELSE '' END,
               E'\n' ORDER BY i.ordem)
        INTO v_itens_txt
        FROM insp_resposta resp
        JOIN insp_item i ON i.id = resp.item_id
       WHERE resp.vistoria_id = v_vist_id AND resp.estado IN ('reparo','troca');
    END IF;
    v_desc := 'Preparacao — ' || COALESCE(v_vec.marca,'') || ' ' || COALESCE(v_vec.modelo,'')
              || CASE WHEN v_itens_txt IS NOT NULL THEN E'\n' || v_itens_txt ELSE '' END;
  END IF;

  -- numero por empresa/ano: OS-YYYY-NNNN (UNIQUE(company_id, numero) protege)
  SELECT 'OS-' || to_char(CURRENT_DATE,'YYYY') || '-' ||
         lpad((COALESCE(max((regexp_match(numero, '^OS-\d{4}-(\d+)$'))[1]::int), 0) + 1)::text, 4, '0')
    INTO v_numero
    FROM erp_os
   WHERE company_id = v_comp AND numero ~ ('^OS-' || to_char(CURRENT_DATE,'YYYY') || '-\d+$');

  INSERT INTO erp_os (company_id, numero, descricao_servico, status, prioridade,
      data_abertura, data_prevista, placa, marca, modelo, ano, km, chassi,
      veic_veiculo_id, observacoes_internas, created_by)
  VALUES (v_comp, v_numero, v_desc, 'aberta',
      COALESCE(NULLIF(btrim(p_dados->>'prioridade'),''), 'normal'),
      CURRENT_DATE, NULLIF(p_dados->>'data_prevista','')::date,
      v_vec.placa, v_vec.marca, v_vec.modelo,
      COALESCE(v_vec.ano_modelo, v_vec.ano_fabricacao), v_vec.km_atual::int, v_vec.chassi,
      p_veiculo_id, NULLIF(btrim(p_dados->>'observacoes_internas'),''), p_user)
  RETURNING id INTO v_os_id;

  INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, p_veiculo_id, 'preparacao', 'CRIOU OS de preparacao ' || v_numero, p_user,
          jsonb_build_object('os_id', v_os_id, 'numero', v_numero));

  RETURN jsonb_build_object('ok', true, 'os_id', v_os_id, 'numero', v_numero, 'status', 'aberta');
END $function$;

-- ------------------------------------------------------------
-- 3.2 · fecha o ciclo: OS concluida vira custo do veiculo [->GE]
--       NAO escreve em erp_pagar direto — chama fn_veic_custo_salvar (que faz a ponte).
--       Idempotente: OS ja com custo devolve ja_lancado:true, nao duplica.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_preparacao_concluir(p_os_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_comp uuid; v_existing uuid; v_valor numeric;
  v_res jsonb; v_custo_id uuid; v_pagar_id uuid;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id AND excluida = false;
  IF v_os.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'os_nao_encontrada'); END IF;
  IF v_os.veic_veiculo_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_preparacao'); END IF;

  v_comp := public.fn_veic_acesso(v_os.veic_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- idempotencia: OS ja tem custo vinculado
  SELECT id INTO v_existing FROM veic_custo WHERE os_id = p_os_id AND deleted_at IS NULL LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_lancado', true, 'custo_id', v_existing, 'os_id', p_os_id, 'numero', v_os.numero);
  END IF;

  -- valor realizado da OS (total, ou soma das partes)
  v_valor := COALESCE(NULLIF(v_os.total, 0),
                      COALESCE(v_os.valor_servico,0) + COALESCE(v_os.valor_materiais,0) + COALESCE(v_os.valor_deslocamento,0));

  -- OS sem valor: conclui, mas nao inventa dinheiro (nenhum custo criado)
  IF v_valor IS NULL OR v_valor <= 0 THEN
    UPDATE erp_os SET status='entregue', data_conclusao=COALESCE(data_conclusao, CURRENT_DATE), updated_at=now()
      WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'ja_lancado', false, 'custo_id', NULL, 'valor', 0, 'sem_custo', true, 'os_id', p_os_id, 'numero', v_os.numero);
  END IF;

  -- cria o custo via a RPC oficial (ela faz a ponte com erp_pagar [->GE]).
  -- entra_base_fiscal NAO decidido aqui (regra fiscal, D2b travado no contador): herda o default.
  v_res := public.fn_veic_custo_salvar(
    v_os.veic_veiculo_id,
    jsonb_build_object(
      'categoria', 'preparacao',
      'descricao', 'OS ' || v_os.numero || ' — ' || left(COALESCE(v_os.descricao_servico, 'preparacao'), 180),
      'valor', v_valor::text,
      'data_custo', COALESCE(v_os.data_conclusao, CURRENT_DATE)::text,
      'documento', v_os.numero
    ),
    true,                                         -- gerar_pagar [->GE]
    COALESCE(v_os.data_conclusao, CURRENT_DATE),  -- vencimento
    p_user);

  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_custo_id := (v_res->>'custo_id')::uuid;
  v_pagar_id := NULLIF(v_res->>'pagar_id','')::uuid;

  -- carimba a origem (indice unico ux_veic_custo_os e a rede de seguranca)
  UPDATE veic_custo SET os_id = p_os_id WHERE id = v_custo_id;

  UPDATE erp_os SET status='entregue', data_conclusao=COALESCE(data_conclusao, CURRENT_DATE), updated_at=now()
    WHERE id = p_os_id;

  RETURN jsonb_build_object('ok', true, 'ja_lancado', false, 'custo_id', v_custo_id,
    'pagar_id', v_pagar_id, 'valor', v_valor, 'os_id', p_os_id, 'numero', v_os.numero);
END $function$;

-- ------------------------------------------------------------
-- 3.3 · o que a ficha e o kanban precisam
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_preparacao_listar(p_company_id uuid, p_veiculo_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(o ORDER BY t.abertura DESC NULLS LAST), '[]'::jsonb) INTO v FROM (
    SELECT os.data_abertura AS abertura, jsonb_build_object(
      'os_id', os.id, 'numero', os.numero, 'status', os.status, 'prioridade', os.prioridade,
      'veiculo_id', os.veic_veiculo_id, 'placa', os.placa, 'marca', os.marca, 'modelo', os.modelo,
      'descricao_servico', os.descricao_servico, 'tecnico_nome', os.tecnico_nome,
      'data_abertura', os.data_abertura, 'data_prevista', os.data_prevista, 'data_conclusao', os.data_conclusao,
      'dias_corridos', (CURRENT_DATE - os.data_abertura),
      'total', COALESCE(NULLIF(os.total,0), COALESCE(os.valor_servico,0)+COALESCE(os.valor_materiais,0)+COALESCE(os.valor_deslocamento,0)),
      'coluna', CASE
                  WHEN os.status IN ('pronta','entregue') THEN 'finalizado'
                  WHEN os.status = 'em_execucao' THEN 'fazendo'
                  ELSE 'a_fazer' END,
      'concluida', os.status IN ('pronta','entregue'),
      'custo_id', (SELECT c.id FROM veic_custo c WHERE c.os_id = os.id AND c.deleted_at IS NULL LIMIT 1)
    ) AS o
    FROM erp_os os
    WHERE os.veic_veiculo_id IS NOT NULL AND os.excluida = false
      AND os.company_id = p_company_id AND os.status <> 'cancelada'
      AND (p_veiculo_id IS NULL OR os.veic_veiculo_id = p_veiculo_id)
  ) t;

  RETURN jsonb_build_object('ok', true, 'os', v);
END $function$;

-- ------------------------------------------------------------
-- 3.4 · previsto (vistoria) x realizado (OS). Declara ausencia, nao compara com zero.
--       desvio = (realizado + em_andamento) - previsto
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_preparacao_confronto(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_vist record; v_previsto numeric; v_itens_prev int;
  v_realizado numeric; v_andamento numeric; v_status text;
  v_os_abertas int; v_os_concluidas int; v_desvio numeric; v_desvio_pct numeric;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- realizado: custos vindos de OS (ja concluidas geram custo)
  SELECT COALESCE(sum(c.valor),0) INTO v_realizado
    FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.os_id IS NOT NULL AND c.deleted_at IS NULL;

  -- em andamento: OS de preparacao abertas, ainda sem custo
  SELECT COALESCE(sum(COALESCE(NULLIF(o.total,0), COALESCE(o.valor_servico,0)+COALESCE(o.valor_materiais,0)+COALESCE(o.valor_deslocamento,0))),0),
         count(*)
    INTO v_andamento, v_os_abertas
    FROM erp_os o
   WHERE o.veic_veiculo_id = p_veiculo_id AND o.excluida = false
     AND o.status NOT IN ('cancelada','entregue','pronta')
     AND NOT EXISTS (SELECT 1 FROM veic_custo c WHERE c.os_id = o.id AND c.deleted_at IS NULL);

  SELECT count(*) INTO v_os_concluidas FROM erp_os o
   WHERE o.veic_veiculo_id = p_veiculo_id AND o.excluida = false AND o.status IN ('entregue','pronta');

  -- vistoria concluida mais recente
  SELECT * INTO v_vist FROM insp_vistoria
   WHERE alvo_tabela='veic_veiculo' AND alvo_id=p_veiculo_id AND situacao='concluida'
   ORDER BY concluida_em DESC NULLS LAST LIMIT 1;

  IF v_vist.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 'sem_previsao',
      'realizado', v_realizado, 'em_andamento', v_andamento,
      'os_abertas', v_os_abertas, 'os_concluidas', v_os_concluidas);
  END IF;

  -- previsto: itens em reparo/troca da vistoria; fallback na previsao_total
  SELECT COALESCE(sum(resp.gasto_previsto),0), count(*)
    INTO v_previsto, v_itens_prev
    FROM insp_resposta resp WHERE resp.vistoria_id = v_vist.id AND resp.estado IN ('reparo','troca');
  IF COALESCE(v_previsto,0) = 0 THEN v_previsto := COALESCE(v_vist.previsao_total,0); END IF;

  IF COALESCE(v_previsto,0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'status', 'previsao_zero',
      'previsto', 0, 'itens_previstos', 0,
      'realizado', v_realizado, 'em_andamento', v_andamento,
      'os_abertas', v_os_abertas, 'os_concluidas', v_os_concluidas, 'vistoria_id', v_vist.id);
  END IF;

  v_desvio := (v_realizado + v_andamento) - v_previsto;
  v_desvio_pct := round((v_desvio / v_previsto) * 100, 1);
  v_status := CASE WHEN v_os_abertas > 0 THEN 'em_andamento' ELSE 'concluido' END;

  RETURN jsonb_build_object('ok', true, 'status', v_status,
    'previsto', v_previsto, 'itens_previstos', v_itens_prev,
    'realizado', v_realizado, 'em_andamento', v_andamento,
    'desvio_valor', v_desvio, 'desvio_pct', v_desvio_pct,
    'os_abertas', v_os_abertas, 'os_concluidas', v_os_concluidas, 'vistoria_id', v_vist.id);
END $function$;
