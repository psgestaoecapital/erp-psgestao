-- SPEC F2 · CONGELAR O ESCOPO (Hub de Projetos) · fluxo de obra v1.
-- Quando o orçamento é aprovado, a obra nasce COM os itens (não só o valor total): base do previsto×realizado.
-- Auditado 27/08 (RD-44/45): PostgreSQL 17.6 (GENERATED STORED OK); projetos_obras não tinha as 4 colunas
-- novas; erp_centros_custo(id,company_id,nome!,codigo,responsavel,ativo); fn_obra_criar_de_orcamento é
-- idempotente (IF FOUND RETURN) → a cópia de itens só roda na criação. RD-30: soft-delete only.

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 1 · projetos_obra_item (o escopo congelado — CÓPIA, não referência)
CREATE TABLE IF NOT EXISTS public.projetos_obra_item (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL,
  obra_id                   uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  orcamento_item_id         uuid,
  servico_id                uuid,
  ordem                     int  NOT NULL DEFAULT 1,
  descricao                 text NOT NULL,
  unidade                   text NOT NULL DEFAULT 'un',
  quantidade_contratada     numeric(14,4) NOT NULL DEFAULT 0,
  preco_unitario            numeric(14,4) NOT NULL DEFAULT 0,
  custo_unitario_previsto   numeric(14,4) NOT NULL DEFAULT 0,
  bdi_percentual            numeric(7,4),
  valor_contratado          numeric(14,2) GENERATED ALWAYS AS (round(quantidade_contratada * preco_unitario, 2)) STORED,
  quantidade_medida         numeric(14,4) NOT NULL DEFAULT 0,
  observacoes               text,
  excluido_em               timestamptz,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_obra_item_obra    ON public.projetos_obra_item (obra_id, ordem);
CREATE INDEX IF NOT EXISTS ix_obra_item_company ON public.projetos_obra_item (company_id);
ALTER TABLE public.projetos_obra_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projetos_obra_item_rw ON public.projetos_obra_item;
CREATE POLICY projetos_obra_item_rw ON public.projetos_obra_item FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 2 · colunas aditivas (RD-30). ANTES da Entrega 3 (o %ROWTYPE precisa delas).
ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS centro_custo_id     uuid,
  ADD COLUMN IF NOT EXISTS valor_medido        numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custo_realizado     numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escopo_congelado_em timestamptz;
ALTER TABLE public.erp_orcamentos
  ADD COLUMN IF NOT EXISTS escopo_congelado_em timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 3 · estende fn_obra_criar_de_orcamento: cria centro de custo (D4) + copia os itens (congela).
-- Mantém tudo o que já fazia (idempotência, módulo hub_obras, oportunidade, numeração).
CREATE OR REPLACE FUNCTION public.fn_obra_criar_de_orcamento(p_orcamento_id uuid)
 RETURNS projetos_obras
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.erp_orcamentos%ROWTYPE; v_opp public.erp_crm_oportunidade%ROWTYPE;
  v_cfg public.projetos_modulo_config%ROWTYPE; v_obra public.projetos_obras%ROWTYPE;
  v_num text; v_prefixo text; v_seq integer; v_cc_id uuid;
BEGIN
  SELECT * INTO v_orc FROM public.erp_orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento % não encontrado', p_orcamento_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn_get_tenant_modules_active(v_orc.company_id) m WHERE m.module_id = 'hub_obras') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_obra FROM public.projetos_obras WHERE orcamento_id = p_orcamento_id;
  IF FOUND THEN RETURN v_obra; END IF;   -- idempotente: não recopia itens
  SELECT * INTO v_opp FROM public.erp_crm_oportunidade WHERE orcamento_id = p_orcamento_id LIMIT 1;
  SELECT * INTO v_cfg FROM public.projetos_modulo_config WHERE company_id = v_orc.company_id;
  v_prefixo := COALESCE(NULLIF(v_cfg.prefixo_obra,''), 'OBRA');
  v_seq := COALESCE(v_cfg.contador_obra, 0) + 1;
  v_num := v_prefixo || '-' || to_char(now(),'YYYY') || '-' || lpad(v_seq::text, 4, '0');
  UPDATE public.projetos_modulo_config SET contador_obra = v_seq, updated_at = now() WHERE company_id = v_orc.company_id;
  INSERT INTO public.projetos_obras (
    company_id, numero, orcamento_id, oportunidade_id, nome, cliente_id, cliente_nome,
    endereco, cidade, bairro, status, responsavel_id, responsavel_nome, valor_previsto, data_inicio, created_by
  ) VALUES (
    v_orc.company_id, v_num, v_orc.id, v_opp.id,
    COALESCE(NULLIF(v_opp.titulo,''), v_orc.cliente_nome, 'Obra ' || v_num),
    v_orc.cliente_id, v_orc.cliente_nome, v_opp.obra_endereco, v_opp.obra_cidade, v_opp.obra_bairro,
    'em_andamento', v_opp.responsavel_id, v_opp.responsavel_nome, COALESCE(v_orc.total, 0), CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_obra;

  -- D4 · centro de custo da obra (cria se não houver um com o mesmo código); usuário pode trocar depois (tela)
  SELECT id INTO v_cc_id FROM public.erp_centros_custo
   WHERE company_id = v_orc.company_id AND codigo = v_obra.numero;
  IF v_cc_id IS NULL THEN
    INSERT INTO public.erp_centros_custo (company_id, nome, codigo, responsavel, ativo)
    VALUES (v_orc.company_id, v_obra.numero || ' · ' || COALESCE(v_obra.nome, v_obra.cliente_nome, 'Obra'),
            v_obra.numero, v_obra.responsavel_nome, true)
    RETURNING id INTO v_cc_id;
  END IF;
  UPDATE public.projetos_obras SET centro_custo_id = v_cc_id WHERE id = v_obra.id;

  -- ESCOPO CONGELADO · copia os itens do orçamento (só na criação — a idempotência acima protege)
  IF NOT EXISTS (SELECT 1 FROM public.projetos_obra_item WHERE obra_id = v_obra.id) THEN
    INSERT INTO public.projetos_obra_item (
      company_id, obra_id, orcamento_item_id, servico_id, ordem,
      descricao, unidade, quantidade_contratada, preco_unitario,
      custo_unitario_previsto, bdi_percentual, observacoes)
    SELECT i.company_id, v_obra.id, i.id, i.servico_id,
      COALESCE(i.ordem, (row_number() OVER (ORDER BY i.ordem NULLS LAST, i.created_at))::int),
      COALESCE(NULLIF(btrim(i.servico_descricao),''), NULLIF(btrim(i.produto_nome),''), NULLIF(btrim(i.produto_descricao),''), 'Item'),
      COALESCE(NULLIF(btrim(i.unidade),''), 'un'),
      COALESCE(i.quantidade, 0), COALESCE(i.preco_unitario, 0), COALESCE(i.preco_custo, 0),
      i.bdi_percentual, i.observacoes
    FROM public.erp_orcamentos_itens i WHERE i.orcamento_id = p_orcamento_id;
  END IF;

  -- marca o congelamento nas duas pontas + valor_previsto = soma do escopo congelado
  UPDATE public.erp_orcamentos SET escopo_congelado_em = COALESCE(escopo_congelado_em, now()) WHERE id = p_orcamento_id;
  UPDATE public.projetos_obras
     SET escopo_congelado_em = now(),
         valor_previsto = COALESCE((SELECT SUM(valor_contratado) FROM public.projetos_obra_item WHERE obra_id = v_obra.id AND excluido_em IS NULL), valor_previsto)
   WHERE id = v_obra.id;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = v_obra.id;  -- reflete centro/escopo/valor no retorno
  RETURN v_obra;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 4 · fn_obra_escopo (a tela de Obras lê daqui)
CREATE OR REPLACE FUNCTION public.fn_obra_escopo(p_obra_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_itens jsonb; v_tot record; v_cc jsonb; v_numero text;
BEGIN
  SELECT company_id, numero INTO v_company, v_numero FROM projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT jsonb_build_object('id', cc.id, 'codigo', cc.codigo, 'nome', cc.nome)
    INTO v_cc FROM projetos_obras ob LEFT JOIN erp_centros_custo cc ON cc.id = ob.centro_custo_id WHERE ob.id = p_obra_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'ordem', ordem, 'descricao', descricao, 'unidade', unidade,
      'quantidade_contratada', quantidade_contratada, 'quantidade_medida', quantidade_medida,
      'quantidade_a_medir', GREATEST(quantidade_contratada - quantidade_medida, 0),
      'pct_medido', CASE WHEN quantidade_contratada > 0 THEN round(quantidade_medida / quantidade_contratada * 100, 2) ELSE 0 END,
      'preco_unitario', preco_unitario, 'valor_contratado', valor_contratado,
      'valor_medido', round(quantidade_medida * preco_unitario, 2),
      'custo_unitario_previsto', custo_unitario_previsto, 'bdi_percentual', bdi_percentual
    ) ORDER BY ordem), '[]'::jsonb)
  INTO v_itens FROM projetos_obra_item WHERE obra_id = p_obra_id AND excluido_em IS NULL;
  SELECT COALESCE(SUM(valor_contratado),0) AS contratado,
         COALESCE(SUM(quantidade_medida * preco_unitario),0) AS medido,
         COALESCE(SUM(quantidade_contratada * custo_unitario_previsto),0) AS custo_previsto,
         count(*) AS qtd
  INTO v_tot FROM projetos_obra_item WHERE obra_id = p_obra_id AND excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'obra_numero', v_numero, 'centro_custo', v_cc, 'itens', v_itens,
    'total_itens', v_tot.qtd,
    'valor_contratado', round(v_tot.contratado, 2), 'valor_medido', round(v_tot.medido, 2),
    'valor_a_medir', round(v_tot.contratado - v_tot.medido, 2), 'custo_previsto', round(v_tot.custo_previsto, 2),
    'pct_fisico', CASE WHEN v_tot.contratado > 0 THEN round(v_tot.medido / v_tot.contratado * 100, 2) ELSE 0 END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_obra_escopo(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_obra_escopo(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA 5 · adicionar/excluir item de escopo (soft-delete, RD-30)
CREATE OR REPLACE FUNCTION public.fn_obra_item_adicionar(
  p_obra_id uuid, p_descricao text, p_unidade text, p_quantidade numeric, p_preco_unit numeric,
  p_servico_id uuid DEFAULT NULL, p_custo_unit numeric DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_ordem int; v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','obra_nao_encontrada'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(btrim(p_descricao),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'erro','descricao_obrigatoria','mensagem','Informe a descrição do item.'); END IF;
  SELECT COALESCE(MAX(ordem),0)+1 INTO v_ordem FROM projetos_obra_item WHERE obra_id = p_obra_id;
  INSERT INTO projetos_obra_item (company_id, obra_id, servico_id, ordem, descricao, unidade,
    quantidade_contratada, preco_unitario, custo_unitario_previsto, observacoes)
  VALUES (v_company, p_obra_id, p_servico_id, v_ordem, p_descricao,
    COALESCE(NULLIF(btrim(p_unidade),''),'un'),
    COALESCE(p_quantidade,0), COALESCE(p_preco_unit,0), COALESCE(p_custo_unit,0),
    'Incluído após o congelamento do escopo')
  RETURNING id INTO v_id;
  UPDATE projetos_obras
     SET valor_previsto = (SELECT COALESCE(SUM(valor_contratado),0) FROM projetos_obra_item WHERE obra_id = p_obra_id AND excluido_em IS NULL),
         updated_at = now()
   WHERE id = p_obra_id;
  RETURN jsonb_build_object('ok', true, 'item_id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_obra_item_adicionar(uuid,text,text,numeric,numeric,uuid,numeric) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_obra_item_adicionar(uuid,text,text,numeric,numeric,uuid,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_obra_item_excluir(p_item_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_obra uuid; v_medido numeric;
BEGIN
  SELECT company_id, obra_id, quantidade_medida INTO v_company, v_obra, v_medido FROM projetos_obra_item WHERE id = p_item_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','item_nao_encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(v_medido,0) > 0 THEN
    RETURN jsonb_build_object('ok',false,'erro','item_ja_medido','mensagem','Este item já foi medido e não pode ser removido do escopo.'); END IF;
  UPDATE projetos_obra_item
     SET excluido_em = now(), atualizado_em = now(),
         observacoes = COALESCE(observacoes,'') || ' | Excluído: ' || COALESCE(p_motivo,'sem motivo')
   WHERE id = p_item_id;
  UPDATE projetos_obras
     SET valor_previsto = (SELECT COALESCE(SUM(valor_contratado),0) FROM projetos_obra_item WHERE obra_id = v_obra AND excluido_em IS NULL),
         updated_at = now()
   WHERE id = v_obra;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_obra_item_excluir(uuid,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_obra_item_excluir(uuid,text) TO authenticated;
