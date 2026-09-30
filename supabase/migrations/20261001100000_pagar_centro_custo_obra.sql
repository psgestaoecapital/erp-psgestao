-- CEO 01/10 · ordem nova, item 4 (pré-requisito da tela de viagem): centro de custo DE VERDADE no contas a pagar +
-- toda obra do Hub com o seu centro de custo — é o que liga a despesa à obra.
-- Antes (provado no dado 01/10): erp_pagar só tinha `centro_custo` TEXTO (632 de 15.387 títulos, 5 empresas); o editor
-- gravava o NOME. erp_receber já tinha centro_custo_id (FK). 28 das 34 obras sem centro de custo: só a obra criada a
-- partir de orçamento (fn_obra_criar_de_orcamento) ganhava um; a "obra rápida" do Hub não (FC: OBR-2026-0001 sem centro).
--
-- 1) erp_pagar.centro_custo_id → erp_centros_custo (FK, ON DELETE SET NULL). Trigger: o centro tem de ser da MESMA
--    empresa do título e o texto legado `centro_custo` passa a espelhar o nome (quem lê o texto segue funcionando:
--    fn_centro_custo_valores, fn_pec_custo_importar_do_pagar, view consolidada). Nenhum título existente é alterado
--    (RD-55): o texto antigo continua como está; o vínculo nasce nos lançamentos novos/editados.
-- 2) fn_pagar_editar_completo aceita centro_custo_id (mesma guarda de empresa); resto do corpo igual à 20260926270000.
-- 3) Toda obra tem centro de custo: trigger BEFORE INSERT em projetos_obras acha (codigo = número da obra) ou cria
--    "número · nome" — vale para qualquer caminho de criação. As 28 obras sem centro recebem o seu agora.
--    FK de projetos_obras.centro_custo_id (0 órfãos em 01/10) e guarda de empresa.
-- 4) fn_obras_custo(p_company_ids): custo lançado e pago por obra = títulos a pagar do centro de custo da obra.

-- ── 1) contas a pagar ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_pagar ADD COLUMN IF NOT EXISTS centro_custo_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_pagar_centro_custo_id_fkey') THEN
    ALTER TABLE public.erp_pagar ADD CONSTRAINT erp_pagar_centro_custo_id_fkey
      FOREIGN KEY (centro_custo_id) REFERENCES public.erp_centros_custo(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_erp_pagar_centro_custo_id ON public.erp_pagar (centro_custo_id) WHERE centro_custo_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_trg_pagar_centro_custo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cia uuid; v_nome text;
BEGIN
  IF NEW.centro_custo_id IS NULL THEN
    -- desvinculou: o texto que espelhava o centro sai junto (texto digitado à mão, sem vínculo, fica)
    IF TG_OP = 'UPDATE' AND OLD.centro_custo_id IS NOT NULL AND NEW.centro_custo IS NOT DISTINCT FROM OLD.centro_custo THEN
      NEW.centro_custo := NULL;
    END IF;
    RETURN NEW;
  END IF;
  SELECT c.company_id, c.nome INTO v_cia, v_nome FROM public.erp_centros_custo c WHERE c.id = NEW.centro_custo_id;
  IF v_cia IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Centro de custo não é desta empresa' USING ERRCODE = '42501';
  END IF;
  NEW.centro_custo := v_nome;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_pagar_centro_custo ON public.erp_pagar;
CREATE TRIGGER trg_pagar_centro_custo BEFORE INSERT OR UPDATE OF centro_custo_id ON public.erp_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_pagar_centro_custo();

-- ── 2) editor completo do título a pagar aceita o centro de custo ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pagar_editar_completo(p_id uuid, p_campos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tipos jsonb := jsonb_build_object(
    'fornecedor_id','uuid','centro_custo_id','uuid',
    'fornecedor_nome','text','descricao','text','categoria','text','valor','numeric',
    'data_emissao','date','data_vencimento','date','data_pagamento','date','data_competencia','date',
    'data_previsao','date',
    'forma_pagamento','text','numero_documento','text','numero_nf','text','codigo_barras','text',
    'parcela','text','conta_bancaria','text','centro_custo','text','linha_negocio','text',
    'juros','numeric','multa','numeric','desconto','numeric','observacoes','text',
    'recorrente','boolean','recorrencia_meses','integer',
    'tipo_chave_pix','text','chave_pix','text');
  v_notnull text[] := ARRAY['descricao','valor','data_vencimento'];
  v_antes jsonb; v_depois jsonb; v_company_id uuid; v_email text := public.fn_user_email_atual();
  v_sets text := ''; v_alterados jsonb; k text; t text;
BEGIN
  SELECT to_jsonb(p.*), p.company_id INTO v_antes, v_company_id FROM public.erp_pagar p WHERE p.id = p_id;
  IF v_antes IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  -- #71: fornecedor escolhido na edição tem de ser da mesma empresa do título
  IF NULLIF(p_campos->>'fornecedor_id','') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.erp_fornecedores f
        WHERE f.id = (p_campos->>'fornecedor_id')::uuid AND f.company_id = v_company_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'fornecedor_de_outra_empresa');
  END IF;
  -- 01/10: centro de custo idem (o trigger também barra; aqui volta como erro legível)
  IF NULLIF(p_campos->>'centro_custo_id','') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.erp_centros_custo c
        WHERE c.id = (p_campos->>'centro_custo_id')::uuid AND c.company_id = v_company_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'centro_custo_de_outra_empresa');
  END IF;
  FOR k, t IN SELECT * FROM jsonb_each_text(v_tipos) LOOP
    IF NOT (p_campos ? k) THEN CONTINUE; END IF;
    IF k = ANY(v_notnull) AND NULLIF(p_campos->>k,'') IS NULL THEN CONTINUE; END IF;
    v_sets := v_sets || format('%I = NULLIF($1->>%L,'''')::%s, ', k, k, t);
  END LOOP;
  IF v_sets = '' THEN RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'alterados', '{}'::jsonb, 'sem_mudanca', true); END IF;
  EXECUTE format('UPDATE public.erp_pagar SET %s updated_at = now() WHERE id = $2', v_sets) USING p_campos, p_id;
  SELECT to_jsonb(p.*) INTO v_depois FROM public.erp_pagar p WHERE p.id = p_id;
  SELECT COALESCE(jsonb_object_agg(kk, jsonb_build_object('de', v_antes->kk, 'para', v_depois->kk)), '{}'::jsonb)
    INTO v_alterados
  FROM (SELECT jsonb_object_keys(v_tipos) AS kk) s
  WHERE (v_antes->>kk) IS DISTINCT FROM (v_depois->>kk);
  IF v_alterados <> '{}'::jsonb THEN
    INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
    VALUES (p_id, v_email, 'EDITOU', v_alterados, 'erp_pagar');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'alterados', v_alterados);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pagar_editar_completo(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pagar_editar_completo(uuid, jsonb) TO authenticated, service_role;

-- ── 3) toda obra com centro de custo ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_obra_centro_custo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cia uuid;
BEGIN
  IF NEW.centro_custo_id IS NULL AND TG_OP = 'INSERT' AND NULLIF(btrim(NEW.numero), '') IS NOT NULL THEN
    SELECT c.id INTO NEW.centro_custo_id FROM public.erp_centros_custo c
     WHERE c.company_id = NEW.company_id AND c.codigo = NEW.numero
     ORDER BY c.created_at LIMIT 1;
    IF NEW.centro_custo_id IS NULL THEN
      INSERT INTO public.erp_centros_custo (company_id, nome, codigo, responsavel, ativo)
      VALUES (NEW.company_id, NEW.numero || ' · ' || COALESCE(NULLIF(btrim(NEW.nome), ''), NEW.cliente_nome, 'Obra'),
              NEW.numero, NEW.responsavel_nome, true)
      RETURNING id INTO NEW.centro_custo_id;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.centro_custo_id IS NOT NULL THEN
    SELECT c.company_id INTO v_cia FROM public.erp_centros_custo c WHERE c.id = NEW.centro_custo_id;
    IF v_cia IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Centro de custo não é desta empresa' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_obra_centro_custo ON public.projetos_obras;
CREATE TRIGGER trg_obra_centro_custo BEFORE INSERT OR UPDATE OF centro_custo_id ON public.projetos_obras
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_obra_centro_custo();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projetos_obras_centro_custo_id_fkey') THEN
    ALTER TABLE public.projetos_obras ADD CONSTRAINT projetos_obras_centro_custo_id_fkey
      FOREIGN KEY (centro_custo_id) REFERENCES public.erp_centros_custo(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.projetos_obras VALIDATE CONSTRAINT projetos_obras_centro_custo_id_fkey;
  END IF;
END $$;

-- obras que ficaram sem centro (criadas pela obra rápida do Hub): ganham o seu, pela mesma regra
DO $$
DECLARE o record; v_cc uuid;
BEGIN
  FOR o IN SELECT id, company_id, numero, nome, cliente_nome, responsavel_nome
             FROM public.projetos_obras
            WHERE centro_custo_id IS NULL AND NULLIF(btrim(numero), '') IS NOT NULL
            ORDER BY created_at LOOP
    v_cc := NULL;
    SELECT c.id INTO v_cc FROM public.erp_centros_custo c
     WHERE c.company_id = o.company_id AND c.codigo = o.numero ORDER BY c.created_at LIMIT 1;
    IF v_cc IS NULL THEN
      INSERT INTO public.erp_centros_custo (company_id, nome, codigo, responsavel, ativo)
      VALUES (o.company_id, o.numero || ' · ' || COALESCE(NULLIF(btrim(o.nome), ''), o.cliente_nome, 'Obra'),
              o.numero, o.responsavel_nome, true)
      RETURNING id INTO v_cc;
    END IF;
    UPDATE public.projetos_obras SET centro_custo_id = v_cc WHERE id = o.id;
  END LOOP;
END $$;

-- ── 4) custo por obra (o que foi lançado a pagar no centro de custo da obra) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obras_custo(p_company_ids uuid[])
 RETURNS TABLE(obra_id uuid, lancado numeric, pago numeric, a_pagar numeric, titulos integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id,
         COALESCE(sum(p.valor), 0)::numeric(14,2),
         COALESCE(sum(CASE WHEN p.status = 'pago' THEN COALESCE(p.valor_pago, p.valor) ELSE COALESCE(p.valor_pago, 0) END), 0)::numeric(14,2),
         COALESCE(sum(CASE WHEN p.status = 'pago' THEN 0 ELSE GREATEST(p.valor - COALESCE(p.valor_pago, 0), 0) END), 0)::numeric(14,2),
         count(p.id)::int
    FROM public.projetos_obras o
    LEFT JOIN public.erp_pagar p
      ON p.centro_custo_id = o.centro_custo_id
     AND p.company_id = o.company_id
     AND p.deleted_at IS NULL
     AND p.status <> 'cancelado'
   WHERE o.company_id = ANY(p_company_ids)
     AND o.company_id IN (SELECT public.get_user_company_ids())
     AND o.centro_custo_id IS NOT NULL
   GROUP BY o.id;
$function$;

REVOKE ALL ON FUNCTION public.fn_obras_custo(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_custo(uuid[]) TO authenticated, service_role;
