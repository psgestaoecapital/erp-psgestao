-- PDCA P&M · /dashboard/producao (auditor_pdca_1, 14/11) — vazamento e2e polui a DEMO (RD-69).
-- A aba "Clientes" da demo002 mostra 833 clientes "ativos", dos quais 825 têm nome INEQUÍVOCO de
-- teste (E2E…/[BOT]/screenshot) e só ~8 são do seed real. A limpeza fn_demo_pm_limpar_clientes_teste
-- já existe e roda no fn_demo_reset, MAS protegia qualquer cliente com "job ativo" — e o e2e cria
-- cliente + job juntos, então os 825 de teste nunca eram inativados.
--
-- Prova no dado (RD-38, SELECT simulando o WHERE, sem escrever):
--   demo002 agency_clientes ativos = 833; com nome E2E/[BOT]/screenshot = 825 (todos presos pela guarda
--   de job); com '%teste%' sem job = 0. Soltando a guarda só para os marcadores INEQUÍVOCOS, sobram ~8
--   ativos (o seed real). '%teste%' (ambíguo) mantém a proteção de job/contrato ativo.
--
-- Aditiva/idempotente (CREATE OR REPLACE). SOFT-delete (status='inativo', excluido_em) — reversível,
-- nunca apaga linha. Trava dura is_demo (nunca toca empresa real). O seed re-cria os clientes legítimos.
--
-- OBS (para o auditor/Eng. Chefe): agency_timesheet (1881 linhas) NÃO é tocado aqui — provei que NENHUMA
-- das linhas vivas liga a um cliente de teste (ts_de_cliente_teste = 0), então não há critério de nome
-- seguro para identificá-las. Limpá-las exige marcador confiável do e2e (item 2 do plano: as specs de P&M
-- limparem ao fim, ou taguearem as linhas) — fica como próximo, sem adivinhar e arriscar remover seed.

CREATE OR REPLACE FUNCTION public.fn_demo_pm_limpar_clientes_teste(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean;
  v_n integer := 0;
BEGIN
  IF p_company_id IS NULL THEN RETURN 0; END IF;
  SELECT c.is_demo INTO v_is_demo FROM public.companies c WHERE c.id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN RETURN 0; END IF;  -- trava dura: só DEMO

  UPDATE public.agency_clientes cl
  SET status = 'inativo',
      excluido_em = now(),
      updated_at = now()
  WHERE cl.company_id = p_company_id
    AND cl.excluido_em IS NULL
    AND COALESCE(cl.status, 'ativo') = 'ativo'
    AND (
      -- Marcadores INEQUÍVOCOS de e2e/bot/screenshot: limpa sempre (o job atrelado também é de teste).
      cl.nome ILIKE 'E2E%' OR cl.nome ILIKE '%[BOT]%' OR cl.nome ILIKE '%screenshot%'
      OR (
        -- '%teste%' é ambíguo (pode ser cliente real): só limpa quando não tem job/contrato ativo.
        cl.nome ILIKE '%teste%'
        AND NOT EXISTS (
          SELECT 1 FROM public.agency_jobs j
          WHERE j.cliente_id = cl.id
            AND j.company_id = p_company_id
            AND j.excluido_em IS NULL
            AND COALESCE(j.status, '') NOT IN
              ('concluido','concluida','entregue','entregues','publicado','publicada','cancelado','cancelada','arquivado','arquivada')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.agency_contratos c
          WHERE c.cliente_id = cl.id
            AND c.company_id = p_company_id
            AND c.status = 'ativo'
        )
      )
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
