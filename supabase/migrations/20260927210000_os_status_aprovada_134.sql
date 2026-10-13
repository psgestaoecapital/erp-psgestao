-- #134 (Gean) · status "Aprovada" na OS, atribuído sozinho quando o cliente aprova o orçamento.
--
-- Até aqui a aprovação do cliente só gravava erp_os_aprovacao e marcava os itens; erp_os.status ficava parado
-- em "aguardando aprovação" (ou "aberta") até alguém trocar à mão — na lista não dava para ver quais orçamentos
-- já estavam aprovados e ainda não tinham entrado em execução.
--
-- (1) novo valor 'aprovada' no CHECK de erp_os.status;
-- (2) fn_os_salvar aceita 'aprovada' na troca manual (corpo idêntico ao vigente, só a lista de status muda;
--     e ganha o REVOKE do anon que a régua de guardas exige — ela já recusava quem não tem empresa);
-- (3) gatilho em erp_os_aprovacao: TODA aprovação registrada (tela interna fn_oficina_orcamento_registrar,
--     fn_oficina_aprovacao_registrar e o link público fn_os_publico_aprovar) passa a OS para 'aprovada' quando a
--     decisão é 'aprovado' ou 'parcial' (há item aprovado a executar). Só de 'aberta'/'aguardando_aprovacao':
--     nunca regride OS que já está em execução, aguardando peça, pronta, entregue ou cancelada.
--     'recusado' não mexe no status (comportamento de hoje). Itens recusados numa aprovação parcial aparecem como
--     alerta na OS (tela), não mudam o status.
-- A troca de 'aprovada' para 'em_execucao' continua manual (decisão da oficina).

-- (1) CHECK
ALTER TABLE public.erp_os DROP CONSTRAINT IF EXISTS erp_os_status_check;
ALTER TABLE public.erp_os ADD CONSTRAINT erp_os_status_check CHECK (((status)::text = ANY ((ARRAY[
  'aberta'::character varying, 'aguardando_aprovacao'::character varying, 'aprovada'::character varying,
  'em_execucao'::character varying, 'aguardando_peca'::character varying, 'pronta'::character varying,
  'entregue'::character varying, 'cancelada'::character varying])::text[])));

-- (2) fn_os_salvar
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
     AND public.fn_oficina_papel(v_os.company_id) IS DISTINCT FROM 'CLIENT_OWNER'
     AND NOT EXISTS (SELECT 1 FROM bpo_companies_assignment b WHERE b.company_id = v_os.company_id AND b.user_id = auth.uid() AND b.ativo) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'bloqueio', 'pos_entrega_sem_master',
      'erro', 'OS entregue: apenas usuário Master pode ajustar. Fale com o responsável.'
    );
  END IF;

  IF v_novo_status IS NOT NULL AND v_novo_status NOT IN
    ('aberta','aguardando_aprovacao','aprovada','em_execucao','aguardando_peca','pronta','entregue','cancelada')
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

REVOKE ALL ON FUNCTION public.fn_os_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_salvar(uuid, jsonb) TO authenticated, service_role;

-- (3) aprovação registrada → OS 'aprovada'
CREATE OR REPLACE FUNCTION public.fn_os_aprovacao_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.decisao IN ('aprovado', 'parcial') THEN
    UPDATE erp_os SET status = 'aprovada', updated_at = now()
     WHERE id = NEW.os_id AND company_id = NEW.company_id
       AND status IN ('aberta', 'aguardando_aprovacao');
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_os_aprovacao_status ON public.erp_os_aprovacao;
CREATE TRIGGER trg_os_aprovacao_status
  AFTER INSERT ON public.erp_os_aprovacao
  FOR EACH ROW EXECUTE FUNCTION public.fn_os_aprovacao_status();
