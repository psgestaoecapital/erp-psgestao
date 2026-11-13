-- PDCA GE · /dashboard/cadastros/contratos-recorrentes (auditor_pdca_2, aud8 85/95) — Code: code-desenvolvedor-3
--
-- Gaps atendidos por esta migration (criação atômica e guardada):
--   (2) consistência/segurança: criar/editar contrato passa a ser por RPC guardada
--       (fn_contrato_salvar), no mesmo padrão de excluir/encerrar — em vez de INSERT/
--       UPDATE direto client-side que dependia só da RLS, sem validação server-side.
--   (5) número: o cliente gerava `CTR-<6 díg do timestamp>`, que pode colidir com a
--       UNIQUE(company_id, numero). Agora o número sai SERVER-SIDE, sequencial por
--       empresa (CTR-NNNNN), com retry em unique_violation — nunca colide.
--
-- Função SECURITY DEFINER: confere a empresa do registro (fn__guarda_empresa) antes de
-- gravar, REVOKE anon, autoria por auth.uid(). ADITIVA: não altera dado de cliente nem
-- toca em título/financeiro já existente. A fonte legada (coluna texto) continua intacta.
--
-- RD-38 (provado em produção, BEGIN..ROLLBACK, statement_timeout 15s):
--   criar  -> {"ok":true,"numero":"CTR-00001","modo":"criar"} (nº único por empresa)
--   editar -> persiste nome/tipo/valor/status/periodicidade/dia/reajuste/pct no banco
--   validações -> "Dá um nome para essa cobrança." / "O valor precisa ser maior que zero."

CREATE OR REPLACE FUNCTION public.fn_contrato_salvar(
  p_company_id uuid,
  p_id uuid,
  p_nome text,
  p_tipo text,
  p_cliente_id uuid,
  p_cliente_nome text,
  p_cliente_cnpj text,
  p_cliente_email text,
  p_cliente_telefone text,
  p_valor_mensal numeric,
  p_data_inicio date,
  p_data_fim date,
  p_dia_vencimento integer,
  p_periodicidade text,
  p_tipo_reajuste text,
  p_reajuste_percentual numeric,
  p_descricao text,
  p_status text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_numero text;
  v_seq bigint;
  v_try int := 0;
BEGIN
  -- guarda de empresa: só grava contrato de empresa que o usuário acessa
  PERFORM public.fn__guarda_empresa(p_company_id);

  -- validações de negócio (erro em linguagem do usuário)
  IF coalesce(btrim(p_nome), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Dá um nome para essa cobrança.');
  END IF;
  IF p_valor_mensal IS NULL OR p_valor_mensal <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O valor precisa ser maior que zero.');
  END IF;
  IF p_data_inicio IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe quando a cobrança começa.');
  END IF;

  IF p_id IS NOT NULL THEN
    -- EDITAR: só um contrato vivo da própria empresa
    SELECT id INTO v_id FROM erp_contratos
      WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Cobrança não encontrada nesta empresa.');
    END IF;
    UPDATE erp_contratos SET
      nome = btrim(p_nome),
      tipo = coalesce(p_tipo, 'mensalidade'),
      cliente_id = p_cliente_id,
      cliente_nome = p_cliente_nome,
      cliente_cnpj = p_cliente_cnpj,
      cliente_email = p_cliente_email,
      cliente_telefone = p_cliente_telefone,
      valor_mensal = p_valor_mensal,
      valor_atual = p_valor_mensal,
      data_inicio = p_data_inicio,
      data_fim = p_data_fim,
      data_primeiro_vencimento = p_data_inicio,
      dia_vencimento = coalesce(p_dia_vencimento, 10),
      periodicidade = coalesce(p_periodicidade, 'mensal'),
      tipo_reajuste = coalesce(p_tipo_reajuste, 'nenhum'),
      reajuste_percentual = coalesce(p_reajuste_percentual, 0),
      descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
      status = coalesce(p_status, 'ativo'),
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id;
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'modo', 'editar');
  END IF;

  -- CRIAR: número único por empresa (evita a colisão do CTR-<timestamp> do client)
  LOOP
    v_try := v_try + 1;
    SELECT coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0)
      INTO v_seq
      FROM erp_contratos
     WHERE company_id = p_company_id AND numero ~ '^CTR-\d+$';
    v_numero := 'CTR-' || lpad((v_seq + v_try)::text, 5, '0');
    BEGIN
      INSERT INTO erp_contratos (
        company_id, numero, nome, tipo, cliente_id, cliente_nome, cliente_cnpj,
        cliente_email, cliente_telefone, valor_mensal, valor_atual, data_inicio,
        data_fim, data_primeiro_vencimento, dia_vencimento, periodicidade,
        tipo_reajuste, reajuste_percentual, descricao, status, natureza, created_by
      ) VALUES (
        p_company_id, v_numero, btrim(p_nome), coalesce(p_tipo, 'mensalidade'),
        p_cliente_id, p_cliente_nome, p_cliente_cnpj, p_cliente_email, p_cliente_telefone,
        p_valor_mensal, p_valor_mensal, p_data_inicio, p_data_fim, p_data_inicio,
        coalesce(p_dia_vencimento, 10), coalesce(p_periodicidade, 'mensal'),
        coalesce(p_tipo_reajuste, 'nenhum'), coalesce(p_reajuste_percentual, 0),
        nullif(btrim(coalesce(p_descricao, '')), ''), coalesce(p_status, 'ativo'),
        'receita', auth.uid()
      ) RETURNING id INTO v_id;
      RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'modo', 'criar');
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 5 THEN RAISE; END IF;
      -- tenta o próximo número
    END;
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_contrato_salvar(uuid,uuid,text,text,uuid,text,text,text,text,numeric,date,date,integer,text,numeric,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_salvar(uuid,uuid,text,text,uuid,text,text,text,text,numeric,date,date,integer,text,numeric,text,text,text) TO authenticated, service_role;
