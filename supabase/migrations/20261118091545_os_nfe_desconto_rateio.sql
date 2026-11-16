-- #7031 · Oficina: o desconto da OS deve refletir na NF-e (desconto geral rateado por item).
-- Code: rodrigo-code
--
-- HOJE: fn_os_nfe_preparar monta os itens emitíveis pelo valor CHEIO (preco × quantidade) e NUNCA lê
-- erp_os.desconto_valor. A NF-e sai com o valor bruto e desconto R$ 0,00, enquanto o cliente paga o
-- "A cobrar" já com desconto (prova OS-2026-0249/Gean: itens R$ 639,10, desconto R$ 39,10, NF saiu R$ 639,10).
--
-- AQUI (aditivo, só leitura, SECURITY DEFINER inalterada): a função passa a RATEAR o desconto geral da OS
-- proporcionalmente entre TODOS os itens aprovados (base = Σ dos subtotais aprovados, todos os tipos) e devolve,
-- em cada item emitível, o campo 'desconto_rateado' (sua parcela do desconto). O botão de emissão soma a parcela
-- dos itens SELECIONADOS e manda como desconto DA NOTA (manual.totais.desconto → focusnfe req.totais.desconto),
-- exatamente o mesmo campo note-level que a devolução já usa (vDesc). A estrutura do item (vUnCom/vProd brutos)
-- NÃO muda — o desconto vai no total da nota, sem o descasamento vProd≠vUnCom×qCom que a SEFAZ rejeita.
--
-- Rateio por item (não pela OS inteira) para que a desseleção de itens no diálogo escale o desconto corretamente.
-- Trava de segurança: a parcela nunca passa do subtotal do item (net ≥ 0). Sem desconto na OS → desconto_rateado = 0
-- (comportamento idêntico ao de hoje). A tributação por item continua vindo do cadastro do produto.

CREATE OR REPLACE FUNCTION public.fn_os_nfe_preparar(p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_doc text; v_tipo text;
  v_c_razao text; v_c_doc text; v_c_email text; v_c_logr text; v_c_num text;
  v_c_bairro text; v_c_cidade text; v_c_uf text; v_c_cep text; v_c_ibge text;
  v_emitiveis jsonb; v_texto_livre jsonb; v_bloq_fiscal jsonb;
  v_val_esperado numeric; v_val_emitivel numeric; v_qtd_peca int;
  v_desconto numeric; v_base_rateio numeric; v_desc_emitivel numeric;  -- #7031
  v_dest_faltando text[] := ARRAY[]::text[];
BEGIN
  SELECT id, company_id, numero, cliente_id, cliente_nome, cliente_cnpj, defeito_relatado,
         COALESCE(desconto_valor, 0) AS desconto_valor  -- #7031
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

  -- #7031 · base do rateio = Σ dos subtotais de TODOS os itens aprovados da OS (peças e serviços):
  -- "ratear o desconto geral proporcionalmente entre todos os itens da OS". Cada item carrega sua parcela;
  -- a NF-e leva apenas a soma das parcelas dos itens que ela emite (a NFS-e leva a parcela dos serviços).
  v_desconto := COALESCE(v_os.desconto_valor, 0);
  SELECT COALESCE(SUM(ROUND(COALESCE(preco,0)*COALESCE(quantidade,1),2)), 0)
    INTO v_base_rateio
  FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND company_id = v_os.company_id AND aprovado IS TRUE;

  -- peças emitíveis: aprovadas, com produto_id de catálogo E com NCM válido (8 dígitos)
  -- #7031 · 'desconto_rateado' = parcela do desconto geral da OS proporcional ao subtotal do item. Para não
  -- sobrar/faltar centavo (chamado: "a soma dos descontos por item deve ser igual ao desconto geral, sem
  -- diferença de centavos; a diferença de arredondamento fica no último item"), o ÚLTIMO item emitível
  -- absorve o resíduo entre o alvo (parcela das peças sobre o desconto) e a soma dos arredondamentos por item.
  WITH emit_src AS (
    SELECT i.id, i.produto_id,
           COALESCE(NULLIF(p.descricao,''), p.nome, i.descricao) AS descricao,
           COALESCE(i.quantidade,1) AS quantidade,
           COALESCE(i.preco,0) AS preco_unitario,
           ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2) AS subtotal,
           p.ncm, COALESCE(p.cfop_venda,'5102') AS cfop, COALESCE(p.unidade,'UN') AS unidade,
           i.ordem, i.created_at
    FROM erp_os_diagnostico_item i
    JOIN erp_produtos p ON p.id = i.produto_id AND p.company_id = v_os.company_id
    WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
      AND i.tipo='peca' AND i.aprovado IS TRUE
      AND COALESCE(i.preco,0) > 0
      AND p.ncm IS NOT NULL AND regexp_replace(p.ncm,'[^0-9]','','g') ~ '^[0-9]{8}$'
  ),
  emit_calc AS (
    SELECT e.*,
           ROW_NUMBER() OVER (ORDER BY e.ordem, e.created_at) AS rn,
           COUNT(*)     OVER () AS total_rn,
           SUM(e.subtotal) OVER () AS soma_emit,
           CASE WHEN v_desconto > 0 AND v_base_rateio > 0
                THEN LEAST(ROUND(v_desconto * e.subtotal / v_base_rateio, 2), e.subtotal) ELSE 0 END AS d_item
    FROM emit_src e
  ),
  emit_fin AS (
    SELECT c.*,
           CASE WHEN v_desconto > 0 AND v_base_rateio > 0
                THEN LEAST(ROUND(v_desconto * c.soma_emit / v_base_rateio, 2), c.soma_emit) ELSE 0 END AS alvo_emit,
           SUM(c.d_item) OVER () AS soma_ditem
    FROM emit_calc c
  )
  SELECT jsonb_agg(jsonb_build_object(
           'item_id', id, 'produto_id', produto_id, 'descricao', descricao,
           'quantidade', quantidade, 'preco_unitario', preco_unitario, 'subtotal', subtotal,
           'desconto_rateado', GREATEST(0, LEAST(
             d_item + CASE WHEN rn = total_rn THEN (alvo_emit - soma_ditem) ELSE 0 END,
             subtotal)),
           'ncm', ncm, 'cfop', cfop, 'unidade', unidade
         ) ORDER BY rn)
    INTO v_emitiveis
  FROM emit_fin;

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
  -- #7031 · desconto total que a NF-e (peças emitíveis) carrega = Σ das parcelas dos itens emitíveis
  v_desc_emitivel := COALESCE((SELECT SUM((e->>'desconto_rateado')::numeric) FROM jsonb_array_elements(COALESCE(v_emitiveis,'[]'::jsonb)) e), 0);

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
    'desconto_os', v_desconto,              -- #7031 · desconto geral da OS (R$)
    'desconto_emitivel', v_desc_emitivel,   -- #7031 · parcela que a NF-e (peças) carrega
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

-- Guarda da função (check_fn_guards · regra 1): SECURITY DEFINER não pode ser chamada por anon.
-- Idempotente — anon já não tinha EXECUTE (grants: postgres, authenticated, service_role); explicitado aqui
-- porque CREATE OR REPLACE acima recria a função e o gate exige o REVOKE na mesma migration.
REVOKE ALL ON FUNCTION public.fn_os_nfe_preparar(uuid) FROM anon;
