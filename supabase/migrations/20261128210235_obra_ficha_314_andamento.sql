-- 20261127070240 · code-desenvolvedor-3 · Tela 314 (Ficha da obra) — gaps 1-3 do PDCA (auditor_pdca_1 25/11):
-- situação da obra + datas previstas/efetivas + % de conclusão NA FICHA. Colunas JÁ EXISTEM em projetos_obras
-- (status, data_inicio, data_prevista_fim, data_conclusao, pct_conclusao) — é só WIRING, sem migration de estrutura.
-- ADITIVA: duas funções NOVAS guardadas por empresa (ler/salvar), nenhuma coluna nova, nenhum dado de cliente apagado.
-- Mesmo padrão das seções existentes da ficha (fn_obra_ficha_endereco_ler/salvar): SECURITY DEFINER + search_path +
-- guarda por company_id (is_admin / get_user_company_ids) + audit_log. Idempotente. REVOKE anon.

-- LEITURA do andamento (não toca fn_obra_ficha_ler — fatia collision-free)
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_andamento_ler(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v public.projetos_obras%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'obra_id', v.id,
    'status', v.status,
    'data_inicio', v.data_inicio,
    'data_prevista_fim', v.data_prevista_fim,
    'data_conclusao', v.data_conclusao,
    'pct_conclusao', v.pct_conclusao
  );
END; $$;

-- GRAVAÇÃO do andamento. Status restrito ao domínio existente (em_andamento/pausada/concluida/cancelada); pct 0–100;
-- data de conclusão não pode ser anterior à de início. Campo vazio (NULL) é aceito e limpa o valor.
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_andamento_salvar(
  p_obra_id            uuid,
  p_status             text,
  p_data_inicio        date,
  p_data_prevista_fim  date,
  p_data_conclusao     date,
  p_pct_conclusao      numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.projetos_obras%ROWTYPE;
  v_status text := nullif(btrim(p_status), '');
  v_pct    numeric := p_pct_conclusao;
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF v_status IS NOT NULL AND v_status NOT IN ('em_andamento', 'pausada', 'concluida', 'cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Situação da obra inválida.');
  END IF;
  IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O percentual de conclusão deve ficar entre 0 e 100.');
  END IF;
  IF p_data_inicio IS NOT NULL AND p_data_conclusao IS NOT NULL AND p_data_conclusao < p_data_inicio THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A data de conclusão não pode ser anterior à data de início.');
  END IF;

  UPDATE public.projetos_obras
     SET status = coalesce(v_status, status),
         data_inicio = p_data_inicio,
         data_prevista_fim = p_data_prevista_fim,
         data_conclusao = p_data_conclusao,
         pct_conclusao = v_pct,
         updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_andamento',
          jsonb_build_object('status', v.status, 'data_inicio', v.data_inicio, 'data_prevista_fim', v.data_prevista_fim,
                             'data_conclusao', v.data_conclusao, 'pct_conclusao', v.pct_conclusao),
          jsonb_build_object('status', coalesce(v_status, v.status), 'data_inicio', p_data_inicio, 'data_prevista_fim', p_data_prevista_fim,
                             'data_conclusao', p_data_conclusao, 'pct_conclusao', v_pct));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'status', coalesce(v_status, v.status),
    'data_inicio', p_data_inicio, 'data_prevista_fim', p_data_prevista_fim, 'data_conclusao', p_data_conclusao, 'pct_conclusao', v_pct);
END; $$;

REVOKE ALL ON FUNCTION public.fn_obra_ficha_andamento_ler(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_ficha_andamento_salvar(uuid, text, date, date, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_andamento_ler(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_andamento_salvar(uuid, text, date, date, date, numeric) TO authenticated;

-- "?" RD-95 dos campos novos (chave = projetos.obra_ficha.*, rota exata da tela 314)
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.obra_ficha.status', '/dashboard/projetos/obras/[id]/ficha', 'Andamento da obra', 'Situação da obra',
   'Selecione a situação atual: Em andamento, Pausada, Concluída ou Cancelada.',
   'Mostra em que estado a obra está e alimenta os painéis e o resultado por obra. A obra concluída/cancelada sai das listas de obras ativas.',
   'A obra parou por embargo → marque Pausada; ao retomar, volte para Em andamento.',
   'Marcar Concluída antes da entrega efetiva — isso tira a obra dos acompanhamentos em curso.',
   'hub_projetos', 20, 1, 'publicado'),
  ('projetos.obra_ficha.data_inicio', '/dashboard/projetos/obras/[id]/ficha', 'Andamento da obra', 'Início (efetivo)',
   'Informe a data em que a obra efetivamente começou.',
   'É a base para medir prazo decorrido e cruzar com a data prevista de término.',
   '10/03/2026.',
   'Usar a data do contrato quando a obra só começou semanas depois — use a data real de início.',
   'hub_projetos', 21, 1, 'publicado'),
  ('projetos.obra_ficha.data_prevista_fim', '/dashboard/projetos/obras/[id]/ficha', 'Andamento da obra', 'Previsão de término',
   'Informe a data prevista para concluir a obra.',
   'Serve para acompanhar o prazo e sinalizar atraso quando a data passa sem conclusão.',
   '20/12/2026.',
   'Deixar a previsão desatualizada após uma repactuação de prazo — mantenha o valor vigente.',
   'hub_projetos', 22, 1, 'publicado'),
  ('projetos.obra_ficha.data_conclusao', '/dashboard/projetos/obras/[id]/ficha', 'Andamento da obra', 'Conclusão (efetiva)',
   'Informe a data em que a obra foi de fato concluída (preencha só quando concluir).',
   'Fecha o prazo real da obra e permite comparar previsto × realizado. Não pode ser anterior ao início.',
   '18/12/2026.',
   'Preencher a conclusão com a obra ainda em andamento — deixe em branco até concluir.',
   'hub_projetos', 23, 1, 'publicado'),
  ('projetos.obra_ficha.pct_conclusao', '/dashboard/projetos/obras/[id]/ficha', 'Andamento da obra', '% de conclusão',
   'Informe o avanço físico da obra, de 0 a 100.',
   'Resume o quanto já foi executado; aparece nos painéis e no acompanhamento de avanço.',
   'Obra na metade do cronograma físico → 50.',
   'Informar valor acima de 100 ou negativo — o campo aceita apenas de 0 a 100.',
   'hub_projetos', 24, 1, 'publicado'),
  ('projetos.obra_ficha.salvar_andamento', '/dashboard/projetos/obras/[id]/ficha', 'Andamento da obra', 'Salvar andamento',
   'Toque para gravar a situação, as datas e o percentual de conclusão da obra.',
   'Persiste o andamento na ficha; o estado passa a valer nos painéis e nas listas de obras.',
   'Ajustou o % para 60 e marcou Em andamento → Salvar andamento.',
   'Esquecer de salvar após mudar a situação — a alteração só vale depois de salvar.',
   'hub_projetos', 25, 1, 'publicado'),
  ('projetos.obra_ficha.reg_tecnicos', '/dashboard/projetos/obras/[id]/ficha', 'Regularização', 'CNO, ART/RRT e responsáveis técnicos',
   'Esta é a vista só-leitura dos dados de regularização da obra: CNO, ART/RRT e responsáveis técnicos. Para cadastrar ou alterar, use a aba Regularização da obra.',
   'Reúne, num só lugar da ficha, os registros legais da obra (CNO na Receita, ART/RRT no conselho) e quem responde tecnicamente — base para emitir documentos e comprovar regularidade.',
   'Obra com CNO emitido e ART do engenheiro responsável vinculada → aparecem listados aqui; o cadastro é feito na Regularização.',
   'Tentar editar por aqui — este bloco só exibe; a inclusão/alteração é na aba Regularização da obra.',
   'hub_projetos', 30, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
