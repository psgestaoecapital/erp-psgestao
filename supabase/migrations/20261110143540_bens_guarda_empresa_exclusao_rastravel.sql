-- Bens & Imobilizado (/dashboard/gestao-empresarial/bens) — endurecimento de núcleo.
-- Motivação (PDCA GE, aud8 58/95 + varredura de segurança RD-34):
--   1) RD-98 p4 — a exclusão de bem era DELETE FÍSICO direto do client (supabase.from('erp_bem').delete()),
--      sem trilha de auditoria e sem como rastrear quem excluiu. Passa a soft-delete via RPC guardada + audit_log_global.
--   2) Vazamento cross-tenant — fn_bem_listar (LEITURA) e fn_bem_criar_do_pagar (ESCRITA) eram SECURITY DEFINER,
--      com EXECUTE para `authenticated` e SEM checagem de vínculo com a empresa: qualquer usuário logado podia ler
--      os bens de outra empresa (ou criar bem em outra empresa) passando o company_id no RPC. Fecha com a mesma
--      guarda fail-closed (get_user_company_ids) já usada em fn_bem_indicadores / fn_bem_baixar / fn_bem_calcular_depreciacao.
-- Aditiva e idempotente. NÃO altera nem apaga dado de cliente (soft-delete é não-destrutivo).

-- (1) Colunas de soft-delete (aditivas) — trilha de quem/quando/por quê.
ALTER TABLE public.erp_bem
  ADD COLUMN IF NOT EXISTS excluido_em   timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por  uuid,
  ADD COLUMN IF NOT EXISTS motivo_exclusao text;

-- (2) Amplia o enum de status para aceitar 'excluido' (aditivo: não rejeita nenhum dado existente).
--     Assim fn_bem_indicadores e fn_bem_calcular_depreciacao, que já filtram status='ativo', ignoram o excluído sozinhas.
ALTER TABLE public.erp_bem DROP CONSTRAINT IF EXISTS erp_bem_status_check;
ALTER TABLE public.erp_bem ADD CONSTRAINT erp_bem_status_check
  CHECK (status = ANY (ARRAY['ativo'::text,'baixado'::text,'vendido'::text,'sinistrado'::text,'em_construcao'::text,'excluido'::text]));

-- (3) RPC de exclusão rastreável (RD-98 p4): soft-delete guardado + audit_log_global com o autor.
CREATE OR REPLACE FUNCTION public.fn_bem_excluir(p_bem_id uuid, p_company_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- guarda de empresa (fail-closed): só age em empresa do próprio usuário
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  -- espelha a regra da tela: bem com depreciação lançada não se exclui — usa Baixar/Vender
  IF EXISTS (SELECT 1 FROM erp_bem_depreciacao d WHERE d.bem_id = p_bem_id AND d.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tem_depreciacao');
  END IF;
  UPDATE public.erp_bem
     SET status = 'excluido', excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = p_motivo, updated_at = now()
   WHERE id = p_bem_id AND company_id = p_company_id AND status <> 'excluido';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_bem', p_bem_id::text, 'excluir',
            jsonb_build_object('status','excluido','excluido_em', now(), 'motivo', p_motivo));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_bem_excluir(uuid, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_bem_excluir(uuid, uuid, text) TO authenticated;

-- (4) fn_bem_listar: adiciona a guarda de empresa (fail-closed) e oculta soft-deleted.
--     Converte de SQL para plpgsql só para poder retornar vazio quando não há vínculo; MESMA assinatura e colunas.
CREATE OR REPLACE FUNCTION public.fn_bem_listar(p_company_id uuid)
 RETURNS TABLE(id uuid, codigo text, descricao text, natureza text, data_aquisicao date, valor_aquisicao numeric, deprecia boolean, vida_util_meses integer, metodo_depreciacao text, business_line_id uuid, business_line_nome text, centro_custo text, status text, dep_acumulada numeric, valor_contabil numeric, falta_parametro boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- guarda de empresa (fail-closed): sem vínculo com a empresa, lista vazia
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT b.id, b.codigo, b.descricao, b.natureza, b.data_aquisicao, b.valor_aquisicao,
    b.deprecia, b.vida_util_meses, b.metodo_depreciacao, b.business_line_id, bl.name,
    b.centro_custo, b.status,
    COALESCE(d.acumulado, 0) AS dep_acumulada,
    ROUND(b.valor_aquisicao - COALESCE(d.acumulado,0), 2) AS valor_contabil,
    (b.deprecia AND b.vida_util_meses IS NULL) AS falta_parametro
  FROM erp_bem b
  LEFT JOIN business_lines bl ON bl.id = b.business_line_id
  LEFT JOIN LATERAL (
    SELECT acumulado FROM erp_bem_depreciacao dd
    WHERE dd.bem_id = b.id ORDER BY dd.competencia DESC LIMIT 1
  ) d ON TRUE
  WHERE b.company_id = p_company_id AND b.status <> 'excluido'
  ORDER BY b.status, b.natureza, b.descricao;
END $function$;

-- (5) fn_bem_criar_do_pagar: adiciona a guarda de empresa (fail-closed) antes de qualquer leitura/escrita.
--     Corpo preservado verbatim; só prepende a guarda.
CREATE OR REPLACE FUNCTION public.fn_bem_criar_do_pagar(p_company_id uuid, p_pagar_id uuid, p_natureza text, p_vida_util_meses integer DEFAULT NULL::integer, p_business_line_id uuid DEFAULT NULL::uuid, p_centro_custo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_p RECORD; v_bem_id uuid; v_vida int; v_dep boolean; v_conta uuid; v_data date;
BEGIN
  -- guarda de empresa (fail-closed): só cria bem em empresa do próprio usuário
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT id INTO v_bem_id FROM erp_bem
    WHERE company_id=p_company_id AND origem_lancamento_tabela='erp_pagar' AND origem_lancamento_id=p_pagar_id LIMIT 1;
  IF v_bem_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'bem_id',v_bem_id,'ja_existia',true); END IF;

  SELECT * INTO v_p FROM erp_pagar WHERE id=p_pagar_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','conta a pagar não encontrada'); END IF;

  SELECT vida_util_meses, deprecia INTO v_vida, v_dep FROM erp_bem_natureza_padrao
    WHERE natureza=p_natureza AND (company_id=p_company_id OR company_id IS NULL)
    ORDER BY company_id NULLS LAST LIMIT 1;
  v_vida := COALESCE(p_vida_util_meses, v_vida);
  v_dep  := COALESCE(v_dep, true);
  v_data := COALESCE(v_p.data_pagamento, v_p.data_vencimento);

  SELECT c.id INTO v_conta FROM erp_bem_natureza_padrao np
    JOIN erp_plano_contas c ON c.codigo=np.conta_sugerida_codigo AND (c.company_id=p_company_id OR c.company_id IS NULL)
    WHERE np.natureza=p_natureza AND (np.company_id=p_company_id OR np.company_id IS NULL)
    ORDER BY np.company_id NULLS LAST, c.company_id NULLS LAST LIMIT 1;

  INSERT INTO erp_bem(company_id,descricao,natureza,conta_id,data_aquisicao,valor_aquisicao,fornecedor_nome,
     origem_lancamento_tabela,origem_lancamento_id,deprecia,vida_util_meses,business_line_id,centro_custo,data_inicio_depreciacao)
   VALUES(p_company_id, COALESCE(v_p.descricao,'Bem'), p_natureza, v_conta, v_data, COALESCE(v_p.valor,0),
     v_p.fornecedor_nome, 'erp_pagar', p_pagar_id, v_dep, v_vida, p_business_line_id, p_centro_custo, v_data)
   RETURNING id INTO v_bem_id;
  INSERT INTO erp_bem_movimentacao(company_id,bem_id,tipo,data,valor,justificativa)
   VALUES(p_company_id,v_bem_id,'aquisicao',v_data,COALESCE(v_p.valor,0),'convertido de conta a pagar (investimento)');

  RETURN jsonb_build_object('ok',true,'bem_id',v_bem_id,'vida_util_meses',v_vida,'deprecia',v_dep);
END $function$;
