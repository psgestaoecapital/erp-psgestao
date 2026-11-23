-- fix(hub/subempreiteiros): reaprovar medição não pode estourar 23505 ao gerar o título a pagar
--
-- BUG (GAP A da auditoria PDCA 21/11, introduzido no #5244/#5418):
--   O índice único uq_erp_pagar_ref_externa cobre TODA linha com ref_externa_id (inclusive
--   cancelada/soft-deletada). Ao desaprovar a medição o gatilho CANCELA o título (status='cancelado',
--   deleted_at=now()) mas mantém o ref. Ao REAPROVAR, o teste de idempotência só enxerga título VIVO
--   (deleted_at IS NULL AND status<>'cancelado'), não acha nenhum e cai no INSERT — que colide com a
--   linha cancelada e quebra com ERRO CRU "duplicate key value violates unique constraint
--   uq_erp_pagar_ref_externa" (SQLSTATE 23505). O fluxo real aprovar→desaprovar→reaprovar fica travado.
--
-- CORREÇÃO (aditiva, só este gatilho): o INSERT de geração vira INSERT ... ON CONFLICT DO UPDATE,
--   que REVIVE a linha cancelada (status='aberto', deleted_at=NULL) com os valores recalculados da
--   medição atual. A cláusula WHERE garante que só revive linha cancelada/soft-deletada — nunca mexe
--   num título vivo (que já teria retornado antes pela idempotência) nem num título pago/conciliado
--   (o estorno não cancela esses, então a idempotência retorna e não se chega ao INSERT).
--
-- Prova RD-38 (tabela temporária espelhando o índice parcial, sem tocar dado de produção):
--   INSERT atual sobre ref com linha cancelada → unique_violation (23505) reproduzido.
--   INSERT ... ON CONFLICT DO UPDATE → 1 linha, status='aberto', deleted_at=NULL, valor recalculado.

CREATE OR REPLACE FUNCTION public.fn_sub_medicao_gerar_pagar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref      text;
  v_obra     record;
  v_contrato record;
  v_forn_nome text;
  v_cc       uuid;
  v_liquido  numeric;
  v_desc     text;
  v_venc     date;
  v_comp     date;
BEGIN
  v_ref := NEW.id::text;

  -- ESTORNO: medição excluída ou que deixou de estar aprovada → cancela o título ainda não pago/conciliado.
  IF (TG_OP = 'UPDATE') AND (
        (NEW.excluido_em IS NOT NULL AND OLD.excluido_em IS NULL)
     OR (OLD.status = 'aprovada' AND NEW.status IS DISTINCT FROM 'aprovada')
     ) THEN
    UPDATE public.erp_pagar
       SET status = 'cancelado', deleted_at = now(), updated_at = now()
     WHERE ref_externa_sistema = 'obra_subempreiteiro_medicao' AND ref_externa_id = v_ref
       AND deleted_at IS NULL AND status <> 'cancelado'
       AND COALESCE(valor_pago, 0) = 0 AND COALESCE(conciliado, false) = false;
    RETURN NEW;
  END IF;

  -- GERAÇÃO: só quando aprovada, não excluída e com valor bruto.
  IF NOT (NEW.status = 'aprovada' AND NEW.excluido_em IS NULL AND COALESCE(NEW.valor_bruto, 0) > 0) THEN
    RETURN NEW;
  END IF;

  -- IDEMPOTENTE: já existe título vivo para esta medição?
  IF EXISTS (
    SELECT 1 FROM public.erp_pagar
     WHERE ref_externa_sistema = 'obra_subempreiteiro_medicao' AND ref_externa_id = v_ref
       AND deleted_at IS NULL AND status <> 'cancelado'
  ) THEN
    RETURN NEW;
  END IF;

  -- LÍQUIDO = bruto − retenção − INSS − ISS (as três reduções já validadas em ≤ 100% no salvar).
  v_liquido := round(
      NEW.valor_bruto
    - (NEW.valor_bruto * COALESCE(NEW.retencao_pct, 0) / 100.0)
    - (NEW.valor_bruto * COALESCE(NEW.inss_pct, 0)     / 100.0)
    - (NEW.valor_bruto * COALESCE(NEW.iss_pct, 0)      / 100.0), 2);
  IF v_liquido <= 0 THEN
    RETURN NEW;  -- líquido zerado (100% retido) não gera título a pagar
  END IF;

  SELECT id, company_id, numero, nome INTO v_obra
    FROM public.projetos_obras WHERE id = NEW.obra_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT ct.fornecedor_id INTO v_contrato
    FROM public.obra_subempreiteiro_contrato ct WHERE ct.id = NEW.contrato_id;

  SELECT COALESCE(NULLIF(btrim(f.nome_fantasia), ''), NULLIF(btrim(f.razao_social), ''), 'Subempreiteiro')
    INTO v_forn_nome
    FROM public.erp_fornecedores f WHERE f.id = v_contrato.fornecedor_id;
  v_forn_nome := COALESCE(v_forn_nome, 'Subempreiteiro');

  -- Garante o centro de custo da obra, para o título aparecer no custo/Resultado da obra.
  v_cc := public.fn_obra_centro_custo_garantir(NEW.obra_id);

  v_venc := CURRENT_DATE + 30;  -- vencimento padrão: 30 dias da aprovação
  v_comp := COALESCE(NEW.competencia, date_trunc('month', v_venc)::date);
  v_desc := format('Medição subempreiteiro %s - %s - Obra %s',
                   COALESCE(NEW.numero, '?'), v_forn_nome,
                   COALESCE(v_obra.nome, v_obra.numero, 'obra'));

  -- GERA ou REVIVE: ON CONFLICT trata a reaprovação (a linha cancelada de uma desaprovação anterior
  -- mantém o ref e o índice único a enxerga). Revive apenas linha cancelada/soft-deletada, com os
  -- valores recalculados da medição atual; nunca toca em título vivo ou pago.
  INSERT INTO public.erp_pagar (
    company_id, descricao, categoria, valor, fornecedor_id, fornecedor_nome,
    data_emissao, data_vencimento, data_competencia, centro_custo_id, status,
    ref_externa_id, ref_externa_sistema, observacoes
  ) VALUES (
    v_obra.company_id, v_desc, 'Subempreiteiro', v_liquido, v_contrato.fornecedor_id, v_forn_nome,
    CURRENT_DATE, v_venc, v_comp, v_cc, 'aberto',
    v_ref, 'obra_subempreiteiro_medicao',
    format('Gerado automaticamente da medição %s do subempreiteiro (obra %s) em %s — líquido já com retenção (%s%%), INSS (%s%%) e ISS (%s%%) descontados.',
           COALESCE(NEW.numero, '?'), COALESCE(v_obra.numero, '?'), now()::date,
           COALESCE(NEW.retencao_pct, 0), COALESCE(NEW.inss_pct, 0), COALESCE(NEW.iss_pct, 0))
  )
  ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL
  DO UPDATE SET
    descricao       = EXCLUDED.descricao,
    categoria       = EXCLUDED.categoria,
    valor           = EXCLUDED.valor,
    fornecedor_id   = EXCLUDED.fornecedor_id,
    fornecedor_nome = EXCLUDED.fornecedor_nome,
    data_emissao    = EXCLUDED.data_emissao,
    data_vencimento = EXCLUDED.data_vencimento,
    data_competencia= EXCLUDED.data_competencia,
    centro_custo_id = EXCLUDED.centro_custo_id,
    status          = 'aberto',
    deleted_at      = NULL,
    observacoes     = EXCLUDED.observacoes,
    updated_at      = now()
  WHERE public.erp_pagar.deleted_at IS NOT NULL OR public.erp_pagar.status = 'cancelado';

  RETURN NEW;
END
$function$;

-- Guarda de superfície (check:fn-guards): função SECURITY DEFINER só executa pelo gatilho da tabela
-- obra_subempreiteiro_medicao; não é chamável por cliente anônimo.
REVOKE ALL ON FUNCTION public.fn_sub_medicao_gerar_pagar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sub_medicao_gerar_pagar() TO authenticated, service_role;
