-- Faturamento de serviços da oficina no modelo CENTRALIZADO: vincular o serviço fiscal (erp_servicos) ao item da OS
-- já na inclusão, para a NFS-e sair pré-preenchida (sem escolha manual), agrupada por serviço fiscal.
-- Pedido da Jordana (163 / Vianz / Triches). ⚠ TOCA NÚCLEO FISCAL (NFS-e), usado por TODAS as empresas com oficina
-- (inclusive o tablet da Gean): mudança 100% ADITIVA — quem não tem vínculo segue com o comportamento atual.
--
-- RD-38 (provado): erp_os_diagnostico_item.servico_id → erp_oficina_servicos (tempário, VAZIO no centralizado), NÃO é
-- o serviço fiscal. Por isso o vínculo fiscal vai numa COLUNA NOVA servico_fiscal_id → erp_servicos. O faturamento de
-- PEÇAS (NF-e) não muda; fn_os_item_ligar_produto_faturada não é tocado.

-- ============================ COLUNA NOVA (aditiva) ============================
ALTER TABLE public.erp_os_diagnostico_item
  ADD COLUMN IF NOT EXISTS servico_fiscal_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_os_diag_item_servico_fiscal_fkey') THEN
    ALTER TABLE public.erp_os_diagnostico_item
      ADD CONSTRAINT erp_os_diag_item_servico_fiscal_fkey FOREIGN KEY (servico_fiscal_id) REFERENCES public.erp_servicos(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_erp_os_diag_item_servico_fiscal ON public.erp_os_diagnostico_item (servico_fiscal_id) WHERE servico_fiscal_id IS NOT NULL;
COMMENT ON COLUMN public.erp_os_diagnostico_item.servico_fiscal_id IS 'Vínculo FISCAL do item de serviço ao cadastro erp_servicos (LC116), para a NFS-e da OS sair pré-preenchida/agrupada. NULL = texto livre (comportamento antigo). #centralizado';

-- ============================ fn_oficina_diagnostico_salvar (ADITIVA: persiste servico_fiscal_id) ============================
-- Idêntica à versão viva, com DUAS adições: grava servico_fiscal_id no item (validado na própria empresa) e só mexe
-- nessa coluna quando a chave vier no jsonb (telas que não a enviam PRESERVAM o valor — sem regressão).
CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_salvar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item jsonb; v_n int := 0; v_id uuid; v_ids uuid[] := ARRAY[]::uuid[]; v_bloqueados int := 0;
        v_prod uuid; v_custo numeric; v_pode_preco boolean; v_preco numeric;
        v_has_fiscal boolean; v_serv_fiscal uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa');
  END IF;

  v_pode_preco := COALESCE((public.fn_oficina_modelo_atendimento(p_company_id)->>'pode_preco')::boolean, false);

  UPDATE erp_os SET
    diagnostico = nullif(btrim(coalesce(p_dados->>'diagnostico','')), ''),
    km = coalesce(nullif(p_dados->>'km','')::int, km),
    updated_at = now()
  WHERE id = p_os_id AND company_id = p_company_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb))
  LOOP
    IF length(btrim(coalesce(v_item->>'descricao',''))) = 0 THEN CONTINUE; END IF;
    v_id := nullif(v_item->>'id','')::uuid;
    v_preco := CASE WHEN v_pode_preco THEN nullif(v_item->>'preco','')::numeric ELSE NULL END;

    v_prod := nullif(v_item->>'produto_id','')::uuid;
    v_custo := CASE WHEN v_prod IS NOT NULL THEN (
        SELECT coalesce(ve.preco_custo_medio, ve.preco_custo)
        FROM v_erp_produtos_estoque ve
        WHERE ve.id = v_prod AND ve.company_id = p_company_id LIMIT 1
      ) ELSE NULL END;

    -- #centralizado: vínculo fiscal do item (validado na própria empresa). Só altera quando a chave vier (preserva o resto).
    v_has_fiscal := (v_item ? 'servico_fiscal_id');
    v_serv_fiscal := CASE WHEN v_has_fiscal
      THEN (SELECT s.id FROM erp_servicos s WHERE s.id = nullif(v_item->>'servico_fiscal_id','')::uuid AND s.company_id = p_company_id)
      ELSE NULL END;

    IF v_id IS NOT NULL THEN
      UPDATE erp_os_diagnostico_item SET
        tipo             = coalesce(nullif(v_item->>'tipo',''), tipo),
        servico_id       = nullif(v_item->>'servico_id','')::uuid,
        produto_id       = v_prod,
        descricao        = btrim(v_item->>'descricao'),
        quantidade       = coalesce(nullif(v_item->>'quantidade','')::numeric, 1),
        tempo_estimado_h = nullif(v_item->>'tempo_estimado_h','')::numeric,
        severidade       = coalesce(nullif(v_item->>'severidade',''), severidade),
        observacao       = nullif(v_item->>'observacao',''),
        custo_unitario   = COALESCE(custo_unitario, v_custo),
        preco            = CASE WHEN v_preco IS NOT NULL AND aprovado IS DISTINCT FROM true THEN v_preco ELSE preco END,
        servico_fiscal_id = CASE WHEN v_has_fiscal THEN v_serv_fiscal ELSE servico_fiscal_id END
      WHERE id = v_id AND os_id = p_os_id AND company_id = p_company_id;
      IF FOUND THEN v_ids := array_append(v_ids, v_id); ELSE v_id := NULL; END IF;
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO erp_os_diagnostico_item (company_id, os_id, tipo, servico_id, produto_id, descricao,
        quantidade, tempo_estimado_h, severidade, observacao, custo_unitario, ordem, criado_por, preco, servico_fiscal_id)
      VALUES (p_company_id, p_os_id, coalesce(nullif(v_item->>'tipo',''), 'servico'),
        nullif(v_item->>'servico_id','')::uuid, v_prod, btrim(v_item->>'descricao'),
        coalesce(nullif(v_item->>'quantidade','')::numeric, 1), nullif(v_item->>'tempo_estimado_h','')::numeric,
        coalesce(nullif(v_item->>'severidade',''), 'recomendado'), nullif(v_item->>'observacao',''), v_custo, v_n, auth.uid(), v_preco, v_serv_fiscal)
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids, v_id);
    END IF;
    v_n := v_n + 1;
  END LOOP;

  SELECT count(*) INTO v_bloqueados
  FROM erp_os_diagnostico_item d
  WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
    AND ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
       OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    SELECT p_company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()),
           'erp_os_diagnostico_item', d.id::text, 'EXCLUIU_ITEM',
           jsonb_build_object('os_id', p_os_id, 'tipo', d.tipo, 'descricao', d.descricao,
                              'quantidade', d.quantidade, 'preco', d.preco,
                              'produto_id', d.produto_id, 'servico_id', d.servico_id),
           NULL
    FROM erp_os_diagnostico_item d
    WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
      AND NOT ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
             OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  DELETE FROM erp_os_diagnostico_item d
  WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
    AND NOT ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
           OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'itens', v_n, 'nao_removidos', v_bloqueados);
END $function$;
REVOKE ALL ON FUNCTION public.fn_oficina_diagnostico_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_diagnostico_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

-- ============================ fn_oficina_diagnostico_obter (ADITIVA: devolve servico_fiscal_id) ============================
CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_obter(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH f AS (SELECT (public.fn_oficina_papel(p_company_id) = 'OFICINA_MECANICO') AS mec),
  itens AS (
    SELECT i.*,
      ROUND(COALESCE(i.preco,0) * COALESCE(i.quantidade,1), 2) AS subtotal,
      CASE WHEN i.aprovado IS TRUE THEN 'aprovado'
           WHEN i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL THEN 'recusado'
           ELSE 'pendente' END AS status_item
    FROM erp_os_diagnostico_item i
    WHERE i.os_id = p_os_id AND i.company_id = p_company_id
  )
  SELECT jsonb_build_object(
    'os', (SELECT jsonb_build_object(
             'id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'placa', o.placa, 'marca', o.marca,
             'modelo', o.modelo, 'ano', o.ano, 'km', o.km,
             'defeito_relatado', o.defeito_relatado, 'diagnostico', o.diagnostico)
           FROM erp_os o
           WHERE o.id = p_os_id AND o.company_id = p_company_id
             AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'tipo', i.tipo, 'servico_id', i.servico_id, 'produto_id', i.produto_id,
             'servico_fiscal_id', i.servico_fiscal_id,
             'descricao', i.descricao, 'quantidade', i.quantidade,
             'preco',    CASE WHEN (SELECT mec FROM f) THEN NULL ELSE i.preco END,
             'subtotal', CASE WHEN (SELECT mec FROM f) THEN NULL ELSE i.subtotal END,
             'aprovado', i.aprovado, 'aprovado_em', i.aprovado_em, 'status_item', i.status_item,
             'tempo_estimado_h', i.tempo_estimado_h, 'severidade', i.severidade,
             'observacao', i.observacao) ORDER BY i.ordem, i.created_at)
           FROM itens i), '[]'::jsonb),
    'resumo', (SELECT jsonb_build_object(
             'total_aprovado', CASE WHEN (SELECT mec FROM f) THEN NULL ELSE COALESCE(SUM(subtotal) FILTER (WHERE status_item='aprovado'), 0) END,
             'total_geral',    CASE WHEN (SELECT mec FROM f) THEN NULL ELSE COALESCE(SUM(subtotal), 0) END,
             'qtd_aprovados',  COUNT(*) FILTER (WHERE status_item='aprovado'),
             'qtd_pendentes',  COUNT(*) FILTER (WHERE status_item='pendente'),
             'qtd_recusados',  COUNT(*) FILTER (WHERE status_item='recusado'))
           FROM itens)
  );
$function$;

-- ============================ fn_os_nfse_preparar (ADITIVA: grupos_fiscais + itens_sem_vinculo) ============================
-- Mantém TODOS os campos atuais (valor_servicos, servicos_fiscais, servico_fiscal_id_default, etc.). Acrescenta o
-- agrupamento por serviço fiscal vinculado (OS do centralizado) e a lista de itens sem vínculo. Sem vínculo em nenhum
-- item (ex.: Gean/tablet) → grupos_fiscais vazio e tem_vinculo=false → a tela usa o fluxo antigo (seletor). Sem regressão.
CREATE OR REPLACE FUNCTION public.fn_os_nfse_preparar(p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_qtd_serv int; v_val_serv numeric; v_val_pecas numeric;
  v_c_doc text; v_c_email text; v_c_razao text; v_doc text; v_tipo text;
  v_servicos jsonb; v_default uuid; v_grupos jsonb; v_sem_vinculo jsonb;
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

  -- NOVO: agrupa os itens de serviço APROVADOS com vínculo fiscal, por serviço fiscal (um grupo = uma NFS-e).
  SELECT jsonb_agg(g.grp ORDER BY g.ord) INTO v_grupos FROM (
    SELECT jsonb_build_object(
      'servico_fiscal_id', s.id,
      'descricao', COALESCE(NULLIF(s.descricao_detalhada,''), s.descricao_resumida),
      'codigo_lc116', s.codigo_lc116, 'codigo_servico_municipio', s.codigo_servico_municipio,
      'aliquota_iss', COALESCE(s.aliquota_iss, 0), 'iss_retido', COALESCE(s.iss_retido, false),
      'valor_total', SUM(ROUND(COALESCE(di.preco,0) * COALESCE(di.quantidade,1), 2)),
      'qtd_itens', COUNT(*),
      'itens', jsonb_agg(jsonb_build_object('descricao', di.descricao, 'quantidade', COALESCE(di.quantidade,1),
                 'valor', ROUND(COALESCE(di.preco,0) * COALESCE(di.quantidade,1), 2)) ORDER BY di.ordem)
    ) AS grp, MIN(s.descricao_resumida) AS ord
    FROM erp_os_diagnostico_item di JOIN erp_servicos s ON s.id = di.servico_fiscal_id
    WHERE di.os_id = p_os_id AND di.company_id = v_os.company_id AND di.tipo = 'servico' AND di.aprovado IS TRUE
      AND di.servico_fiscal_id IS NOT NULL
    GROUP BY s.id, s.descricao_detalhada, s.descricao_resumida, s.codigo_lc116, s.codigo_servico_municipio, s.aliquota_iss, s.iss_retido
  ) g;

  -- NOVO: itens de serviço aprovados SEM vínculo (texto livre) — exigem seletor só para eles.
  SELECT jsonb_build_object(
    'qtd', COUNT(*),
    'valor_total', COALESCE(SUM(ROUND(COALESCE(preco,0) * COALESCE(quantidade,1), 2)), 0),
    'itens', COALESCE(jsonb_agg(jsonb_build_object('descricao', descricao, 'quantidade', COALESCE(quantidade,1),
               'valor', ROUND(COALESCE(preco,0) * COALESCE(quantidade,1), 2)) ORDER BY ordem), '[]'::jsonb))
    INTO v_sem_vinculo
  FROM erp_os_diagnostico_item
  WHERE os_id = p_os_id AND company_id = v_os.company_id AND tipo = 'servico' AND aprovado IS TRUE
    AND servico_fiscal_id IS NULL;

  RETURN jsonb_build_object('ok', true, 'os_numero', v_os.numero,
    'valor_servicos', v_val_serv, 'valor_pecas', v_val_pecas, 'qtd_servicos', v_qtd_serv,
    'descricao_sugerida', 'Serviços — OS ' || COALESCE(v_os.numero, '') ||
      CASE WHEN COALESCE(v_os.defeito_relatado, '') <> '' THEN ': ' || left(v_os.defeito_relatado, 120) ELSE '' END,
    'tomador', jsonb_build_object('documento', v_doc, 'tipo', v_tipo, 'nome', COALESCE(v_c_razao, v_os.cliente_nome), 'email', v_c_email),
    'servico_fiscal_id_default', v_default, 'servicos_fiscais', v_servicos,
    -- campos NOVOS (aditivos):
    'tem_vinculo', (v_grupos IS NOT NULL),
    'qtd_grupos', COALESCE(jsonb_array_length(v_grupos), 0),
    'grupos_fiscais', COALESCE(v_grupos, '[]'::jsonb),
    'itens_sem_vinculo', v_sem_vinculo);
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_nfse_preparar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nfse_preparar(uuid) TO authenticated, service_role;

-- ============================ AJUDA "?" RD-95 (campos novos) ============================
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Ordem de Serviço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/os', 'oficina', 'publicado'
FROM (VALUES
 ('oficina.os.servico_fiscal','Serviço fiscal (NFS-e)',
  'Vincule o serviço do item a um serviço CADASTRADO (Cadastros › Serviços, com LC116). Ou deixe como texto livre.',
  'Com o vínculo, a NFS-e sai preenchida sozinha (código, alíquota e discriminação) — sem escolher na hora de emitir.',
  'Buscar "revisão" e escolher o serviço cadastrado.',
  'Esquecer de cadastrar o serviço fiscal (Cadastros › Serviços) — aí só resta o texto livre.', 70),
 ('oficina.os.nfse_servico_fiscal','Serviço fiscal (LC116)',
  'O serviço fiscal (LC116 + código do município) que vai na NFS-e dos itens sem vínculo.',
  'Define o código e a alíquota de ISS da nota para os serviços digitados como texto livre.',
  'Serviço "14.01 — manutenção".',
  'Escolher um serviço fiscal de outra natureza — confira o código LC116.', 71)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
