-- Orçamento/OS · enriquecer (não recriar) — gaps do faturamento de serviço (ref. OMIE). GE (fiscal/comercial).
-- RD-26: cliente/vendedor/parcelas/desconto/LC116/NBS/alíquota-ISS-por-item já existem. Só o gap:
--   1) ISS por item: iss_retido (herda de erp_servicos.iss_retido) + valor_iss (exibição/persistência).
--   2) Despesas reembolsáveis: tabela própria (somam ao total, não são serviço/produto).
--   3) Rateio: setor_id no item → compliance_setores (cadastro de setor/departamento já existente).
--   4) data_previsao_faturamento no orçamento (quando se espera faturar; alimenta previsão de receita).
--
-- Premissa auditada (RD-38): erp_orcamentos_itens já tem aliquota_iss (#1079); compliance_setores é o
-- único cadastro de setor/departamento (global + por empresa). Fronteira GE: o financeiro (a pagar/
-- receber, parcelas) segue na GE — o orçamento só dispara o evento.

-- 1 + 3) Item: ISS retido, valor do ISS, e vínculo de setor/departamento (rateio).
ALTER TABLE public.erp_orcamentos_itens
  ADD COLUMN IF NOT EXISTS iss_retido boolean,
  ADD COLUMN IF NOT EXISTS valor_iss  numeric,
  ADD COLUMN IF NOT EXISTS setor_id   uuid REFERENCES public.compliance_setores(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.erp_orcamentos_itens.iss_retido IS 'ISS retido na fonte por item (override; default herda de erp_servicos.iss_retido).';
COMMENT ON COLUMN public.erp_orcamentos_itens.valor_iss  IS 'Valor do ISS do item (subtotal * aliquota_iss/100), persistido p/ emissão/financeiro.';
COMMENT ON COLUMN public.erp_orcamentos_itens.setor_id   IS 'Setor/departamento p/ rateio gerencial (compliance_setores).';

-- 4) Previsão de faturamento no orçamento.
ALTER TABLE public.erp_orcamentos
  ADD COLUMN IF NOT EXISTS data_previsao_faturamento date;

-- 2) Despesas reembolsáveis do orçamento (linha própria no total).
CREATE TABLE IF NOT EXISTS public.erp_orcamentos_despesas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id uuid NOT NULL REFERENCES public.erp_orcamentos(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL,
  descricao    text NOT NULL,
  valor        numeric NOT NULL DEFAULT 0,
  reembolsavel boolean NOT NULL DEFAULT true,
  ordem        int,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orc_despesas_orcamento ON public.erp_orcamentos_despesas(orcamento_id);
ALTER TABLE public.erp_orcamentos_despesas ENABLE ROW LEVEL SECURITY;

-- Mesma política do erp_orcamentos_itens (empresa do usuário OU papel adm).
DROP POLICY IF EXISTS orc_despesas_all ON public.erp_orcamentos_despesas;
CREATE POLICY orc_despesas_all ON public.erp_orcamentos_despesas FOR ALL
  USING (
    company_id IN (SELECT uc.company_id FROM user_companies uc WHERE uc.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))
  )
  WITH CHECK (
    company_id IN (SELECT uc.company_id FROM user_companies uc WHERE uc.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))
  );
REVOKE ALL ON public.erp_orcamentos_despesas FROM anon;

-- fn_orcamento_salvar_itens: persistir iss_retido/valor_iss/setor_id no caminho de edição (não-rascunho).
-- valor_iss calculado no servidor (subtotal * aliquota_iss/100) p/ serviço — fonte única do valor.
CREATE OR REPLACE FUNCTION public.fn_orcamento_salvar_itens(p_orcamento_id uuid, p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_status text; v_company uuid; v_pode boolean;
        v_item jsonb; v_count int:=0; v_total_antes numeric; v_total_depois numeric; v_nome text;
        v_qtd numeric; v_preco numeric; v_dpct numeric; v_dval numeric; v_sub numeric;
        v_tipo text; v_aliq numeric; v_valor_iss numeric;
BEGIN
  SELECT status, company_id, total INTO v_status, v_company, v_total_antes
  FROM erp_orcamentos WHERE id=p_orcamento_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem acesso'); END IF;
  v_pode := v_status IN ('rascunho','revisao','enviado','visualizado');
  IF NOT v_pode THEN
    RETURN jsonb_build_object('ok',false,'erro','Orçamento aprovado é imutável — a alteração agora é no pedido.'); END IF;
  DELETE FROM erp_orcamentos_itens WHERE orcamento_id=p_orcamento_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd  := COALESCE((v_item->>'quantidade')::numeric,1);
    v_preco:= COALESCE((v_item->>'preco_unitario')::numeric,0);
    v_dpct := COALESCE((v_item->>'desconto_percentual')::numeric,0);
    v_dval := COALESCE((v_item->>'desconto_valor')::numeric,0);
    v_sub  := GREATEST((v_qtd*v_preco) - (v_qtd*v_preco*v_dpct/100) - v_dval, 0);
    v_tipo := COALESCE(v_item->>'tipo_item','produto');
    v_aliq := NULLIF(v_item->>'aliquota_iss','')::numeric;
    v_valor_iss := CASE WHEN v_tipo='servico' AND COALESCE(v_aliq,0)>0 THEN round(v_sub*v_aliq/100, 2) ELSE NULL END;
    INSERT INTO erp_orcamentos_itens(
      orcamento_id,company_id,ordem,produto_id,produto_codigo,produto_nome,produto_descricao,
      unidade,quantidade,preco_unitario,preco_custo,desconto_percentual,desconto_valor,subtotal,
      observacoes,tipo_item,servico_id,servico_codigo,servico_descricao,
      margem_percentual,bdi_percentual,aliquota_iss,iss_retido,valor_iss,setor_id)
    VALUES(
      p_orcamento_id,v_company,v_count,
      NULLIF(v_item->>'produto_id','')::uuid,v_item->>'produto_codigo',v_item->>'produto_nome',v_item->>'produto_descricao',
      COALESCE(v_item->>'unidade','UN'),v_qtd,v_preco,COALESCE((v_item->>'preco_custo')::numeric,0),
      v_dpct,v_dval,v_sub,v_item->>'observacoes',v_tipo,
      NULLIF(v_item->>'servico_id','')::uuid,v_item->>'servico_codigo',v_item->>'servico_descricao',
      NULLIF(v_item->>'margem_percentual','')::numeric, NULLIF(v_item->>'bdi_percentual','')::numeric,
      v_aliq,
      CASE WHEN v_tipo='servico' THEN NULLIF(v_item->>'iss_retido','')::boolean ELSE NULL END,
      v_valor_iss,
      NULLIF(v_item->>'setor_id','')::uuid);
    v_count:=v_count+1;
  END LOOP;
  SELECT total INTO v_total_depois FROM erp_orcamentos WHERE id=p_orcamento_id;
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id=auth.uid();
  INSERT INTO erp_orcamento_historico(orcamento_id,company_id,evento,detalhe,usuario_id,usuario_nome,metadata)
  VALUES(p_orcamento_id,v_company,'itens_alterados',v_count||' item(ns) salvos',auth.uid(),v_nome,
    jsonb_build_object('total_antes',v_total_antes,'total_depois',v_total_depois,'itens',v_count));
  RETURN jsonb_build_object('ok',true,'itens',v_count,'total',v_total_depois);
END; $function$;
