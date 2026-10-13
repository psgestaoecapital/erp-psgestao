-- Exportar produtos (.xlsx) — Cadastros › Produtos (CEO 13/10, urgente FCR/FC Pisos · rodrigo-code · faixa 30).
--
-- RD-26: reaproveita erp_produtos (colunas fiscais/custos/estoque), erp_estoque_movimentacoes (saldo por local) e as
-- CHAVES da planilha padrão de importação (src/lib/estoque/colunasImportacao.ts) — o arquivo exportado RE-IMPORTA.
-- Pilar 2: a defesa de CUSTO/VALOR é no BACKEND (RLS é por LINHA, não por COLUNA — ler a tabela direto mostraria o
-- custo). Esta RPC SECURITY DEFINER só devolve as colunas de custo/valor para quem pode vê-las, confere que o usuário
-- é da empresa (multi-tenant) e registra a exportação no log de auditoria (quem, quando, empresa, nº de linhas).
--
-- Aditiva: função NOVA + 1 chave de ajuda (RD-95). Não altera função de guarda. Sem DROP/DELETE/TRUNCATE.

-- ci-sem-guarda: fn_produtos_exportar — guarda a empresa por auth.uid() × tenant_user_roles (recusa quem não é da empresa) e só grava uma linha APPEND-ONLY no audit_log_global; não escreve dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_produtos_exportar(
  p_company_id uuid,
  p_situacao   text DEFAULT 'ativos',   -- 'ativos' | 'inativos' | 'todos'
  p_busca      text DEFAULT NULL,        -- nome / código / NCM
  p_grupo      text DEFAULT NULL,
  p_unidade    text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_papel text;
  v_custo boolean;
  v_email text;
  v_emp   record;
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_total int;
  v_valor numeric;
  v_prod  jsonb;
  v_loc   jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  IF p_situacao NOT IN ('ativos','inativos','todos') THEN p_situacao := 'ativos'; END IF;

  -- multi-tenant: só exporta empresa da qual o usuário é membro ativo
  SELECT role INTO v_papel
    FROM tenant_user_roles WHERE user_id = v_uid AND company_id = p_company_id AND is_active LIMIT 1;
  IF v_papel IS NULL THEN RAISE EXCEPTION 'sem_acesso_a_empresa' USING ERRCODE = '42501'; END IF;

  -- custo/valor só para quem pode ver (encarregado/equipe de campo = Auxiliar/mecânico NÃO veem valores)
  v_custo := v_papel NOT IN ('CLIENT_OPERATOR', 'OFICINA_MECANICO');
  SELECT razao_social, nome_fantasia, cnpj INTO v_emp FROM companies WHERE id = p_company_id;
  SELECT email INTO v_email FROM users WHERE id = v_uid;

  WITH base AS (
    SELECT p.* FROM erp_produtos p
     WHERE p.company_id = p_company_id
       AND (p_situacao = 'todos'
            OR (p_situacao = 'ativos'   AND p.ativo)
            OR (p_situacao = 'inativos' AND NOT p.ativo))
       AND (p_grupo   IS NULL OR p.grupo   = p_grupo)
       AND (p_unidade IS NULL OR p.unidade = p_unidade)
       AND (v_busca IS NULL
            OR p.nome ILIKE '%' || v_busca || '%'
            OR p.codigo ILIKE '%' || v_busca || '%'
            OR COALESCE(p.ncm,'') ILIKE '%' || v_busca || '%')
  )
  SELECT count(*)::int,
         COALESCE(round(sum(estoque_atual * preco_custo_medio), 2), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           -- chaves da planilha de importação primeiro (round-trip) + colunas extras (o importador ignora as que não conhece)
           'codigo', codigo, 'codigo_barras', codigo_barras, 'nome', nome, 'tipo', tipo,
           'categoria', categoria, 'subcategoria', subcategoria, 'marca', marca, 'grupo', grupo,
           'unidade', unidade, 'unidade_compra', unidade_compra, 'fator_conversao', fator_conversao,
           'ativo', CASE WHEN ativo THEN 'sim' ELSE 'nao' END,
           'preco_venda', preco_venda,
           'custo_medio',          CASE WHEN v_custo THEN preco_custo_medio END,
           'preco_custo',          CASE WHEN v_custo THEN preco_custo END,
           'comissao_percentual',  CASE WHEN v_custo THEN comissao_percentual END,
           'estoque_atual', estoque_atual, 'estoque_minimo', estoque_minimo, 'estoque_maximo', estoque_maximo,
           'localizacao', localizacao,
           'valor_estoque',        CASE WHEN v_custo THEN round(estoque_atual * preco_custo_medio, 2) END,
           'ncm', ncm, 'cest', cest, 'origem', origem,
           'cfop_venda', cfop_venda, 'cfop_venda_interestadual', cfop_venda_interestadual, 'cfop_compra', cfop_compra,
           'cst_icms', cst_icms, 'cst_pis', cst_pis, 'cst_cofins', cst_cofins,
           'aliquota_icms', aliquota_icms, 'aliquota_ipi', aliquota_ipi, 'aliquota_pis', aliquota_pis, 'aliquota_cofins', aliquota_cofins,
           'tipo_item_sped', tipo_item_sped,
           'fornecedor_padrao_nome', fornecedor_padrao_nome, 'prazo_entrega_dias', prazo_entrega_dias,
           'peso_bruto', peso_bruto, 'peso_liquido', peso_liquido,
           'largura_cm', largura_cm, 'altura_cm', altura_cm, 'profundidade_cm', profundidade_cm,
           'controla_lote', CASE WHEN controla_lote THEN 'sim' ELSE 'nao' END,
           'controla_validade', CASE WHEN controla_validade THEN 'sim' ELSE 'nao' END,
           'id', id) ORDER BY codigo), '[]'::jsonb)
    INTO v_total, v_valor, v_prod
    FROM base;

  -- aba "Estoque por local": saldo = último quantidade_depois por (produto, local)
  WITH mov AS (
    SELECT DISTINCT ON (m.produto_id, m.local_id) m.produto_id, m.local_id, m.quantidade_depois AS saldo
      FROM erp_estoque_movimentacoes m
     WHERE m.company_id = p_company_id AND m.local_id IS NOT NULL
     ORDER BY m.produto_id, m.local_id, m.data_movimento DESC, m.created_at DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'codigo', p.codigo, 'nome', p.nome, 'local', l.nome, 'saldo', mov.saldo,
           'custo_medio', CASE WHEN v_custo THEN p.preco_custo_medio END,
           'valor',       CASE WHEN v_custo THEN round(mov.saldo * p.preco_custo_medio, 2) END)
         ORDER BY p.codigo, l.nome), '[]'::jsonb)
    INTO v_loc
    FROM mov
    JOIN erp_produtos p       ON p.id = mov.produto_id
    JOIN erp_estoque_locais l ON l.id = mov.local_id
   WHERE p.company_id = p_company_id;

  -- auditoria (append-only): quem exportou, quando, empresa, nº de linhas e os filtros
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, v_uid, v_email, 'erp_produtos', NULL, 'EXPORTOU',
          jsonb_build_object('linhas', v_total,
            'valor_estoque', CASE WHEN v_custo THEN v_valor END,
            'situacao', p_situacao, 'busca', v_busca, 'grupo', p_grupo, 'unidade', p_unidade,
            'pode_ver_custo', v_custo));

  RETURN jsonb_build_object('ok', true,
    'empresa', jsonb_build_object('razao_social', v_emp.razao_social, 'nome_fantasia', v_emp.nome_fantasia, 'cnpj', v_emp.cnpj),
    'gerado_em', now(),
    'pode_ver_custo', v_custo,
    'total_itens', v_total,
    'valor_estoque', CASE WHEN v_custo THEN v_valor END,
    'produtos', v_prod,
    'estoque_por_local', v_loc);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_produtos_exportar(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_exportar(uuid, text, text, text, text) TO authenticated, service_role;

-- RD-95: "?" do botão Exportar (o que vem no arquivo + que ele re-importa). Chave publicada em erp_ajuda_campo.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES (
  'cadastros.produtos.exportar', '/dashboard/cadastros/produtos', 'Produtos', 'Baixar produtos (.xlsx)',
  'Clique para baixar uma planilha com TODOS os produtos da empresa selecionada, respeitando os filtros da tela (por padrão, só os ativos).',
  'Conferir o cadastro com o sistema antigo e com o contador, e corrigir em massa no Excel. O arquivo volta pela "Importar estoque (planilha)" — baixe, ajuste e importe de novo; as colunas são as mesmas da planilha padrão.',
  'produtos_FCR_20261013_1430.xlsx, com as abas "Produtos" e "Estoque por local".',
  'Mexer no nome das colunas-chave (codigo, nome) na hora de corrigir: isso impede a reimportação. Mantenha a linha de chaves como veio. Valores (custo) só aparecem para quem tem permissão de ver custo.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
