-- fix(ge · DEMO · /dashboard/financeiro/conciliacao, /receber): purga durável das baixas órfãs da DEMO GE
-- code-desenvolvedor-3 · RD-38 (provado no dado) · RD-69 (DEMO sem poluição de teste) · RD-97 (UPDATE em volume = SENSÍVEL)
--
-- PROBLEMA (provado no dado 23/11, read-only): o #5747 purgou (soft-delete) os títulos-lixo de erp_receber da DEMO GE
-- (b0700000-0000-4000-a000-000000000004), mas as baixas FILHAS desses títulos ficaram VIVAS e órfãs — e o lado PAGAR
-- nunca teve purga alguma. Estado atual:
--   erp_receber_baixa vivas com título pai soft-deletado (is_demo): 38.485 (R$ 7.597.142,36)
--   erp_pagar_baixa   vivas com título pai soft-deletado (is_demo): 20.889 (R$ 6.744.940,05)
-- Fora da DEMO (empresas REAIS) há órfãs legítimas e MÍNIMAS (receber 3/R$410, pagar 26/R$11.950) de títulos que o
-- cliente excluiu — NUNCA tocadas aqui (guarda is_demo). A exposição de produção dessas órfãs (fluxo-caixa realizado
-- fantasma) é corrigida à parte na tarefa-irmã (fn_fluxo_caixa_diario, PR do dia). Esta migration é HIGIENE da DEMO:
-- sem ela, conciliação/auditoria da DEMO ficam poluídas por ~59k baixas fantasma.
--
-- FIX (durável, espelha o padrão #5747): estende fn_demo_ge_receber_purgar_lixo_teste com um passo de "órfãs históricas"
-- — soft-delete (reversível, com backup) de TODA baixa VIVA cujo título pai já está soft-deletado, para receber E pagar,
-- SÓ na empresa is_demo. Como a função já é chamada no início de fn_demo_seed_ge_financeiro (a cada fn_demo_reset), a
-- DEMO se auto-cura e não re-acumula. Idempotente (guarda deleted_at IS NULL): reexecutar não altera nada.
-- Aditiva/segura: nenhum dado de cliente real é tocado; soft-delete rastreável e REVERSÍVEL (backup + undo abaixo).
-- Faixa de segundos :42 (code-desenvolvedor-3). PR SENSÍVEL (revisao-eng-chefe).

-- ── Cópia de segurança do lado PAGAR (o lado RECEBER já tem erp_receber_baixa_lixo_teste_bkp_c3 do #5747) ──
CREATE TABLE IF NOT EXISTS public.erp_pagar_baixa_lixo_teste_bkp_c3 (
  baixa_id       uuid PRIMARY KEY,
  pagar_id       uuid,
  company_id     uuid,
  valor          numeric,
  data           date,
  deleted_at_old timestamptz,
  capturado_em   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_pagar_baixa_lixo_teste_bkp_c3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_pagar_baixa_lixo_teste_bkp_c3 FROM anon;

CREATE OR REPLACE FUNCTION public.fn_demo_ge_receber_purgar_lixo_teste(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tit int := 0;
  v_bx  int := 0;
  v_orf_rec int := 0;
  v_orf_pag int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.is_demo = true) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_ausente_ou_nao_demo');
  END IF;

  -- Guarda de empresa (check_fn_guards): se chamada por usuário logado, só o dono/admin da empresa.
  -- No reset da DEMO (service_role, auth.uid() NULL) o guarda retorna cedo — no-op seguro.
  PERFORM public.fn__guarda_empresa(p_company);

  DROP TABLE IF EXISTS _lixo_c3;  -- re-chamável na mesma transação (ON COMMIT DROP só cai no commit)
  CREATE TEMP TABLE _lixo_c3 ON COMMIT DROP AS
  SELECT r.id
    FROM public.erp_receber r
   WHERE r.company_id = p_company
     AND r.deleted_at IS NULL
     AND NOT (
          COALESCE(r.descricao    ILIKE 'DEMO-GE-FIN%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Demo%', false)
       OR COALESCE(r.numero_documento, '') ~ '^(PED|DEMO)'
     )
     AND (
          COALESCE(r.cliente_nome ILIKE 'Cliente E2E %', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Antigo', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Novo', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Aceita%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Achado%', false)
       OR COALESCE(r.cliente_nome ILIKE 'CIELO ACEITE%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Unificar duplicado%', false)
       OR COALESCE(r.cliente_nome ILIKE 'E2E %', false)
       OR COALESCE(r.descricao    ILIKE '%E2E%', false)
       OR COALESCE(r.descricao    ILIKE 'Contas500%', false)
       OR COALESCE(r.descricao    ILIKE 'Aceita%', false)
     );

  INSERT INTO public.erp_receber_lixo_teste_bkp_c3 (receber_id, company_id, cliente_nome, descricao, valor, status, deleted_at_old)
  SELECT r.id, r.company_id, r.cliente_nome, r.descricao, r.valor, r.status, r.deleted_at
    FROM public.erp_receber r JOIN _lixo_c3 l ON l.id = r.id
  ON CONFLICT (receber_id) DO NOTHING;

  INSERT INTO public.erp_receber_baixa_lixo_teste_bkp_c3 (baixa_id, receber_id, company_id, valor, data, deleted_at_old)
  SELECT b.id, b.receber_id, b.company_id, b.valor, b.data, b.deleted_at
    FROM public.erp_receber_baixa b JOIN _lixo_c3 l ON l.id = b.receber_id
   WHERE b.deleted_at IS NULL
  ON CONFLICT (baixa_id) DO NOTHING;

  UPDATE public.erp_receber_baixa b
     SET deleted_at = now()
    FROM _lixo_c3 l
   WHERE b.receber_id = l.id
     AND b.deleted_at IS NULL;
  GET DIAGNOSTICS v_bx = ROW_COUNT;

  UPDATE public.erp_receber r
     SET deleted_at = now()
    FROM _lixo_c3 l
   WHERE r.id = l.id
     AND r.deleted_at IS NULL;
  GET DIAGNOSTICS v_tit = ROW_COUNT;

  -- ── Órfãs históricas (23/11): baixa VIVA cujo título pai já está soft-deletado — leak do cascade (#5747 não
  --    cobriu as já excluídas) e o lado PAGAR, nunca coberto. Reversível (backup) e idempotente (deleted_at IS NULL).
  --    Guarda p_company (is_demo, já validada acima) + pai deleted_at IS NOT NULL: nunca toca empresa real nem baixa viva.
  --    RD-97 (AJUSTES revisor 24/11): o gatilho de recompute é silenciado com `SET LOCAL session_replication_role=
  --    'replica'` — escopo TRANSAÇÃO, NÃO pega ACCESS EXCLUSIVE table-wide (ao contrário do `ALTER TABLE … DISABLE
  --    TRIGGER`, que travaria as tabelas de baixa COMPARTILHADAS p/ todos os tenants). Também evita disparar a função
  --    de recompute por-linha no volume acumulado da DEMO (lição do incidente 03/10): o pai JÁ está soft-deletado,
  --    recomputar seu valor_pago é inútil. Restaurado para 'origin' logo após o par de UPDATEs (não vaza p/ o resto
  --    do fn_demo_reset). Set-based, idempotente (deleted_at IS NULL).
  INSERT INTO public.erp_receber_baixa_lixo_teste_bkp_c3 (baixa_id, receber_id, company_id, valor, data, deleted_at_old)
  SELECT b.id, b.receber_id, b.company_id, b.valor, b.data, b.deleted_at
    FROM public.erp_receber_baixa b
    JOIN public.erp_receber er ON er.id = b.receber_id
   WHERE b.company_id = p_company AND b.deleted_at IS NULL AND er.deleted_at IS NOT NULL
  ON CONFLICT (baixa_id) DO NOTHING;

  INSERT INTO public.erp_pagar_baixa_lixo_teste_bkp_c3 (baixa_id, pagar_id, company_id, valor, data, deleted_at_old)
  SELECT b.id, b.pagar_id, b.company_id, b.valor, b.data, b.deleted_at
    FROM public.erp_pagar_baixa b
    JOIN public.erp_pagar ep ON ep.id = b.pagar_id
   WHERE b.company_id = p_company AND b.deleted_at IS NULL AND ep.deleted_at IS NOT NULL
  ON CONFLICT (baixa_id) DO NOTHING;

  -- Silencia o recompute por-linha só nesta transação (sem lock de tabela). Restaura 'origin' logo após.
  SET LOCAL session_replication_role = 'replica';

  UPDATE public.erp_receber_baixa b
     SET deleted_at = now()
    FROM public.erp_receber er
   WHERE er.id = b.receber_id
     AND b.company_id = p_company AND b.deleted_at IS NULL AND er.deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_orf_rec = ROW_COUNT;

  UPDATE public.erp_pagar_baixa b
     SET deleted_at = now()
    FROM public.erp_pagar ep
   WHERE ep.id = b.pagar_id
     AND b.company_id = p_company AND b.deleted_at IS NULL AND ep.deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_orf_pag = ROW_COUNT;

  SET LOCAL session_replication_role = 'origin';

  RETURN jsonb_build_object('ok', true, 'company', p_company,
    'titulos_purgados', v_tit, 'baixas_purgadas', v_bx,
    'orfas_receber_purgadas', v_orf_rec, 'orfas_pagar_purgadas', v_orf_pag);
END
$function$;

-- ── SEM backfill one-shot no deploy (AJUSTES revisor 23/11 · RD-97 / lição 03/10, espelha #5929) ──
-- A purga do acumulado (~59k baixas órfãs da DEMO) NÃO roda inline no `supabase db push`: isso pegaria lock pesado
-- nas tabelas de baixa compartilhadas durante o deploy. A auto-cura cobre o acumulado no PRÓXIMO fn_demo_reset:
-- esta migration estende fn_demo_ge_receber_purgar_lixo_teste para TAMBÉM soft-deletar as órfãs históricas (bloco
-- acima, guardado por is_demo (p_company) + pai soft-deletado; recompute silenciado por session_replication_role,
-- sem lock de tabela). O gatilho da auto-cura é a chamada
-- `PERFORM fn_demo_ge_receber_purgar_lixo_teste(b0700000-…-004)` dentro de fn_demo_seed_ge_financeiro, instalada
-- pela irmã #5929 (que religa o seed p/ chamar receber+pagar). Quando as duas estiverem na main, o 1º reset da DEMO
-- limpa o acumulado sem lock no deploy. Idempotente (deleted_at IS NULL): re-rodar não altera nada.

-- UNDO (reversível, se necessário): reativar as baixas da DEMO a partir dos backups —
--   UPDATE erp_receber_baixa b SET deleted_at = k.deleted_at_old FROM erp_receber_baixa_lixo_teste_bkp_c3 k WHERE k.baixa_id=b.id;
--   UPDATE erp_pagar_baixa   b SET deleted_at = k.deleted_at_old FROM erp_pagar_baixa_lixo_teste_bkp_c3   k WHERE k.baixa_id=b.id;

-- check_fn_guards: REVOKE/GRANT da função (espelha ACL viva: authenticated, service_role; sem anon/PUBLIC)
REVOKE ALL ON FUNCTION public.fn_demo_ge_receber_purgar_lixo_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_ge_receber_purgar_lixo_teste(uuid) TO authenticated, service_role;
