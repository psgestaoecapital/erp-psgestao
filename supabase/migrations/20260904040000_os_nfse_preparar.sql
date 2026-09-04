-- Chamado #20 · Fase 2: NFS-e (serviços) a partir da OS.
--
-- Contexto (provado no dado, RD-38):
--   • A emissão de NFS-e lê o serviço de erp_servicos (fn_receber_nfse_dados / gov-nfse-emitir),
--     que exige codigo_lc116 + codigo_servico_municipio.
--   • A OS/diagnóstico grava o serviço como erp_oficina_servicos.id (tempário) — tabela DIFERENTE,
--     e a ponte erp_oficina_servicos.servico_fiscal_id está vazia (RD-52). Passar o servico_id da OS
--     direto pra emissão daria "serviço inválido".
--   Logo, a Fase 2 NUNCA usa o servico_id da OS: resolve o SERVIÇO FISCAL da empresa (erp_servicos com
--   LC116) e emite com ele. O id de oficina não chega na prefeitura.
--
-- Locks do CEO:
--   1) valor da nota = SÓ serviços (mão de obra / serviços do diagnóstico). Peças ficam de fora (vão na
--      NF-e de produto, Fase 3). A tela mostra os dois números.
--   2) OS sem item de serviço aprovado → NFS-e NÃO sai, e a tela explica por quê.
--   3) resolução OS→fiscal explícita (esta função).
--
-- É só LEITURA (não grava nada). Reusa a MESMA aritmética da tela de diagnóstico:
--   subtotal = ROUND(preco * quantidade, 2); total = SUM(subtotal) FILTER (aprovado).  (RD-26)

CREATE OR REPLACE FUNCTION public.fn_os_nfse_preparar(p_os_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os record;
  v_qtd_serv int;
  v_val_serv numeric;
  v_val_pecas numeric;
  v_cli record;
  v_doc text; v_tipo text;
  v_servicos jsonb;
  v_default uuid;
BEGIN
  SELECT id, company_id, numero, cliente_id, cliente_nome, cliente_cnpj, defeito_relatado, descricao_servico
    INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nao_encontrada', 'erro', 'OS não encontrada.');
  END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso', 'erro', 'Sem acesso a esta empresa.');
  END IF;

  -- (lock 1) valor = só serviços aprovados; peças somadas à parte só pra MOSTRAR o que fica de fora
  SELECT
    COUNT(*) FILTER (WHERE tipo = 'servico' AND aprovado IS TRUE),
    COALESCE(SUM(ROUND(COALESCE(preco,0) * COALESCE(quantidade,1), 2))
             FILTER (WHERE tipo = 'servico' AND aprovado IS TRUE), 0),
    COALESCE(SUM(ROUND(COALESCE(preco,0) * COALESCE(quantidade,1), 2))
             FILTER (WHERE tipo = 'peca' AND aprovado IS TRUE), 0)
    INTO v_qtd_serv, v_val_serv, v_val_pecas
  FROM erp_os_diagnostico_item
  WHERE os_id = p_os_id AND company_id = v_os.company_id;

  -- (lock 2) sem serviço → não sai, com o motivo certo
  IF v_qtd_serv = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_servico',
      'valor_pecas', v_val_pecas,
      'erro', 'Esta OS não tem serviço aprovado no diagnóstico — NFS-e é nota de serviço. '
              'Peças saem na NF-e de produto (Fase 3), não aqui.');
  END IF;
  IF COALESCE(v_val_serv, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'servico_sem_preco',
      'valor_pecas', v_val_pecas,
      'erro', 'Os serviços aprovados desta OS estão sem preço. Defina o preço do serviço no diagnóstico '
              'antes de emitir a NFS-e.');
  END IF;

  -- serviço fiscal da empresa (erp_servicos com LC116 + código municipal). NÃO é o serviço de oficina.
  SELECT jsonb_agg(jsonb_build_object(
           'id', s.id,
           'descricao', COALESCE(NULLIF(s.descricao_detalhada, ''), s.descricao_resumida),
           'codigo_servico_municipio', s.codigo_servico_municipio,
           'codigo_lc116', s.codigo_lc116,
           'aliquota_iss', COALESCE(s.aliquota_iss, 0)
         ) ORDER BY s.descricao_resumida)
    INTO v_servicos
  FROM erp_servicos s
  WHERE s.company_id = v_os.company_id AND s.ativo IS TRUE
    AND COALESCE(s.codigo_lc116, '') <> '' AND COALESCE(s.codigo_servico_municipio, '') <> '';

  IF v_servicos IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_servico_fiscal',
      'valor_servicos', v_val_serv, 'valor_pecas', v_val_pecas,
      'erro', 'Nenhum serviço fiscal cadastrado com item LC116 + código municipal. '
              'Cadastre em Cadastros › Serviços antes de emitir a NFS-e.');
  END IF;

  -- default só quando há exatamente 1 (KGF tem 1); com mais de um, a tela deixa o operador escolher
  IF jsonb_array_length(v_servicos) = 1 THEN
    v_default := (v_servicos->0->>'id')::uuid;
  END IF;

  -- tomador (cliente da OS): documento do cadastro, com fallback pro cnpj gravado na própria OS
  IF v_os.cliente_id IS NOT NULL THEN
    SELECT COALESCE(cnpj_cpf, cpf_cnpj) AS doc, email, razao_social
      INTO v_cli FROM erp_clientes WHERE id = v_os.cliente_id;
  END IF;
  v_doc := regexp_replace(COALESCE(v_cli.doc, v_os.cliente_cnpj, ''), '[^0-9]', '', 'g');
  v_tipo := CASE WHEN length(v_doc) = 11 THEN 'cpf'
                 WHEN length(v_doc) = 14 THEN 'cnpj'
                 ELSE 'indefinido' END;

  RETURN jsonb_build_object(
    'ok', true,
    'os_numero', v_os.numero,
    'valor_servicos', v_val_serv,
    'valor_pecas', v_val_pecas,
    'qtd_servicos', v_qtd_serv,
    'descricao_sugerida',
      'Serviços — OS ' || COALESCE(v_os.numero, '') ||
      CASE WHEN COALESCE(v_os.defeito_relatado, '') <> '' THEN ': ' || left(v_os.defeito_relatado, 120) ELSE '' END,
    'tomador', jsonb_build_object(
      'documento', v_doc,
      'tipo', v_tipo,
      'nome', COALESCE(v_cli.razao_social, v_os.cliente_nome),
      'email', v_cli.email
    ),
    'servico_fiscal_id_default', v_default,
    'servicos_fiscais', v_servicos
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_nfse_preparar(uuid) TO authenticated;
