-- PDCA Hub · /dashboard/projetos/obras/[id]/horas (Lançar horas na obra)
-- Gaps do auditor_pdca_1 (08/11):
--   1) RD-98 p2: faltava EDITAR (só Incluir/Excluir) -> fn_obra_mao_obra_editar (aditiva, com guarda).
--   2) RD-98 p3: rota ausente em system_screens -> registra views/rpcs (origem do dado).
--   3) RD-95: "?" ausente na ação Excluir e no indicador Total -> chaves de ajuda.
-- Tudo ADITIVO e idempotente. Não altera/apaga dado de cliente. RD-38 provado no PR (BEGIN/ROLLBACK).

-- 1) EDITAR um apontamento de mão de obra (RD-98 p2) --------------------------------
-- Corrige data/função/horas/custo/descrição sem excluir e relançar (preserva o id e o histórico).
-- `valor` é coluna GERADA (round(horas*custo_hora,2)) — recalcula sozinha, nunca é escrita aqui.
-- Mesma guarda de empresa de fn_obra_mao_obra_apontar/_excluir (#2687). Não edita lançamento já excluído.
CREATE OR REPLACE FUNCTION public.fn_obra_mao_obra_editar(p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row     public.projetos_obra_mao_obra_apontamento%ROWTYPE;
  v_data    date;
  v_funcao  uuid;
  v_desc    text;
  v_horas   numeric;
  v_custo   numeric;
BEGIN
  SELECT * INTO v_row FROM public.projetos_obra_mao_obra_apontamento
   WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apontamento não encontrado' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.fn__guarda_empresa(v_row.company_id);

  -- campo ausente mantém o valor atual; função pode ser limpada enviando '' explicitamente.
  v_data   := COALESCE(NULLIF(p_dados->>'data','')::date, v_row.data);
  v_funcao := CASE WHEN p_dados ? 'funcao_id' THEN NULLIF(p_dados->>'funcao_id','')::uuid ELSE v_row.funcao_id END;
  v_desc   := CASE WHEN p_dados ? 'descricao' THEN NULLIF(btrim(p_dados->>'descricao'),'') ELSE v_row.descricao END;
  v_horas  := COALESCE(NULLIF(p_dados->>'horas','')::numeric, v_row.horas);
  v_custo  := COALESCE(NULLIF(p_dados->>'custo_hora','')::numeric, v_row.custo_hora);

  IF v_horas IS NULL OR v_horas <= 0 THEN RAISE EXCEPTION 'Informe as horas trabalhadas (maior que zero).' USING ERRCODE = '22023'; END IF;
  IF v_custo IS NULL OR v_custo < 0 THEN RAISE EXCEPTION 'Informe o custo da hora.' USING ERRCODE = '22023'; END IF;

  UPDATE public.projetos_obra_mao_obra_apontamento
     SET data = v_data, funcao_id = v_funcao, descricao = v_desc, horas = v_horas, custo_hora = v_custo
   WHERE id = p_id;

  -- RD-98 p4: trilha central de auditoria (mesmo padrão de fn_obra_mao_obra_excluir / fn_obra_custo_editar)
  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_row.company_id, auth.uid(), auth.jwt() ->> 'email', 'projetos_obra_mao_obra_apontamento', p_id::text, 'obra_mao_obra_editar',
          jsonb_build_object('data', v_row.data, 'funcao_id', v_row.funcao_id, 'descricao', v_row.descricao, 'horas', v_row.horas, 'custo_hora', v_row.custo_hora),
          jsonb_build_object('data', v_data, 'funcao_id', v_funcao, 'descricao', v_desc, 'horas', v_horas, 'custo_hora', v_custo));

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_mao_obra_editar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_mao_obra_editar(uuid, jsonb) TO authenticated, service_role;

-- 2) RD-95 · "?" na ação Excluir e no indicador Total -------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('projetos.horas_obra.editar', '/dashboard/projetos/obras/[id]/horas', 'Lançar horas na obra · Ações', 'Editar',
   'Corrige um lançamento de horas (data, função, horas, custo/hora ou descrição) sem precisar excluir e lançar de novo.',
   'Ajustar uma hora lançada errada mantendo o mesmo lançamento — a correção fica registrada (quem/quando, antes e depois) e o custo no Resultado por obra se ajusta na hora.',
   'Lançou 8 h mas foram 6 h → Editar → horas 6 → Salvar.',
   'Mudar horas/custo sem conferir o total: confira o Custo da linha depois de salvar.',
   'hub_construcao', 7, 'publicado'),
  ('projetos.horas_obra.excluir', '/dashboard/projetos/obras/[id]/horas', 'Lançar horas na obra · Ações', 'Excluir',
   'Remove o lançamento de horas (exclusão rastreável, com confirmação).',
   'Tirar do custo da obra uma hora lançada por engano, sem apagar o histórico (fica registrado quem excluiu e quando).',
   'Lançou no obra errada → Excluir → confirme; o custo sai do Resultado por obra.',
   'Excluir para "corrigir" um valor: para corrigir, use Editar — Excluir é só para remover de vez.',
   'hub_construcao', 8, 'publicado'),
  ('projetos.horas_obra.total', '/dashboard/projetos/obras/[id]/horas', 'Lançar horas na obra · Indicadores', 'Total de mão de obra',
   'Soma do custo de todos os lançamentos de horas listados (horas × custo/hora de cada linha).',
   'Mostra quanto de mão de obra já entrou no custo desta obra — o mesmo valor que compõe o custo_mao_obra do Resultado por obra.',
   '3 lançamentos de R$ 400, R$ 600 e R$ 200 → Total R$ 1.200,00.',
   'Esperar bater com a folha: aqui é o custo lançado nesta obra, não o salário total do mês.',
   'hub_construcao', 9, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 3) RD-98 p3 · registrar a rota em system_screens (origem do dado) ------------------
INSERT INTO public.system_screens (id, rota, area, titulo, modulo, estado_real, prioridade_monitoramento, views_consumidas, rpcs_chamadas, auditavel_robo, criado_em, atualizado_em)
VALUES (gen_random_uuid()::text, '/dashboard/projetos/obras/[id]/horas', 'hub_construcao', 'Lançar horas na obra', 'projetos_obras', 'parcial', 'media',
        ARRAY['projetos_obra_mao_obra_apontamento','erp_funcao_mao_obra'],
        ARRAY['fn_obra_mao_obra_apontar','fn_obra_mao_obra_editar','fn_obra_mao_obra_excluir'],
        true, now(), now())
ON CONFLICT (rota) DO UPDATE
  SET views_consumidas = EXCLUDED.views_consumidas,
      rpcs_chamadas    = EXCLUDED.rpcs_chamadas,
      atualizado_em    = now();
