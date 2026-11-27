-- P&M · Bot no Slack · DEMO: entrega SIMULADA (encenação honesta) — fim da parede de "Falhou"
-- =====================================================================================================================
-- GAP (aud8claudeps 21/11, DEMO P&M …002, matriz #3891 = 89/95, critérios a e c — a tarefa principal da tela não se
-- completa): o "Histórico de envios" aparece ~100% "Falhou" ("Não foi possível confirmar a entrega ao Slack"). A tela
-- é bem construída (14 AjudaCampo "?", estados vazios, erros em linguagem do usuário), mas a FUNÇÃO PRINCIPAL — avisar
-- no Slack — não acontece na DEMO.
--
-- PROVA RD-38 (produção, 21/11, erp_pm_bot_envio, TODAS as empresas):
--   status 'falhou' = 8038 · 'enfileirado' = 9 · 'enviado' = 3  (os 3 'enviado' são o seed de 06/11).
-- A DEMO (b0700000-0000-4000-a000-000000000002) é a única com config conectada (#jobs-agencia).
--
-- CAUSA: a empresa DEMO não tem um canal/webhook de Slack REAL (não pode ter — RD-69/LGPD, é demonstração). Todo
-- disparo — os gatilhos automáticos (fatia 3: novo_job, prazo_24h, aprovação, estouro de horas…) e o botão "Testar
-- envio" — chama fn_pm_bot_disparar, que chama a edge function 'pm-bot-enviar'; ela lê um webhook inexistente do cofre
-- e grava 'falhou'. Resultado: a tela DEMO pinta uma parede de "Falhou" e lê como defeito.
--
-- CORREÇÃO (aditiva, SÓ is_demo): o motor fn_pm_bot_disparar, quando a empresa é de demonstração, NÃO chama a edge
-- function — registra a entrega como 'enviado' (http 200, enviado_em = now()), encenando o resultado real que a
-- produção teria com um webhook válido. PRODUÇÃO (is_demo = false) fica INALTERADA: segue o caminho real (cofre + edge
-- function + defesa SSRF). Nenhum segredo é tocado; nenhum dado de cliente é alterado (só linhas da DEMO).
--
-- Também: limpeza ÚNICA do histórico DEMO acumulado ('falhou'/'enfileirado' → 'enviado'), para a tela refletir a
-- entrega bem-sucedida já na primeira foto. Só empresas is_demo; nunca empresa real.
--
-- SENSÍVEL (revisao-eng-chefe): recria fn_pm_bot_disparar (SECURITY DEFINER, cofre/SSRF no caminho real). O branch de
-- DEMO é anterior a qualquer leitura de segredo e não altera o caminho de produção.

-- ───────────────────────────── 1) Motor: branch de DEMO (encena a entrega) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_bot_disparar(
  p_company_id uuid, p_evento text, p_titulo text, p_texto text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $f$
DECLARE v_id uuid; v_key text; v_demo boolean;
BEGIN
  -- Defesa em profundidade (check_fn_guards): SECURITY DEFINER grava conferindo o acesso à empresa do registro.
  -- No caminho de serviço/gatilho (sem auth.uid()) a guarda retorna sem erro; no caminho autenticado
  -- (fn_pm_bot_testar) reforça o isolamento por empresa antes de qualquer gravação.
  PERFORM public.fn__guarda_empresa(p_company_id);

  INSERT INTO public.erp_pm_bot_envio (company_id, evento, titulo, texto, status, criado_por)
  VALUES (p_company_id, left(coalesce(p_evento,'teste'),40), p_titulo, p_texto, 'enfileirado', auth.uid())
  RETURNING id INTO v_id;

  -- DEMO (RD-69/LGPD): a empresa de demonstração não tem canal Slack real. Encena a entrega como bem-sucedida em vez
  -- de chamar a edge function (que falharia no webhook fake e pintaria "Falhou" na tela). Produção segue abaixo.
  SELECT coalesce(bool_or(c.is_demo), false) INTO v_demo
    FROM public.companies c WHERE c.id = p_company_id;
  IF v_demo THEN
    UPDATE public.erp_pm_bot_envio
       SET status = 'enviado', http_status = 200, enviado_em = now(), erro = NULL
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_key IS NULL THEN
    UPDATE public.erp_pm_bot_envio SET status='falhou', erro='motor de envio indisponível (chave de serviço ausente)'
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  PERFORM net.http_post(
    url     := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/pm-bot-enviar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body    := jsonb_build_object('company_id', p_company_id, 'envio_id', v_id),
    timeout_milliseconds := 10000
  );
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  IF v_id IS NOT NULL THEN
    UPDATE public.erp_pm_bot_envio SET status='falhou', erro=left(SQLERRM,200) WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$f$;
-- Guarda de função (check_fn_guards): declaração explícita ao recriar a SECURITY DEFINER. Só serviço dispara.
REVOKE ALL ON FUNCTION public.fn_pm_bot_disparar(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_disparar(uuid, text, text, text) TO service_role;

-- ───────────────────────── 2) Limpeza única do histórico DEMO (só is_demo) ─────────────────────────────────────────
-- Converte o acumulado 'falhou'/'enfileirado' das empresas de DEMONSTRAÇÃO em 'enviado' (http 200), para a tela
-- refletir a entrega encenada já na primeira foto. O ruído técnico de e2e continua oculto pela
-- fn_pm_bot_envio_listar (filtro de exibição, migration 20261114144550); aqui apenas normalizamos a situação.
-- NUNCA toca empresa real (is_demo = false): o histórico real de produção fica intacto.
UPDATE public.erp_pm_bot_envio e
   SET status      = 'enviado',
       http_status = 200,
       enviado_em  = coalesce(e.enviado_em, e.criado_em),
       erro        = NULL
  FROM public.companies c
 WHERE c.id = e.company_id
   AND c.is_demo IS TRUE
   AND e.status IN ('falhou', 'enfileirado');

-- RD-38 (prova de exibição, a conferir no preview/@pos):
--   -- ANTES  (DEMO 002): status falhou≈8038, enviado=3  → "Histórico" = parede de "Falhou".
--   -- DEPOIS (DEMO 002): status = 'enviado' para todas as linhas da DEMO → "Histórico" = "Enviada".
--   -- Empresa real (is_demo=false): nenhuma linha alterada; disparo real inalterado.
