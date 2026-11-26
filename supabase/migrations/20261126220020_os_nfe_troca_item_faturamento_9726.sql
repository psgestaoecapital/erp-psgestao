-- #9726 (etapa final / jordana-manual) · "Trocar item de faturamento" na NF-e de peças da OS.
-- NÚCLEO FISCAL (NF-e de OS), mas ISOLADO por configuração: só empresas com
-- erp_oficina_parametros.modo_baixa_estoque = 'baixar_estoque' (hoje só a Mecânica 163). Alto cuidado.
-- Aditiva/idempotente. Não altera o item da OS, nem a baixa de estoque, nem o histórico do veículo.
--
-- Regra (Jordana 24/11):
--  - Modo 'baixar_estoque': o operador pode trocar, por linha, o item que vai na NF-e por outro item de
--    estoque REAL ('00'). A troca vale SÓ para a nota. Item '99 - Outras' (frio) NÃO pode ser faturado.
--  - Modo 'faturamento' (demais empresas): tela e emissão ficam exatamente como hoje (sem troca, sem bloqueio '99').
--  - A emissão NÃO baixa estoque (a rota /api/fiscal/nfe/emitir já não baixa); a baixa é só pelo botão.
--
-- Prova (RD-38, 24/11): 163 tem produtos tipo_item_sped 00=7457, 99=4642, 07=25, 08=1. fn_os_nfe_preparar
-- montava itens_emitiveis sem olhar tipo_item_sped. A rota de emissão não movimenta estoque.

-- ============================================================================================
-- 1) Vínculo da troca de item de faturamento (por OS × item da OS). NÃO altera erp_os_diagnostico_item.
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.erp_os_nfe_item_faturamento (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL,
  os_id                  uuid NOT NULL,
  item_os_id             uuid NOT NULL,   -- erp_os_diagnostico_item.id (o item realmente usado)
  produto_origem_id      uuid NOT NULL,   -- produto usado (do item da OS) — fica para o espelho "usado: X"
  produto_faturamento_id uuid NOT NULL,   -- produto '00' que vai na NF-e ("faturado como: Y")
  definido_por           uuid,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (os_id, item_os_id)
);
COMMENT ON TABLE public.erp_os_nfe_item_faturamento IS
  '#9726 · troca do item que vai na NF-e de peças (só modo baixar_estoque). Não altera o item da OS nem o estoque; guarda usado (origem) × faturado (faturamento).';

ALTER TABLE public.erp_os_nfe_item_faturamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS os_nfe_item_fat_select ON public.erp_os_nfe_item_faturamento;
CREATE POLICY os_nfe_item_fat_select ON public.erp_os_nfe_item_faturamento
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
-- escrita só pela RPC guardada (SECURITY DEFINER) / service_role; authenticated não tem policy de escrita.
REVOKE ALL ON public.erp_os_nfe_item_faturamento FROM anon;
GRANT SELECT ON public.erp_os_nfe_item_faturamento TO authenticated;
GRANT ALL ON public.erp_os_nfe_item_faturamento TO service_role;

CREATE INDEX IF NOT EXISTS ix_os_nfe_item_fat_os ON public.erp_os_nfe_item_faturamento (os_id);

-- ============================================================================================
-- 2) Definir/limpar a troca (guardada): só modo baixar_estoque, só produto '00' com NCM válido.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_os_nfe_item_faturamento_definir(
  p_os_id uuid, p_item_os_id uuid, p_produto_faturamento_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_modo text; v_item record; v_pf record;
BEGIN
  SELECT id, company_id FROM erp_os WHERE id = p_os_id INTO v_os;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada.'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa.'); END IF;

  SELECT COALESCE(modo_baixa_estoque, 'faturamento') INTO v_modo
    FROM erp_oficina_parametros WHERE company_id = v_os.company_id;
  IF COALESCE(v_modo, 'faturamento') <> 'baixar_estoque' THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'A troca do item de faturamento só vale para empresas que baixam o estoque pela OS.'); END IF;

  SELECT id, produto_id FROM erp_os_diagnostico_item
    WHERE id = p_item_os_id AND os_id = p_os_id AND company_id = v_os.company_id INTO v_item;
  IF v_item IS NULL OR v_item.produto_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Item da OS não encontrado (ou sem produto de catálogo).'); END IF;

  -- limpar a troca (voltar ao item original)
  IF p_produto_faturamento_id IS NULL THEN
    DELETE FROM erp_os_nfe_item_faturamento WHERE os_id = p_os_id AND item_os_id = p_item_os_id;
    RETURN jsonb_build_object('ok', true, 'removido', true);
  END IF;

  -- validar o produto de faturamento: da empresa, tipo_item_sped '00' e NCM de 8 dígitos
  SELECT id, tipo_item_sped, ncm FROM erp_produtos
    WHERE id = p_produto_faturamento_id AND company_id = v_os.company_id INTO v_pf;
  IF v_pf IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Produto de faturamento não é desta empresa.'); END IF;
  IF COALESCE(v_pf.tipo_item_sped, '') <> '00' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O item de faturamento precisa ser um produto de estoque real (tipo 00).'); END IF;
  IF v_pf.ncm IS NULL OR regexp_replace(COALESCE(v_pf.ncm,''), '[^0-9]', '', 'g') !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O produto de faturamento precisa ter NCM válido (8 dígitos).'); END IF;

  INSERT INTO erp_os_nfe_item_faturamento (company_id, os_id, item_os_id, produto_origem_id, produto_faturamento_id, definido_por)
  VALUES (v_os.company_id, p_os_id, p_item_os_id, v_item.produto_id, p_produto_faturamento_id, auth.uid())
  ON CONFLICT (os_id, item_os_id) DO UPDATE
    SET produto_faturamento_id = EXCLUDED.produto_faturamento_id,
        produto_origem_id = EXCLUDED.produto_origem_id,
        definido_por = EXCLUDED.definido_por,
        atualizado_em = now();
  RETURN jsonb_build_object('ok', true, 'trocado', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_os_nfe_item_faturamento_definir(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nfe_item_faturamento_definir(uuid,uuid,uuid) TO authenticated, service_role;

-- ============================================================================================
-- 3) fn_os_nfe_preparar: aplica a troca (só modo baixar_estoque), anota origem/faturamento/sped/bloqueio.
--    Modo 'faturamento' fica IDÊNTICO a hoje (sem troca, sem bloqueio '99').
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_os_nfe_preparar(p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_doc text; v_tipo text; v_modo text; v_troca boolean;
  v_c_razao text; v_c_doc text; v_c_email text; v_c_logr text; v_c_num text;
  v_c_bairro text; v_c_cidade text; v_c_uf text; v_c_cep text; v_c_ibge text;
  v_emitiveis jsonb; v_texto_livre jsonb; v_bloq_fiscal jsonb;
  v_val_esperado numeric; v_val_emitivel numeric; v_qtd_peca int;
  v_desconto numeric; v_base_rateio numeric; v_desc_emitivel numeric;
  v_dest_faltando text[] := ARRAY[]::text[];
  v_bloq_sped int;
BEGIN
  SELECT id, company_id, numero, cliente_id, cliente_nome, cliente_cnpj, defeito_relatado,
         COALESCE(desconto_valor, 0) AS desconto_valor
    INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nao_encontrada', 'erro', 'OS não encontrada.'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso', 'erro', 'Sem acesso a esta empresa.'); END IF;

  SELECT COALESCE(modo_baixa_estoque, 'faturamento') INTO v_modo
    FROM erp_oficina_parametros WHERE company_id = v_os.company_id;
  v_troca := COALESCE(v_modo, 'faturamento') = 'baixar_estoque';  -- só este modo permite troca e bloqueia '99'

  SELECT COUNT(*) FILTER (WHERE tipo='peca' AND aprovado IS TRUE),
         COALESCE(SUM(ROUND(COALESCE(preco,0)*COALESCE(quantidade,1),2)) FILTER (WHERE tipo='peca' AND aprovado IS TRUE), 0)
    INTO v_qtd_peca, v_val_esperado
  FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND company_id = v_os.company_id;

  IF v_qtd_peca = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_peca',
      'erro', 'Esta OS não tem peça aprovada — NF-e de produto é para mercadoria. (Serviços saem na NFS-e.)'); END IF;

  v_desconto := COALESCE(v_os.desconto_valor, 0);
  SELECT COALESCE(SUM(ROUND(COALESCE(preco,0)*COALESCE(quantidade,1),2)), 0)
    INTO v_base_rateio
  FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND company_id = v_os.company_id AND aprovado IS TRUE;

  -- peças emitíveis: aprovadas, com produto_id de catálogo. O produto de FATURAMENTO (origem OU troca,
  -- só no modo baixar_estoque) define NCM/CFOP/unidade/sped e precisa ter NCM de 8 dígitos.
  WITH emit_src AS (
    SELECT i.id, i.produto_id AS produto_origem_id,
           COALESCE(f.produto_faturamento_id, i.produto_id) AS produto_faturamento_id,
           COALESCE(NULLIF(po.descricao,''), po.nome, i.descricao) AS descricao,
           CASE WHEN f.produto_faturamento_id IS NOT NULL
                THEN COALESCE(NULLIF(pf.descricao,''), pf.nome) END AS faturado_como,
           COALESCE(i.quantidade,1) AS quantidade,
           COALESCE(i.preco,0) AS preco_unitario,
           ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2) AS subtotal,
           pf.ncm, COALESCE(pf.cfop_venda,'5102') AS cfop, COALESCE(pf.unidade,'UN') AS unidade,
           COALESCE(pf.tipo_item_sped,'') AS tipo_item_sped,
           (v_troca AND COALESCE(pf.tipo_item_sped,'') = '99') AS faturamento_bloqueado,
           i.ordem, i.created_at
    FROM erp_os_diagnostico_item i
    JOIN erp_produtos po ON po.id = i.produto_id AND po.company_id = v_os.company_id
    LEFT JOIN erp_os_nfe_item_faturamento f
           ON v_troca AND f.os_id = p_os_id AND f.item_os_id = i.id AND f.company_id = v_os.company_id
    JOIN erp_produtos pf ON pf.id = COALESCE(f.produto_faturamento_id, i.produto_id) AND pf.company_id = v_os.company_id
    WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
      AND i.tipo='peca' AND i.aprovado IS TRUE
      AND COALESCE(i.preco,0) > 0
      AND pf.ncm IS NOT NULL AND regexp_replace(pf.ncm,'[^0-9]','','g') ~ '^[0-9]{8}$'
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
           'item_id', id, 'produto_id', produto_faturamento_id,
           'produto_origem_id', produto_origem_id, 'produto_faturamento_id', produto_faturamento_id,
           'descricao', descricao, 'faturado_como', faturado_como,
           'quantidade', quantidade, 'preco_unitario', preco_unitario, 'subtotal', subtotal,
           'desconto_rateado', GREATEST(0, LEAST(
             d_item + CASE WHEN rn = total_rn THEN (alvo_emit - soma_ditem) ELSE 0 END, subtotal)),
           'ncm', ncm, 'cfop', cfop, 'unidade', unidade,
           'tipo_item_sped', tipo_item_sped, 'faturamento_bloqueado', faturamento_bloqueado
         ) ORDER BY rn)
    INTO v_emitiveis
  FROM emit_fin;

  SELECT jsonb_agg(jsonb_build_object('descricao', i.descricao, 'subtotal', ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2)) ORDER BY i.ordem)
    INTO v_texto_livre
  FROM erp_os_diagnostico_item i
  WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
    AND i.tipo='peca' AND i.aprovado IS TRUE AND i.produto_id IS NULL;

  SELECT jsonb_agg(jsonb_build_object('descricao', COALESCE(NULLIF(p.descricao,''), p.nome, i.descricao)) ORDER BY i.ordem)
    INTO v_bloq_fiscal
  FROM erp_os_diagnostico_item i
  JOIN erp_produtos p ON p.id = i.produto_id AND p.company_id = v_os.company_id
  WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
    AND i.tipo='peca' AND i.aprovado IS TRUE
    AND (COALESCE(i.preco,0) <= 0 OR p.ncm IS NULL OR regexp_replace(COALESCE(p.ncm,''),'[^0-9]','','g') !~ '^[0-9]{8}$');

  v_val_emitivel := COALESCE((SELECT SUM((e->>'subtotal')::numeric) FROM jsonb_array_elements(COALESCE(v_emitiveis,'[]'::jsonb)) e), 0);
  v_desc_emitivel := COALESCE((SELECT SUM((e->>'desconto_rateado')::numeric) FROM jsonb_array_elements(COALESCE(v_emitiveis,'[]'::jsonb)) e), 0);
  -- quantas peças emitíveis ainda estão com item de faturamento '99' (bloqueiam a emissão neste modo)
  v_bloq_sped := COALESCE((SELECT count(*) FROM jsonb_array_elements(COALESCE(v_emitiveis,'[]'::jsonb)) e WHERE (e->>'faturamento_bloqueado')::boolean), 0);

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
    'modo_baixa_estoque', COALESCE(v_modo,'faturamento'),
    'permite_troca', v_troca,                       -- #9726 · só modo baixar_estoque
    'bloqueios_sped', v_bloq_sped,                  -- #9726 · itens com faturamento '99' (bloqueiam a emissão)
    'valor_esperado', v_val_esperado,
    'valor_emitivel', v_val_emitivel,
    'desconto_os', v_desconto,
    'desconto_emitivel', v_desc_emitivel,
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

-- Guarda (check_fn_guards · conserto-main): fn_os_nfe_preparar é SECURITY DEFINER e só pode ser chamada
-- por sessão logada/serviço (nunca anon). É STABLE (só leitura; não grava), por isso não exige guarda de empresa.
REVOKE ALL ON FUNCTION public.fn_os_nfe_preparar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nfe_preparar(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 4) RD-95 · "?" do campo novo "Trocar item de faturamento" (só aparece no modo baixar_estoque).
--    Idempotente (não duplica a chave).
-- ============================================================================================
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT
  'oficina.os.nfe_trocar_item_faturamento', '/dashboard/os', 'Nota fiscal', 'Trocar item de faturamento',
  'Busque e escolha um produto de estoque real (tipo 00) com NCM para sair NA NOTA no lugar do item usado. A troca vale só para a NF-e: o item da OS, a baixa de estoque e o histórico do veículo continuam com o item realmente usado.',
  'Permite faturar com um produto fiscalmente emitível quando o item usado é "99 - Outras" (que não pode ir na nota). Mantém a quantidade e o valor da linha original, para o total da nota não divergir do total da OS.',
  'A peça usada é "99 - Outras"; troque pelo produto equivalente de tipo 00 (com NCM). Na OS continua a peça usada; na nota sai o produto escolhido.',
  'Só produto tipo 00 com NCM de 8 dígitos pode ser escolhido. O saldo mostrado é informativo — a emissão da nota não baixa estoque (a baixa é pelo botão "Baixar estoque").',
  'oficina', 60, 1, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'oficina.os.nfe_trocar_item_faturamento');
