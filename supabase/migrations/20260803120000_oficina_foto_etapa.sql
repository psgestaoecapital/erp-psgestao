-- RD-41 · Oficina — registrar foto no Diagnóstico Técnico (URGENTE · Jordana, OS-2026-0025).
-- A impressão (#843) já lê erp_os_registro_foto; a Recepção (#831) já captura foto. Faltava
-- o Diagnóstico capturar. Aditivo (RD-26/RD-55): só ADD COLUMN `etapa` + estender as RPCs de
-- registro (salvar/listar) + a impressão devolver a etapa (p/ agrupar recepção × diagnóstico).

-- 1 · coluna aditiva (recepcao | diagnostico | servico). Default 'servico' (retrocompat).
ALTER TABLE public.erp_os_registro_foto
  ADD COLUMN IF NOT EXISTS etapa text NOT NULL DEFAULT 'servico';

-- 2 · SALVAR passa a aceitar a etapa (diagnóstico grava 'diagnostico').
CREATE OR REPLACE FUNCTION public.fn_oficina_registro_salvar(
  p_company_id uuid, p_os_id uuid, p_foto_path text, p_descricao text,
  p_criado_por_nome text DEFAULT NULL::text, p_etapa text DEFAULT 'servico')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_etapa text := lower(coalesce(NULLIF(trim(p_etapa),''),'servico'));
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NULLIF(trim(coalesce(p_foto_path,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'foto_obrigatoria'); END IF;
  IF NULLIF(trim(coalesce(p_descricao,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'descricao_obrigatoria'); END IF;
  IF v_etapa NOT IN ('recepcao','diagnostico','servico') THEN v_etapa := 'servico'; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id=p_os_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa'); END IF;
  INSERT INTO erp_os_registro_foto (company_id, os_id, foto_path, descricao, criado_por, criado_por_nome, etapa)
  VALUES (p_company_id, p_os_id, p_foto_path, trim(p_descricao), auth.uid(), nullif(p_criado_por_nome,''), v_etapa)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 3 · LISTAR devolve a etapa (+ filtro opcional por etapa).
DROP FUNCTION IF EXISTS public.fn_oficina_registro_listar(uuid, uuid);
CREATE OR REPLACE FUNCTION public.fn_oficina_registro_listar(p_company_id uuid, p_os_id uuid, p_etapa text DEFAULT NULL)
RETURNS TABLE(id uuid, foto_path text, descricao text, criado_por_nome text, etapa text, created_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  RETURN QUERY SELECT r.id, r.foto_path, r.descricao, r.criado_por_nome, r.etapa, r.created_at
    FROM erp_os_registro_foto r
    WHERE r.company_id=p_company_id AND r.os_id=p_os_id
      AND (p_etapa IS NULL OR r.etapa = lower(p_etapa))
    ORDER BY r.created_at DESC;
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_registro_salvar(uuid,uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_registro_listar(uuid,uuid,text) TO authenticated;

-- 4 · impressão devolve a etapa por foto (p/ agrupar recepção × diagnóstico × serviço)
CREATE OR REPLACE FUNCTION public.fn_os_imprimir_dados(p_os_id uuid, p_incluir_fotos boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os  erp_os%ROWTYPE;
  v_ped erp_pedidos%ROWTYPE;
  v_emp companies%ROWTYPE;
  v_ramo text;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  -- guard de acesso por empresa (faltava)
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = v_os.pedido_id;
  SELECT * INTO v_emp FROM companies     WHERE id = v_os.company_id;
  SELECT COALESCE(ramo, 'automotiva') INTO v_ramo FROM erp_oficina_parametros WHERE company_id = v_os.company_id;
  v_ramo := COALESCE(v_ramo, 'automotiva');

  RETURN jsonb_build_object(
    'ok', true,
    'ramo', v_ramo,
    'empresa', jsonb_build_object(
      'nome', COALESCE(v_emp.nome_fantasia, v_emp.razao_social),
      'razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'endereco', v_emp.endereco, 'cidade_estado', v_emp.cidade_estado,
      'ie', v_emp.inscricao_estadual, 'im', v_emp.inscricao_municipal
    ),
    -- cabeçalho da OS + veículo/cliente (placa/km só fazem sentido na automotiva; a tela decide pelo ramo)
    'cabecalho', jsonb_build_object(
      'numero', v_os.numero, 'status', v_os.status,
      'data_abertura', v_os.data_abertura, 'data_conclusao', v_os.data_conclusao,
      'placa', v_os.placa, 'km', v_os.km,
      'veiculo', NULLIF(btrim(COALESCE(v_os.marca,'') || ' ' || COALESCE(v_os.modelo,'')), ''),
      'marca', v_os.marca, 'modelo', v_os.modelo, 'ano', v_os.ano,
      'cliente_nome', btrim(COALESCE(v_os.cliente_nome, v_ped.cliente_nome, '')),
      'cliente_cnpj', COALESCE(v_os.cliente_cnpj, v_ped.cliente_cnpj),
      'defeito_relatado', v_os.defeito_relatado, 'diagnostico', v_os.diagnostico,
      'tecnico_nome', v_os.tecnico_nome
    ),
    -- itens do DIAGNÓSTICO (fonte única — #842). aprovado/pendente COM valor; recusado SEM valor.
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'descricao', i.descricao, 'detalhe', NULLIF(btrim(COALESCE(i.observacao,'')), ''),
        'tipo', i.tipo, 'quantidade', i.quantidade,
        'preco_unit', CASE WHEN i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL THEN NULL ELSE i.preco END,
        'subtotal',   CASE WHEN i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL THEN NULL
                           ELSE ROUND(COALESCE(i.preco,0) * COALESCE(i.quantidade,1), 2) END,
        'aprovado', i.aprovado,
        'status_item', CASE WHEN i.aprovado IS TRUE THEN 'aprovado'
                            WHEN i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL THEN 'recusado'
                            ELSE 'pendente' END,
        'severidade', i.severidade
      ) ORDER BY i.ordem, i.created_at)
      FROM erp_os_diagnostico_item i
      WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
    ), '[]'::jsonb),
    'resumo', (
      SELECT jsonb_build_object(
        'total_aprovado', COALESCE(SUM(ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2)) FILTER (WHERE i.aprovado IS TRUE), 0),
        'total_orcamento', COALESCE(SUM(ROUND(COALESCE(i.preco,0)*COALESCE(i.quantidade,1),2)) FILTER (WHERE NOT (i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL)), 0),
        'qtd_aprovados', COUNT(*) FILTER (WHERE i.aprovado IS TRUE),
        'qtd_pendentes', COUNT(*) FILTER (WHERE i.aprovado IS NULL OR (i.aprovado IS FALSE AND i.aprovado_em IS NULL)),
        'qtd_recusados', COUNT(*) FILTER (WHERE i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL))
      FROM erp_os_diagnostico_item i WHERE i.os_id = p_os_id AND i.company_id = v_os.company_id
    ),
    -- fotos: opcionais (PDF leve por padrão). foto_path é assinado pelo frontend.
    'fotos', CASE WHEN p_incluir_fotos THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'foto_path', f.foto_path, 'descricao', f.descricao,
          'autor', f.criado_por_nome, 'data', f.created_at, 'etapa', f.etapa) ORDER BY f.created_at)
        FROM erp_os_registro_foto f WHERE f.os_id = p_os_id AND f.company_id = v_os.company_id
      ), '[]'::jsonb) ELSE NULL END,
    -- compat: mantém os itens do pedido + parcelas (callers antigos)
    'os', jsonb_build_object(
      'numero', v_os.numero, 'status', v_os.status,
      'equipamento', v_os.equipamento, 'defeito_relatado', v_os.defeito_relatado,
      'descricao_servico', v_os.descricao_servico, 'diagnostico', v_os.diagnostico,
      'solucao', v_os.solucao, 'tecnico_nome', v_os.tecnico_nome,
      'assinatura_cliente', v_os.assinatura_cliente, 'assinatura_data', v_os.assinatura_data,
      'data_abertura', v_os.data_abertura, 'data_conclusao', v_os.data_conclusao
    ),
    'pedido', CASE WHEN v_ped.id IS NULL THEN NULL ELSE jsonb_build_object(
      'numero', v_ped.numero, 'data_pedido', v_ped.data_pedido,
      'cliente_nome', v_ped.cliente_nome, 'cliente_cnpj', v_ped.cliente_cnpj,
      'subtotal', v_ped.subtotal, 'desconto_valor', v_ped.desconto_valor, 'total', v_ped.total
    ) END,
    'parcelas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('numero', pa.numero, 'valor', pa.valor,
        'vencimento', pa.vencimento, 'forma_pagamento', pa.forma_pagamento) ORDER BY pa.numero)
      FROM erp_pedidos_parcelas pa WHERE pa.pedido_id = v_os.pedido_id
    ), '[]'::jsonb)
  );
END; $function$;
