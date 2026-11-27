-- Ajuste da #6426 (teste da Jordana na 163, OS-2026-0009): a NFS-e da OS deve agrupar por CHAVE FISCAL, não por
-- cadastro (erp_servicos.id). OS-0009 tem 2 serviços (desmontagem R$40, polimento R$50) em cadastros distintos mas
-- com parâmetros fiscais IDÊNTICOS (LC116 14.01, mun 140101, ISS 2.01, etc.) → deve sair UMA nota de R$90, não duas.
--
-- ⚠ Núcleo fiscal: só CREATE OR REPLACE de fn_os_nfse_preparar, ADITIVO — mantém TODOS os campos atuais; não toca
-- /api/fiscal/nfse/emitir nem o provider. Chave fiscal = (codigo_lc116, codigo_servico_municipio, aliquota_iss,
-- iss_retido, tipo_tributacao, codigo_nbs, cnae, e PIS/COFINS/IR/CSLL/INSS + retenções — tudo que muda o XML).
-- Cada grupo = 1 nota com o VALOR TOTAL dos itens; devolve os `cadastros` candidatos (o operador escolhe qual vira o
-- serviço da nota; `servico_fiscal_id` já vem com o sugerido = cadastro do item de MAIOR valor). Sem vínculo / tablet
-- (Gean) inalterados.

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

  -- NOVO (ajuste #6426): agrupa por CHAVE FISCAL (não por cadastro). Itens de cadastros diferentes com os MESMOS
  -- parâmetros fiscais ficam no MESMO grupo = 1 nota com o total. `cadastros` = candidatos para o operador escolher
  -- o serviço da nota; `servico_fiscal_id` já vem com o sugerido (cadastro do item de maior valor).
  WITH itens_v AS (
    SELECT di.descricao, COALESCE(di.quantidade,1) AS q, ROUND(COALESCE(di.preco,0) * COALESCE(di.quantidade,1), 2) AS valor, di.ordem,
      s.id AS sid, COALESCE(NULLIF(s.descricao_detalhada,''), s.descricao_resumida) AS sdesc,
      s.codigo_lc116, s.codigo_servico_municipio, COALESCE(s.aliquota_iss,0) AS aliq, COALESCE(s.iss_retido,false) AS retido,
      s.tipo_tributacao, s.codigo_nbs, s.cnae,
      COALESCE(s.aliquota_pis,0) AS pis, COALESCE(s.retem_pis,false) AS rpis,
      COALESCE(s.aliquota_cofins,0) AS cof, COALESCE(s.retem_cofins,false) AS rcof,
      COALESCE(s.aliquota_ir,0) AS ir, COALESCE(s.retem_ir,false) AS rir,
      COALESCE(s.aliquota_csll,0) AS csll, COALESCE(s.retem_csll,false) AS rcsll,
      COALESCE(s.aliquota_inss,0) AS inss, COALESCE(s.retem_inss,false) AS rinss
    FROM erp_os_diagnostico_item di JOIN erp_servicos s ON s.id = di.servico_fiscal_id
    WHERE di.os_id = p_os_id AND di.company_id = v_os.company_id AND di.tipo = 'servico' AND di.aprovado IS TRUE
      AND di.servico_fiscal_id IS NOT NULL
  )
  SELECT jsonb_agg(g.grp ORDER BY g.ord) INTO v_grupos FROM (
    SELECT jsonb_build_object(
      'servico_fiscal_id', (array_agg(sid ORDER BY valor DESC, ordem))[1],
      'descricao', (array_agg(sdesc ORDER BY valor DESC, ordem))[1],
      'codigo_lc116', codigo_lc116, 'codigo_servico_municipio', codigo_servico_municipio,
      'aliquota_iss', aliq, 'iss_retido', retido, 'tipo_tributacao', tipo_tributacao, 'codigo_nbs', codigo_nbs, 'cnae', cnae,
      'valor_total', SUM(valor), 'qtd_itens', COUNT(*),
      'itens', jsonb_agg(jsonb_build_object('descricao', descricao, 'quantidade', q, 'valor', valor) ORDER BY ordem),
      'cadastros', jsonb_agg(DISTINCT jsonb_build_object('servico_fiscal_id', sid, 'descricao', sdesc))
    ) AS grp, MIN(sdesc) AS ord
    FROM itens_v
    GROUP BY codigo_lc116, codigo_servico_municipio, aliq, retido, tipo_tributacao, codigo_nbs, cnae,
             pis, rpis, cof, rcof, ir, rir, csll, rcsll, inss, rinss
  ) g;

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
    'tem_vinculo', (v_grupos IS NOT NULL),
    'qtd_grupos', COALESCE(jsonb_array_length(v_grupos), 0),
    'grupos_fiscais', COALESCE(v_grupos, '[]'::jsonb),
    'itens_sem_vinculo', v_sem_vinculo);
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_nfse_preparar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_nfse_preparar(uuid) TO authenticated, service_role;

-- ============================ AJUDA "?" RD-95 (campo novo: serviço da nota) ============================
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'oficina.os.nfse_servico_nota', 'Ordem de Serviço', 'Serviço da nota',
  'Quando o grupo tem mais de um serviço cadastrado com os mesmos parâmetros fiscais, escolha qual cadastro dá o NOME da NFS-e. O valor da nota é sempre o total do grupo.',
  'Define a descrição principal e o cadastro de referência da nota; os itens do grupo vão listados nas observações.',
  'Grupo "desmontagem + polimento" (R$ 90): escolher "Polimento" como serviço da nota.',
  'Achar que a escolha muda o valor — não muda: a nota é o total do grupo.', 72, '/dashboard/os', 'oficina', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
