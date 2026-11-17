-- fn_contrato_salvar: writer guardado para criar/editar cobrança recorrente (erp_contratos).
-- PDCA GE /dashboard/cadastros/contratos-recorrentes (aud8 85/95):
--   item 1 (critério e / RD-99) — erro cru do Postgres ao salvar (ContratoForm jogava result.error.message na tela).
--   item 2 (consistência/segurança) — criar/editar iam DIRETO em erp_contratos (INSERT/UPDATE sem RPC/validação/audit),
--     divergindo de excluir/encerrar (que já usam RPC guardada).
--   item 5 (dado) — número CTR-${Date.now().slice(-6)} gerado no cliente podia COLIDIR; aqui o número é gerado no
--     servidor (sequencial por empresa) com garantia de unicidade.
-- Esta RPC centraliza: autenticação, guarda multi-tenant (RLS por empresa), validação com mensagem amigável,
-- número único por empresa e audit (audit_log_global + erp_contratos_eventos).
-- Aditiva: não altera a tabela nem dado de cliente; apenas adiciona a função (SECURITY INVOKER herda a RLS da tabela).

CREATE OR REPLACE FUNCTION public.fn_contrato_salvar(
  p_id         uuid,
  p_company_id uuid,
  p_dados      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text := NULLIF(btrim(p_dados->>'nome'), '');
  v_valor     numeric := NULLIF(p_dados->>'valor_mensal', '')::numeric;
  v_inicio    date := NULLIF(p_dados->>'data_inicio', '')::date;
  v_existe    public.erp_contratos%ROWTYPE;
  v_id        uuid;
  v_numero    text;
  v_seq       integer;
  v_antes     jsonb;
  v_dia       integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado', 'mensagem', 'Sessão expirada. Entre novamente.');
  END IF;
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_obrigatoria', 'mensagem', 'Selecione uma empresa.');
  END IF;
  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio', 'mensagem', 'Dá um nome para essa cobrança — ex: "Aluguel sala 101".');
  END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'mensagem', 'O valor precisa ser maior que zero.');
  END IF;
  IF v_inicio IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'inicio_obrigatorio', 'mensagem', 'Informe quando essa cobrança começa.');
  END IF;

  -- Guarda multi-tenant: só grava em empresa no escopo do usuário (ou admin).
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso', 'mensagem', 'Você não tem acesso a esta empresa.');
  END IF;

  v_dia := GREATEST(1, LEAST(31, COALESCE(NULLIF(p_dados->>'dia_vencimento', '')::integer, 10)));

  -- Edição: a cobrança tem de existir, ser da mesma empresa e não estar excluída.
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existe FROM public.erp_contratos WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado', 'mensagem', 'Cobrança não encontrada.');
    END IF;
    IF v_existe.company_id <> p_company_id THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'empresa_divergente', 'mensagem', 'A cobrança pertence a outra empresa.');
    END IF;
    IF v_existe.status = 'excluido' OR v_existe.excluido_em IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'contrato_excluido', 'mensagem', 'Esta cobrança foi excluída e não pode ser editada.');
    END IF;
    v_numero := v_existe.numero;
  ELSE
    -- Número sequencial por empresa, com garantia de unicidade (substitui CTR-Date.now do cliente, que colidia).
    SELECT COUNT(*) + 1 INTO v_seq FROM public.erp_contratos WHERE company_id = p_company_id;
    LOOP
      v_numero := 'CTR-' || lpad(v_seq::text, 5, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.erp_contratos WHERE company_id = p_company_id AND numero = v_numero
      );
      v_seq := v_seq + 1;
    END LOOP;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.erp_contratos (
      company_id, numero, nome, tipo, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone,
      valor_mensal, valor_atual, data_inicio, data_fim, data_primeiro_vencimento, dia_vencimento,
      periodicidade, tipo_reajuste, reajuste_percentual, descricao, status, created_by, updated_at
    ) VALUES (
      p_company_id, v_numero, v_nome, COALESCE(NULLIF(btrim(p_dados->>'tipo'), ''), 'mensalidade'),
      NULLIF(p_dados->>'cliente_id', '')::uuid, NULLIF(btrim(p_dados->>'cliente_nome'), ''),
      NULLIF(btrim(p_dados->>'cliente_cnpj'), ''), NULLIF(btrim(p_dados->>'cliente_email'), ''),
      NULLIF(btrim(p_dados->>'cliente_telefone'), ''),
      v_valor, v_valor, v_inicio, NULLIF(p_dados->>'data_fim', '')::date, v_inicio, v_dia,
      COALESCE(NULLIF(btrim(p_dados->>'periodicidade'), ''), 'mensal'),
      COALESCE(NULLIF(btrim(p_dados->>'tipo_reajuste'), ''), 'nenhum'),
      COALESCE(NULLIF(p_dados->>'reajuste_percentual', '')::numeric, 0),
      NULLIF(btrim(p_dados->>'descricao'), ''),
      COALESCE(NULLIF(btrim(p_dados->>'status'), ''), 'ativo'), v_uid, now()
    ) RETURNING id INTO v_id;

    INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
    VALUES (v_id, p_company_id, 'criado', format('Cobrança "%s" criada (%s)', v_nome, v_numero),
            jsonb_build_object('numero', v_numero, 'valor', v_valor), v_uid, now());

    INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, COALESCE((SELECT email FROM public.users WHERE id = v_uid), ''),
            'erp_contratos', v_id::text, 'contrato_criar', NULL,
            jsonb_build_object('numero', v_numero, 'nome', v_nome, 'valor_mensal', v_valor));
  ELSE
    v_antes := jsonb_build_object('nome', v_existe.nome, 'tipo', v_existe.tipo, 'cliente_id', v_existe.cliente_id,
                                  'valor_mensal', v_existe.valor_mensal, 'valor_atual', v_existe.valor_atual,
                                  'data_inicio', v_existe.data_inicio, 'data_fim', v_existe.data_fim,
                                  'dia_vencimento', v_existe.dia_vencimento, 'periodicidade', v_existe.periodicidade,
                                  'tipo_reajuste', v_existe.tipo_reajuste, 'reajuste_percentual', v_existe.reajuste_percentual,
                                  'status', v_existe.status);
    v_id := p_id;

    UPDATE public.erp_contratos SET
      nome = v_nome,
      tipo = COALESCE(NULLIF(btrim(p_dados->>'tipo'), ''), tipo),
      cliente_id = NULLIF(p_dados->>'cliente_id', '')::uuid,
      cliente_nome = NULLIF(btrim(p_dados->>'cliente_nome'), ''),
      cliente_cnpj = NULLIF(btrim(p_dados->>'cliente_cnpj'), ''),
      cliente_email = NULLIF(btrim(p_dados->>'cliente_email'), ''),
      cliente_telefone = NULLIF(btrim(p_dados->>'cliente_telefone'), ''),
      valor_mensal = v_valor,
      valor_atual = v_valor,
      data_inicio = v_inicio,
      data_fim = NULLIF(p_dados->>'data_fim', '')::date,
      data_primeiro_vencimento = v_inicio,
      dia_vencimento = v_dia,
      periodicidade = COALESCE(NULLIF(btrim(p_dados->>'periodicidade'), ''), periodicidade),
      tipo_reajuste = COALESCE(NULLIF(btrim(p_dados->>'tipo_reajuste'), ''), tipo_reajuste),
      reajuste_percentual = COALESCE(NULLIF(p_dados->>'reajuste_percentual', '')::numeric, 0),
      descricao = NULLIF(btrim(p_dados->>'descricao'), ''),
      status = COALESCE(NULLIF(btrim(p_dados->>'status'), ''), status),
      updated_at = now()
    WHERE id = p_id;

    INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
    VALUES (p_id, p_company_id, 'editado', format('Cobrança "%s" editada', v_nome),
            jsonb_build_object('antes', v_antes), v_uid, now());

    INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, COALESCE((SELECT email FROM public.users WHERE id = v_uid), ''),
            'erp_contratos', v_id::text, 'contrato_editar', v_antes,
            jsonb_build_object('nome', v_nome, 'valor_mensal', v_valor, 'status', COALESCE(NULLIF(btrim(p_dados->>'status'), ''), v_existe.status)));
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
END $function$;

REVOKE ALL ON FUNCTION public.fn_contrato_salvar(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_contrato_salvar(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_salvar(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contrato_salvar(uuid, uuid, jsonb) TO service_role;

-- RD-95: chave de ajuda "?" para a nova ação "Faturar" no card da lista de cobranças recorrentes.
-- Aditiva e idempotente: só conteúdo de ajuda. RD-100: termos próprios, sem nome de sistema de terceiros.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem, v.status
FROM (VALUES
  ('ge.contratos.faturar_lista', '/dashboard/cadastros/contratos-recorrentes', 'Cobranças recorrentes', 'Faturar',
   'Clique para gerar a conta a receber do mês atual desta cobrança, direto da lista, e confirme no aviso.',
   'Transforma a cobrança recorrente num título de Contas a Receber sem ir para outra tela nem digitar nada à mão.',
   'Clicar em "Faturar" numa mensalidade ativa cria a conta a receber do cliente com o valor e o vencimento do contrato.',
   'Clicar duas vezes achando que não gerou: a geração do mês não duplica, mas confira em Contas a Receber antes de refazer.',
   'gestao_empresarial', 8, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
