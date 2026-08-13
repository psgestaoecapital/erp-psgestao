-- RD-41 · Oportunidades: editar / excluir (soft) / retornar ao funil + HISTÓRICO auditável.
-- Adaptado ao schema real: as etapas são 'ganho'/'perdido' (não 'ganha'/'perdida'); abertas: prospeccao,
-- visita_agendada, visita_feita, orcando, proposta_enviada, negociacao. O valor editável na tela é
-- valor_estimado (o modal grava esse) — o trigger loga valor_estimado E valor_proposta (RD-57, qualquer campo).

-- PARTE A.1 — soft-delete (RD-55, aditivo RD-30)
ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- PARTE A.2 — tabela de histórico (o pedido central)
CREATE TABLE IF NOT EXISTS public.erp_crm_oportunidade_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  oportunidade_id uuid NOT NULL,
  acao text NOT NULL,                 -- criada|editada|etapa_mudou|ganha|perdida|retornou_funil|excluida|restaurada
  de_etapa text, para_etapa text,
  valor_antes numeric, valor_depois numeric,
  campo text, detalhe text,
  autor_id uuid, autor_nome text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE public.erp_crm_oportunidade_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hist_rls ON public.erp_crm_oportunidade_historico;
CREATE POLICY hist_rls ON public.erp_crm_oportunidade_historico
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE INDEX IF NOT EXISTS ix_crm_hist_oport ON public.erp_crm_oportunidade_historico (oportunidade_id, criado_em DESC);

-- PARTE B — trigger que registra criação, mudança de etapa e mudança de valor (RD-57, todos os caminhos)
CREATE OR REPLACE FUNCTION public.fn_crm_oport_historico_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_autor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,para_etapa,valor_depois,autor_id,detalhe)
    VALUES (NEW.company_id, NEW.id, 'criada', NEW.etapa, NEW.valor_estimado, v_autor,
      'Oportunidade criada · etapa '||COALESCE(NEW.etapa,'—'));
    RETURN NEW;
  END IF;

  -- mudança de etapa
  IF NEW.etapa IS DISTINCT FROM OLD.etapa THEN
    INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,de_etapa,para_etapa,autor_id,detalhe)
    VALUES (NEW.company_id, NEW.id,
      CASE WHEN NEW.etapa='ganho' THEN 'ganha'
           WHEN NEW.etapa='perdido' THEN 'perdida'
           WHEN OLD.etapa IN ('ganho','perdido') THEN 'retornou_funil'
           ELSE 'etapa_mudou' END,
      OLD.etapa, NEW.etapa, v_autor,
      'Etapa: '||COALESCE(OLD.etapa,'—')||' → '||COALESCE(NEW.etapa,'—'));
  END IF;

  -- mudança de valor estimado (o campo que o modal edita)
  IF COALESCE(NEW.valor_estimado,0) IS DISTINCT FROM COALESCE(OLD.valor_estimado,0) THEN
    INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,valor_antes,valor_depois,campo,autor_id,detalhe)
    VALUES (NEW.company_id, NEW.id,'editada',OLD.valor_estimado,NEW.valor_estimado,'valor_estimado',v_autor,
      'Valor estimado: '||COALESCE(OLD.valor_estimado::text,'—')||' → '||COALESCE(NEW.valor_estimado::text,'—'));
  END IF;

  -- mudança de valor proposta
  IF COALESCE(NEW.valor_proposta,0) IS DISTINCT FROM COALESCE(OLD.valor_proposta,0) THEN
    INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,valor_antes,valor_depois,campo,autor_id,detalhe)
    VALUES (NEW.company_id, NEW.id,'editada',OLD.valor_proposta,NEW.valor_proposta,'valor_proposta',v_autor,
      'Valor proposta: '||COALESCE(OLD.valor_proposta::text,'—')||' → '||COALESCE(NEW.valor_proposta::text,'—'));
  END IF;

  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS trg_crm_oport_historico ON public.erp_crm_oportunidade;
CREATE TRIGGER trg_crm_oport_historico AFTER INSERT OR UPDATE ON public.erp_crm_oportunidade
  FOR EACH ROW EXECUTE FUNCTION public.fn_crm_oport_historico_trg();

-- PARTE C — RPCs das 3 ações
-- EDITAR (título, valores, responsável, observações) — o trigger loga a mudança de valor
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_editar(p_company_id uuid, p_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_n int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  UPDATE erp_crm_oportunidade SET
    titulo=COALESCE(p_dados->>'titulo',titulo),
    valor_estimado=COALESCE((p_dados->>'valor_estimado')::numeric,valor_estimado),
    valor_proposta=COALESCE((p_dados->>'valor_proposta')::numeric,valor_proposta),
    responsavel_id=COALESCE(NULLIF(p_dados->>'responsavel_id','')::uuid,responsavel_id),
    responsavel_nome=COALESCE(p_dados->>'responsavel_nome',responsavel_nome),
    observacoes=COALESCE(p_dados->>'observacoes',observacoes),
    updated_at=now()
  WHERE id=p_id AND company_id=p_company_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok',true);
END $f$;

-- EXCLUIR (soft-delete, RD-55) + histórico
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_excluir(p_company_id uuid, p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_n int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  UPDATE erp_crm_oportunidade SET deleted_at=now(), updated_at=now()
    WHERE id=p_id AND company_id=p_company_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrada_ou_ja_excluida'); END IF;
  INSERT INTO erp_crm_oportunidade_historico(company_id,oportunidade_id,acao,autor_id,detalhe)
    VALUES (p_company_id,p_id,'excluida',auth.uid(),COALESCE(NULLIF(p_motivo,''),'Excluída pelo usuário'));
  RETURN jsonb_build_object('ok',true);
END $f$;

-- RETORNAR AO KANBAN (tira de ganho/perdido, volta pra etapa aberta) — trigger loga 'retornou_funil'.
-- Valor preservado (não mexe em valor_estimado/proposta); só limpa fechamento e motivo de perda.
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_retornar_funil(p_company_id uuid, p_id uuid, p_etapa_destino text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_n int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE(p_etapa_destino,'') IN ('','ganho','perdido') THEN
    RETURN jsonb_build_object('ok',false,'erro','etapa_destino_invalida'); END IF;
  UPDATE erp_crm_oportunidade SET etapa=p_etapa_destino, data_fechamento=NULL, motivo_perda=NULL, updated_at=now()
    WHERE id=p_id AND company_id=p_company_id AND deleted_at IS NULL AND etapa IN ('ganho','perdido');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrada_ou_nao_fechada'); END IF;
  RETURN jsonb_build_object('ok',true);
END $f$;

GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_editar(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_excluir(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_retornar_funil(uuid,uuid,text) TO authenticated;

-- PARTE D.1 — o funil/pipeline esconde as excluídas (deleted_at IS NULL)
CREATE OR REPLACE FUNCTION public.fn_crm_pipeline(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'etapas', (SELECT jsonb_agg(e) FROM (
      SELECT o.etapa,
             count(*) AS qtd,
             COALESCE(sum(o.valor_estimado),0) AS valor_total,
             jsonb_agg(jsonb_build_object(
               'id', o.id, 'titulo', o.titulo,
               'cliente', COALESCE(c.nome_fantasia, c.razao_social),
               'valor_estimado', o.valor_estimado, 'probabilidade', o.probabilidade,
               'responsavel_id', o.responsavel_id, 'ordem', o.ordem,
               'data_prevista', o.data_prevista_fechamento
             ) ORDER BY o.ordem) AS cards
      FROM erp_crm_oportunidade o
      LEFT JOIN erp_clientes c ON c.id=o.cliente_id
      WHERE o.company_id=p_company_id AND o.deleted_at IS NULL AND o.etapa NOT IN ('ganho','perdido')
      GROUP BY o.etapa) e),
    'resumo', (SELECT jsonb_build_object(
      'abertas', count(*) FILTER (WHERE etapa NOT IN ('ganho','perdido')),
      'ganhas_mes', count(*) FILTER (WHERE etapa='ganho' AND data_fechamento >= date_trunc('month', now())),
      'valor_pipeline', COALESCE(sum(valor_estimado) FILTER (WHERE etapa NOT IN ('ganho','perdido')),0))
      FROM erp_crm_oportunidade WHERE company_id=p_company_id AND deleted_at IS NULL)
  );
$function$;
