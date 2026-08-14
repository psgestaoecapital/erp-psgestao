-- RD-41 · Fase 1 (Saneamento) — Oficina: editar OS entregue restrito a Master (CLIENT_OWNER).
-- Origem: demanda Jordana KGF 14/08 (item cobrado 2x, cliente vendeu o veículo → reenviar OS corrigida).
-- Defense-in-depth: o front libera o botão só p/ Master; aqui o backend REJEITA edição pós-entrega
-- por não-Master. A trava de OS faturada (titulos_gerados/lancamento_id) permanece INTACTA — nem Master
-- altera valores de OS já lançada na GE. Papel real = tenant_user_roles.role (Master = 'CLIENT_OWNER').
-- Audit: edição de OS que estava 'entregue' vira acao='EDITOU_POS_ENTREGA'.

CREATE OR REPLACE FUNCTION public.fn_os_salvar(p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_os erp_os%ROWTYPE; v_novo_status text := p_dados->>'status'; v_faturada boolean; v_antes jsonb;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;

  IF v_os.company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;

  -- 🛡️ Guarda pós-entrega: OS já entregue só pode ser ajustada por Master (CLIENT_OWNER) ou admin PS.
  IF v_os.status = 'entregue'
     AND NOT is_admin()
     AND public.fn_oficina_papel(v_os.company_id) IS DISTINCT FROM 'CLIENT_OWNER' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'bloqueio', 'pos_entrega_sem_master',
      'erro', 'OS entregue: apenas usuário Master pode ajustar. Fale com o responsável.'
    );
  END IF;

  IF v_novo_status IS NOT NULL AND v_novo_status NOT IN
    ('aberta','em_execucao','aguardando_peca','aguardando_aprovacao','pronta','entregue','cancelada')
  THEN RETURN jsonb_build_object('ok', false, 'erro', 'Status invalido'); END IF;

  v_faturada := COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL;
  IF v_faturada AND (
       (p_dados ? 'valor_servico'      AND NULLIF(p_dados->>'valor_servico','')::numeric      IS DISTINCT FROM v_os.valor_servico)
    OR (p_dados ? 'valor_materiais'    AND NULLIF(p_dados->>'valor_materiais','')::numeric    IS DISTINCT FROM v_os.valor_materiais)
    OR (p_dados ? 'valor_deslocamento' AND NULLIF(p_dados->>'valor_deslocamento','')::numeric IS DISTINCT FROM v_os.valor_deslocamento)
    OR (p_dados ? 'valor_hora'         AND NULLIF(p_dados->>'valor_hora','')::numeric         IS DISTINCT FROM v_os.valor_hora)
    OR (p_dados ? 'desconto_valor'     AND NULLIF(p_dados->>'desconto_valor','')::numeric     IS DISTINCT FROM v_os.desconto_valor)
    OR (p_dados ? 'horas_previstas'    AND NULLIF(p_dados->>'horas_previstas','')::numeric    IS DISTINCT FROM v_os.horas_previstas)
    OR (p_dados ? 'horas_executadas'   AND NULLIF(p_dados->>'horas_executadas','')::numeric   IS DISTINCT FROM v_os.horas_executadas)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'faturada', true,
      'erro', 'OS faturada: os valores não podem ser alterados (já virou lançamento na GE). Dados do veículo/cliente podem.');
  END IF;

  v_antes := jsonb_build_object('placa', v_os.placa, 'cliente_id', v_os.cliente_id, 'cliente_nome', v_os.cliente_nome, 'modelo', v_os.modelo,
    'marca', v_os.marca, 'km', v_os.km, 'defeito_relatado', v_os.defeito_relatado, 'status', v_os.status, 'total', v_os.total);

  UPDATE erp_os SET
    placa=COALESCE(NULLIF(upper(regexp_replace(COALESCE(p_dados->>'placa',''), '[^A-Za-z0-9]', '', 'g')),''), placa),
    modelo=COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    marca=COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    ano=COALESCE(NULLIF(p_dados->>'ano','')::int, ano),
    km=COALESCE(NULLIF(p_dados->>'km','')::int, km),
    chassi=COALESCE(NULLIF(btrim(p_dados->>'chassi'),''), chassi),
    cliente_id=CASE WHEN p_dados ? 'cliente_id' THEN NULLIF(btrim(p_dados->>'cliente_id'),'')::uuid ELSE cliente_id END,
    cliente_nome=COALESCE(NULLIF(btrim(p_dados->>'cliente_nome'),''), cliente_nome),
    cliente_cnpj=COALESCE(NULLIF(btrim(p_dados->>'cliente_cnpj'),''), cliente_cnpj),
    equipamento=COALESCE(p_dados->>'equipamento',equipamento),
    defeito_relatado=COALESCE(p_dados->>'defeito_relatado',defeito_relatado),
    descricao_servico=COALESCE(p_dados->>'descricao_servico',descricao_servico),
    endereco_servico=COALESCE(p_dados->>'endereco_servico',endereco_servico),
    observacoes_cliente=COALESCE(p_dados->>'observacoes_cliente',observacoes_cliente),
    observacoes_internas=COALESCE(p_dados->>'observacoes_internas',observacoes_internas),
    prioridade=COALESCE(NULLIF(p_dados->>'prioridade',''), prioridade),
    tecnico_nome=COALESCE(p_dados->>'tecnico_nome',tecnico_nome),
    horas_previstas=CASE WHEN v_faturada THEN horas_previstas ELSE COALESCE(NULLIF(p_dados->>'horas_previstas','')::numeric,horas_previstas) END,
    horas_executadas=CASE WHEN v_faturada THEN horas_executadas ELSE COALESCE(NULLIF(p_dados->>'horas_executadas','')::numeric,horas_executadas) END,
    valor_hora=CASE WHEN v_faturada THEN valor_hora ELSE COALESCE(NULLIF(p_dados->>'valor_hora','')::numeric,valor_hora) END,
    valor_servico=CASE WHEN v_faturada THEN valor_servico ELSE COALESCE(NULLIF(p_dados->>'valor_servico','')::numeric,valor_servico) END,
    valor_materiais=CASE WHEN v_faturada THEN valor_materiais ELSE COALESCE(NULLIF(p_dados->>'valor_materiais','')::numeric,valor_materiais) END,
    valor_deslocamento=CASE WHEN v_faturada THEN valor_deslocamento ELSE COALESCE(NULLIF(p_dados->>'valor_deslocamento','')::numeric,valor_deslocamento) END,
    desconto_valor=CASE WHEN v_faturada THEN desconto_valor ELSE COALESCE(NULLIF(p_dados->>'desconto_valor','')::numeric,desconto_valor) END,
    status=COALESCE(v_novo_status,status),
    data_execucao=CASE WHEN v_novo_status='em_execucao' AND data_execucao IS NULL THEN CURRENT_DATE ELSE data_execucao END,
    data_conclusao=CASE WHEN v_novo_status IN ('pronta','entregue') AND data_conclusao IS NULL THEN CURRENT_DATE ELSE data_conclusao END,
    updated_at=now()
  WHERE id=p_os_id RETURNING * INTO v_os;

  IF NOT v_faturada THEN
    UPDATE erp_os SET total =
        (COALESCE(valor_hora,0) * COALESCE(NULLIF(horas_executadas,0), horas_previstas, 0))
      + COALESCE(valor_servico,0) + COALESCE(valor_materiais,0)
      + COALESCE(valor_deslocamento,0) - COALESCE(desconto_valor,0)
    WHERE id=p_os_id RETURNING * INTO v_os;
  END IF;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_os.company_id, auth.uid(), (SELECT email FROM users WHERE id=auth.uid()),
      'erp_os', v_os.id::text,
      CASE WHEN v_antes->>'status' = 'entregue' THEN 'EDITOU_POS_ENTREGA' ELSE 'EDITOU' END,
      v_antes,
      jsonb_build_object('placa', v_os.placa, 'cliente_id', v_os.cliente_id, 'cliente_nome', v_os.cliente_nome, 'modelo', v_os.modelo,
        'marca', v_os.marca, 'km', v_os.km, 'defeito_relatado', v_os.defeito_relatado, 'status', v_os.status, 'total', v_os.total));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok',true,'os_id',v_os.id,'status',v_os.status,'total',v_os.total);
END; $function$;

-- Selo p/ a tela: última edição pós-entrega de uma OS. A RLS de audit_log_global só deixa admin/
-- socio_ceo ler; aqui (SECURITY DEFINER) devolvemos o selo re-aplicando escopo por empresa, para
-- que quem enxerga a OS veja "Editada após entrega por … em …". Retorna NULL se não houve/sem acesso.
CREATE OR REPLACE FUNCTION public.fn_os_editado_pos_entrega(p_os_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT jsonb_build_object('user_email', al.user_email, 'quando', al.created_at)
  FROM audit_log_global al
  WHERE al.tabela = 'erp_os' AND al.registro_id = p_os_id::text AND al.acao = 'EDITOU_POS_ENTREGA'
    AND al.company_id IN (SELECT user_company_ids())
  ORDER BY al.created_at DESC
  LIMIT 1
$f$;
GRANT EXECUTE ON FUNCTION public.fn_os_editado_pos_entrega(uuid) TO authenticated;
