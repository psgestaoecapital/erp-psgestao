-- Hub · Gestão de Obras · aba Subempreiteiros → MEDIÇÕES (Blueprint §16 H7 · slice 2b — parte 2/2). Code: desenvolvedor_4_g.
--
-- A parte 1/2 (migration 20261120011045) completou o CÁLCULO do líquido da medição do subempreiteiro:
-- bruto − retenção contratual − INSS retido − ISS retido. Faltava a PONTE: quando a medição é APROVADA,
-- nasce um título a PAGAR na GE (erp_pagar) com esse líquido, no centro de custo da obra, para o subempreiteiro
-- aparecer no financeiro e no Resultado da obra ("da obra ao resultado"). Sem esta ponte, o medido do sub
-- ficava só no Hub e o custo real da obra não enxergava o subempreiteiro.
--
-- RD-26: REUSA a GE (erp_pagar) e o centro de custo da obra (fn_obra_centro_custo_garantir) — NÃO recria
-- financeiro. Espelha exatamente o modelo já aprovado do lado do CLIENTE (fn_obra_medicao_gerar_receber,
-- trigger trg_obra_medicao_gerar_receber): trigger interno SECURITY DEFINER, idempotência por ref_externa,
-- estorno ao cancelar/desaprovar o título ainda não pago.
--
-- Regras:
--  - só gera quando status='aprovada', não excluída e valor_bruto > 0 (rascunho/cancelada não geram);
--  - valor do título = LÍQUIDO (bruto − retenção − INSS − ISS), arredondado a 2 casas;
--  - IDEMPOTENTE: aprovar/editar 2x não duplica (guarda por ref_externa_sistema='obra_subempreiteiro_medicao'
--    + ref_externa_id = id da medição);
--  - ESTORNO: medição excluída (excluido_em) ou que deixa de estar 'aprovada' → cancela o título gerado
--    (só se ainda não pago/conciliado — dado financeiro real nunca é apagado aqui);
--  - empresa: o título entra na MESMA empresa da obra/medição (company_id), que a RLS já guardou na aprovação;
--  - fornecedor: o do contrato do subempreiteiro (fornecedor_id), com o nome resolvido de erp_fornecedores.
--
-- Migration ADITIVA e idempotente: cria a função de trigger e o trigger (DROP IF EXISTS antes), e estende a
-- leitura para expor o título gerado (pagar_id/pagar_valor). RLS/REVOKE anon das tabelas já ligados.
--
-- Prova RD-38 (ROLLBACK, abaixo neste arquivo em comentário): medição R$ 40.000 com 5% ret + 11% INSS + 5% ISS
--  → líquido R$ 31.600,00 → 1 título a pagar de R$ 31.600,00 no centro da obra; aprovar de novo → ainda 1;
--  cancelar a medição → título cancelado.

-- 1) Função de trigger: medição aprovada → título a pagar pelo líquido ---------------------------------------
-- ci-sem-guarda: fn_sub_medicao_gerar_pagar — função de trigger interna; grava o pagar na MESMA empresa da
-- obra/medição (NEW.company_id), que a RLS de obra_subempreiteiro_medicao já guardou na aprovação. Sem GRANT a
-- usuário (função de trigger, revogada de PUBLIC/anon). Espelha fn_obra_medicao_gerar_receber (lado cliente).
CREATE OR REPLACE FUNCTION public.fn_sub_medicao_gerar_pagar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
  );

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_sub_medicao_gerar_pagar() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_sub_medicao_gerar_pagar ON public.obra_subempreiteiro_medicao;
CREATE TRIGGER trg_sub_medicao_gerar_pagar
  AFTER INSERT OR UPDATE OF status, excluido_em ON public.obra_subempreiteiro_medicao
  FOR EACH ROW EXECUTE FUNCTION public.fn_sub_medicao_gerar_pagar();

-- 2) Leitura: expõe o título a pagar gerado por cada medição (pagar_id/pagar_valor), para a tela mostrar o elo.
--    Reescreve fn_obra_subempreiteiro_medicao_listar acrescentando apenas os dois campos do título gerado.
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_medicao_listar(p_contrato_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_company uuid;
  v_rows    jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.obra_subempreiteiro_contrato
   WHERE id = p_contrato_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'data_medicao') DESC, (m->>'criado_em') DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', md.id,
      'numero', md.numero,
      'competencia', md.competencia,
      'data_medicao', md.data_medicao,
      'valor_bruto', md.valor_bruto,
      'retencao_pct', md.retencao_pct,
      'inss_pct', md.inss_pct,
      'iss_pct', md.iss_pct,
      'valor_retencao', round(md.valor_bruto * md.retencao_pct / 100.0, 2),
      'valor_inss', round(md.valor_bruto * md.inss_pct / 100.0, 2),
      'valor_iss', round(md.valor_bruto * md.iss_pct / 100.0, 2),
      'valor_liquido', round(md.valor_bruto
                             - (md.valor_bruto * md.retencao_pct / 100.0)
                             - (md.valor_bruto * md.inss_pct / 100.0)
                             - (md.valor_bruto * md.iss_pct / 100.0), 2),
      'status', md.status,
      'observacoes', md.observacoes,
      'criado_em', md.criado_em,
      -- Título a pagar gerado pela aprovação (ponte slice 2b parte 2/2), quando houver:
      'pagar_id', (SELECT p.id FROM public.erp_pagar p
                    WHERE p.ref_externa_sistema = 'obra_subempreiteiro_medicao'
                      AND p.ref_externa_id = md.id::text
                      AND p.deleted_at IS NULL AND p.status <> 'cancelado' LIMIT 1),
      'pagar_valor', (SELECT p.valor FROM public.erp_pagar p
                    WHERE p.ref_externa_sistema = 'obra_subempreiteiro_medicao'
                      AND p.ref_externa_id = md.id::text
                      AND p.deleted_at IS NULL AND p.status <> 'cancelado' LIMIT 1),
      'itens', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', it.id,
          'contrato_item_id', it.contrato_item_id,
          'descricao', it.descricao,
          'unidade', it.unidade,
          'quantidade', it.quantidade,
          'preco_unitario', it.preco_unitario,
          'valor', it.valor,
          'ordem', it.ordem
        ) ORDER BY it.ordem, it.criado_em)
        FROM public.obra_subempreiteiro_medicao_item it
        WHERE it.medicao_id = md.id AND it.excluido_em IS NULL
      ), '[]'::jsonb)
    ) AS m
    FROM public.obra_subempreiteiro_medicao md
    WHERE md.contrato_id = p_contrato_id AND md.excluido_em IS NULL
  ) q;

  RETURN jsonb_build_object('ok', true, 'contrato_id', p_contrato_id, 'medicoes', v_rows);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_medicao_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_medicao_listar(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_sub_medicao_gerar_pagar() IS 'Blueprint §16 H7 slice 2b parte 2/2: ao aprovar uma medição de subempreiteiro, gera em erp_pagar (GE) o título a pagar pelo líquido (bruto − retenção − INSS − ISS), no centro de custo da obra, idempotente por ref_externa e com estorno ao cancelar/desaprovar. Espelha fn_obra_medicao_gerar_receber (lado cliente).';
