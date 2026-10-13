-- Chamado #20 · Fase 3: NF-e de PRODUTO (modelo 55) a partir da OS — as peças.
--
-- Complementa a Fase 2 (NFS-e = serviços). Aqui saem as PEÇAS. Reusa o modo `manual` do
-- /api/fiscal/nfe/emitir (o caminho que já emitiu as NF-e de produto), que usa erp_produtos como
-- fonte fiscal (NCM/CFOP/origem/ICMS). RD-26.
--
-- Realidade provada no dado (RD-38): a esmagadora maioria das peças da OS ainda é TEXTO LIVRE
-- (sem produto_id) — elas viram produto real só depois de entrar a NF de compra vinculada à OS. NF-e
-- exige produto de catálogo com NCM. Então:
--   §2.2  peça texto-livre (ou produto sem NCM) BLOQUEIA — não entra na nota, e a tela explica por quê.
--   §2.1  o operador escolhe quais peças emitíveis vão na nota.
--   §2.3/§8.1  se o total da NF divergir do total de peças da OS, o operador JUSTIFICA (só quando diverge —
--         rito vazio ensina a burlar). A justificativa fica no REGISTRO da nota (recuperável depois),
--         com o valor esperado. Zero item selecionado = BLOQUEIO, não justificativa (não existe nota sem item).
--
-- Esta função é só LEITURA: resolve destinatário + itens emitíveis + bloqueios + o valor esperado
-- (total das peças aprovadas da OS) pra UI montar a seleção e a trava de valor.

-- 1) Persistência da justificativa NO registro da nota (detalhe #1 do CEO: recuperável depois).
ALTER TABLE public.erp_nfe_emitidas
  ADD COLUMN IF NOT EXISTS os_id uuid,
  ADD COLUMN IF NOT EXISTS justificativa_divergencia text,
  ADD COLUMN IF NOT EXISTS valor_esperado_os numeric;

CREATE INDEX IF NOT EXISTS idx_erp_nfe_emitidas_os_id ON public.erp_nfe_emitidas(os_id) WHERE os_id IS NOT NULL;

-- 2) Resolver OS→NF-e de produto.
--    NB: campos do cliente em variáveis ESCALARES (não record): uma OS de balcão pode ter cliente_nome
--    sem cliente_id, e um record não-atribuído estoura "record is not assigned yet" ao ler o campo.
CREATE OR REPLACE FUNCTION public.fn_os_nfe_preparar(p_os_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_doc text; v_tipo text;
  v_c_razao text; v_c_doc text; v_c_email text; v_c_logr text; v_c_num text;
  v_c_bairro text; v_c_cidade text; v_c_uf text; v_c_cep text; v_c_ibge text;
  v_emitiveis jsonb; v_texto_livre jsonb; v_bloq_fiscal jsonb;
  v_val_esperado numeric; v_val_emitivel numeric; v_qtd_peca int;
  v_dest_faltando text[] := ARRAY[]::text[];
BEGIN
  SELECT id, company_id, numero, cliente_id, cliente_nome, cliente_cnpj, defeito_relatado
    INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nao_encontrada', 'erro', 'OS não encontrada.'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso', 'erro', 'Sem acesso a esta empresa.'); END IF;

  -- total das peças aprovadas da OS (o "esperado" da trava de valor — inclui texto-livre, porque
  -- excluir uma peça que não pode sair É uma divergência que o operador precisa justificar)
  SELECT COUNT(*) FILTER (WHERE tipo='peca' AND aprovado IS TRUE),
         COALESCE(SUM(ROUND(COALESCE(preco,0)*COALESCE(quantidade,1),2)) FILTER (WHERE tipo='peca' AND aprovado IS TRUE), 0)
    INTO v_qtd_peca, v_val_esperado
  FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND company_id = v_os.company_id;

  IF v_qtd_peca = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_peca',
      'erro', 'Esta OS não tem peça aprovada — NF-e de produto é para mercadoria. (Serviços saem na NFS-e.)'); END IF;

  -- peças emitíveis: aprovadas, com produto_id de catálogo E com NCM válido (8 dígitos)
  SELECT jsonb_agg(jsonb_build_object(
           'item_id', i.id, 'produto_id', i.produto_id,
           'descricao', COALESCE(NULLIF(p.descricao,''), p.nome, i.descricao),
           'quantidade', COALESCE(i.quantidade,1),
           'preco_unitario', COALESCE(i.preco,0),
           'subtotal', ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2),
           'ncm', p.ncm, 'cfop', COALESCE(p.cfop_venda,'5102'), 'unidade', COALESCE(p.unidade,'UN')
         ) ORDER BY i.ordem, i.created_at)
    INTO v_emitiveis
  FROM erp_os_diagnostico_item i
  JOIN erp_produtos p ON p.id = i.produto_id AND p.company_id = v_os.company_id
  WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
    AND i.tipo='peca' AND i.aprovado IS TRUE
    AND COALESCE(i.preco,0) > 0
    AND p.ncm IS NOT NULL AND regexp_replace(p.ncm,'[^0-9]','','g') ~ '^[0-9]{8}$';

  -- bloqueadas por texto-livre (sem produto_id) — §2.2, o caso dominante
  SELECT jsonb_agg(jsonb_build_object('descricao', i.descricao, 'subtotal', ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2)) ORDER BY i.ordem)
    INTO v_texto_livre
  FROM erp_os_diagnostico_item i
  WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
    AND i.tipo='peca' AND i.aprovado IS TRUE AND i.produto_id IS NULL;

  -- bloqueadas por produto sem NCM (tem catálogo, falta o fiscal) — o operador corrige no cadastro do produto
  SELECT jsonb_agg(jsonb_build_object('descricao', COALESCE(NULLIF(p.descricao,''), p.nome, i.descricao)) ORDER BY i.ordem)
    INTO v_bloq_fiscal
  FROM erp_os_diagnostico_item i
  JOIN erp_produtos p ON p.id = i.produto_id AND p.company_id = v_os.company_id
  WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
    AND i.tipo='peca' AND i.aprovado IS TRUE
    AND (COALESCE(i.preco,0) <= 0 OR p.ncm IS NULL OR regexp_replace(COALESCE(p.ncm,''),'[^0-9]','','g') !~ '^[0-9]{8}$');

  v_val_emitivel := COALESCE((SELECT SUM((e->>'subtotal')::numeric) FROM jsonb_array_elements(COALESCE(v_emitiveis,'[]'::jsonb)) e), 0);

  -- destinatário (cliente da OS) — NF-e exige doc + endereço completo
  IF v_os.cliente_id IS NOT NULL THEN
    SELECT razao_social, COALESCE(cnpj_cpf, cpf_cnpj), email, logradouro, numero, bairro, cidade, uf, cep, codigo_ibge_municipio
      INTO v_c_razao, v_c_doc, v_c_email, v_c_logr, v_c_num, v_c_bairro, v_c_cidade, v_c_uf, v_c_cep, v_c_ibge
      FROM erp_clientes WHERE id = v_os.cliente_id;
  END IF;
  v_doc := regexp_replace(COALESCE(v_c_doc, v_os.cliente_cnpj, ''), '[^0-9]', '', 'g');
  v_tipo := CASE WHEN length(v_doc) = 14 THEN 'cnpj' WHEN length(v_doc) = 11 THEN 'cpf' ELSE 'indefinido' END;
  IF length(v_doc) NOT IN (11,14) THEN v_dest_faltando := array_append(v_dest_faltando, 'CNPJ/CPF'); END IF;
  IF COALESCE(v_c_logr,'') = '' THEN v_dest_faltando := array_append(v_dest_faltando, 'endereço (logradouro)'); END IF;
  IF COALESCE(v_c_cep,'') = ''  THEN v_dest_faltando := array_append(v_dest_faltando, 'CEP'); END IF;
  IF COALESCE(v_c_uf,'') = ''   THEN v_dest_faltando := array_append(v_dest_faltando, 'UF'); END IF;
  IF COALESCE(v_c_cidade,'') = '' THEN v_dest_faltando := array_append(v_dest_faltando, 'cidade'); END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'os_numero', v_os.numero,
    'valor_esperado', v_val_esperado,
    'valor_emitivel', v_val_emitivel,
    'qtd_pecas', v_qtd_peca,
    'itens_emitiveis', COALESCE(v_emitiveis, '[]'::jsonb),
    'itens_texto_livre', COALESCE(v_texto_livre, '[]'::jsonb),
    'itens_sem_fiscal', COALESCE(v_bloq_fiscal, '[]'::jsonb),
    'destinatario', jsonb_build_object(
      'nome', COALESCE(v_c_razao, v_os.cliente_nome),
      'documento', v_doc, 'tipo', v_tipo, 'email', v_c_email,
      'logradouro', v_c_logr, 'numero', v_c_num, 'bairro', v_c_bairro,
      'cidade', v_c_cidade, 'uf', v_c_uf, 'cep', v_c_cep, 'codigo_municipio', v_c_ibge,
      'ok', (array_length(v_dest_faltando,1) IS NULL),
      'faltando', v_dest_faltando
    )
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_nfe_preparar(uuid) TO authenticated;

-- 3) FIX Fase 2 (mesma classe de bug): fn_os_nfse_preparar usava um record v_cli para o cliente e
--    estouraria "record is not assigned yet" numa OS de balcão (cliente_nome sem cliente_id). Reescreve
--    com variáveis escalares. Comportamento idêntico quando há cliente_id; agora não quebra sem ele.
CREATE OR REPLACE FUNCTION public.fn_os_nfse_preparar(p_os_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_qtd_serv int; v_val_serv numeric; v_val_pecas numeric;
  v_c_doc text; v_c_email text; v_c_razao text; v_doc text; v_tipo text;
  v_servicos jsonb; v_default uuid;
BEGIN
  SELECT id, company_id, numero, cliente_id, cliente_nome, cliente_cnpj, defeito_relatado, descricao_servico
    INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nao_encontrada', 'erro', 'OS não encontrada.'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso', 'erro', 'Sem acesso a esta empresa.'); END IF;
  SELECT
    COUNT(*) FILTER (WHERE tipo = 'servico' AND aprovado IS TRUE),
    COALESCE(SUM(ROUND(COALESCE(preco,0) * COALESCE(quantidade,1), 2)) FILTER (WHERE tipo = 'servico' AND aprovado IS TRUE), 0),
    COALESCE(SUM(ROUND(COALESCE(preco,0) * COALESCE(quantidade,1), 2)) FILTER (WHERE tipo = 'peca' AND aprovado IS TRUE), 0)
    INTO v_qtd_serv, v_val_serv, v_val_pecas
  FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND company_id = v_os.company_id;
  IF v_qtd_serv = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_servico', 'valor_pecas', v_val_pecas,
      'erro', 'Esta OS não tem serviço aprovado no diagnóstico — NFS-e é nota de serviço. Peças saem na NF-e de produto (Fase 3), não aqui.'); END IF;
  IF COALESCE(v_val_serv, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'servico_sem_preco', 'valor_pecas', v_val_pecas,
      'erro', 'Os serviços aprovados desta OS estão sem preço. Defina o preço do serviço no diagnóstico antes de emitir a NFS-e.'); END IF;
  SELECT jsonb_agg(jsonb_build_object('id', s.id,
           'descricao', COALESCE(NULLIF(s.descricao_detalhada, ''), s.descricao_resumida),
           'codigo_servico_municipio', s.codigo_servico_municipio, 'codigo_lc116', s.codigo_lc116,
           'aliquota_iss', COALESCE(s.aliquota_iss, 0)) ORDER BY s.descricao_resumida)
    INTO v_servicos FROM erp_servicos s
   WHERE s.company_id = v_os.company_id AND s.ativo IS TRUE
     AND COALESCE(s.codigo_lc116, '') <> '' AND COALESCE(s.codigo_servico_municipio, '') <> '';
  IF v_servicos IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_servico_fiscal', 'valor_servicos', v_val_serv, 'valor_pecas', v_val_pecas,
      'erro', 'Nenhum serviço fiscal cadastrado com item LC116 + código municipal. Cadastre em Cadastros › Serviços antes de emitir a NFS-e.'); END IF;
  IF jsonb_array_length(v_servicos) = 1 THEN v_default := (v_servicos->0->>'id')::uuid; END IF;
  IF v_os.cliente_id IS NOT NULL THEN
    SELECT COALESCE(cnpj_cpf, cpf_cnpj), email, razao_social
      INTO v_c_doc, v_c_email, v_c_razao FROM erp_clientes WHERE id = v_os.cliente_id; END IF;
  v_doc := regexp_replace(COALESCE(v_c_doc, v_os.cliente_cnpj, ''), '[^0-9]', '', 'g');
  v_tipo := CASE WHEN length(v_doc) = 14 THEN 'cnpj' WHEN length(v_doc) = 11 THEN 'cpf' ELSE 'indefinido' END;
  RETURN jsonb_build_object('ok', true, 'os_numero', v_os.numero,
    'valor_servicos', v_val_serv, 'valor_pecas', v_val_pecas, 'qtd_servicos', v_qtd_serv,
    'descricao_sugerida', 'Serviços — OS ' || COALESCE(v_os.numero, '') ||
      CASE WHEN COALESCE(v_os.defeito_relatado, '') <> '' THEN ': ' || left(v_os.defeito_relatado, 120) ELSE '' END,
    'tomador', jsonb_build_object('documento', v_doc, 'tipo', v_tipo, 'nome', COALESCE(v_c_razao, v_os.cliente_nome), 'email', v_c_email),
    'servico_fiscal_id_default', v_default, 'servicos_fiscais', v_servicos);
END $function$;
