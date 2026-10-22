-- Bootstrap do Code Esteira — partes SENSÍVEIS (CEO aprova e mergeia à mão).
-- Code: rodrigo-code · Autorizado pelo CEO em sessão (20/10). Via revisada.
-- Item 1 (WAKE CONTÍNUO): repointa o cron 78 (esteira-dono-5min) para um batimento garantido a cada 5 min SEMPRE que
--   houver trabalho possível (PR na fila OU main vermelha OU vaga suja), independente de evento novo. O em_andamento
--   órfão é tratado pelo próprio fn_agente_acionar: com lease ATIVA ele é no-op (sessão viva); com lease morta ele
--   dispara nova sessão — reconciliação pela lease, sem editar status na mão (RD-INFRA-01).
-- Item 3 (ENDEREÇÁVEL): inclui 'gilberto-esteira' na allowlist do guardião para o eng_chefe poder lhe mandar TAREFA.
-- NÃO toca vault, nem DDL de domínio. Idempotente e seguro onde o cron/pg_cron não existe (banco de testes).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Allowlist do guardião: eng_chefe pode mandar TAREFA ao gilberto-esteira (item 3)
--    Mesma lógica de antes; só acrescenta 'gilberto-esteira' à lista de Codes internos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.de = 'eng_chefe' THEN
    -- tarefa a Code de sócio: só se o dono estiver ATIVO (desligado = só aviso)
    IF NEW.tipo = 'tarefa'
       AND NEW.para NOT IN ('gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','gilberto-esteira','teste-despertador')
       AND NOT EXISTS (SELECT 1 FROM erp_agente_dono d WHERE d.agente = NEW.para AND d.ativo) THEN
      RAISE EXCEPTION 'Code % está desligado: só aviso, tarefa não', NEW.para USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.de = 'ceo' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_dono d WHERE d.remetente_chat = NEW.de AND d.agente = NEW.para AND d.ativo) THEN
    RAISE EXCEPTION 'remetente % só fala com o Code do próprio dono ativo (destino %)', NEW.de, NEW.para USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo <> 'tarefa' OR NEW.enviado_por IS DISTINCT FROM NEW.de THEN
    RAISE EXCEPTION 'pedido do canal PS: tipo tarefa e enviado_por = %', NEW.de USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
-- Trigger function (disparada pelo sistema no INSERT; o EXECUTE não é exigido no fire do trigger). REVOKE por convenção/gate.
REVOKE ALL ON FUNCTION public.fn__agente_mensagem_remetente_chat() FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Wake contínuo: repointa o cron 78 'esteira-dono-5min' (item 1)
--    Antes: só acionava com (PR esperando/fora) E (evento novo OU 15 min) — dormia entre eventos.
--    Agora: a cada 5 min (o schedule do job) SEMPRE que o plantão está parado há ≥ 5 min E há trabalho possível:
--      - PR na fila (erp_esteira_pr_estado em esperando/fora-da-rodada/fora), OU
--      - main vermelha (erp_dev_main_teste.verde = false), OU
--      - vaga suja (reserva recente liberada em < 5 min da criação → montagem abortou).
--    Guardado: sem pg_cron / sem o job (ex.: banco de testes), apenas avisa e sai.
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE v_job bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente neste ambiente — repoint do esteira-dono-5min pulado';
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'esteira-dono-5min';
  IF v_job IS NULL THEN
    RAISE NOTICE 'job esteira-dono-5min ausente — repoint pulado';
    RETURN;
  END IF;
  PERFORM cron.alter_job(v_job, command => $cmd$SELECT public.fn_agente_acionar(m.id) FROM public.erp_agente_mensagem m WHERE m.id = 'cbe0c36e-538f-4970-bb58-23004e75928b' AND m.status NOT IN ('concluida','recusada') AND NOT coalesce(m.arquivada,false) AND m.atualizado_em < now() - interval '5 minutes' AND ( EXISTS (SELECT 1 FROM public.erp_esteira_pr_estado e WHERE e.estado IN ('esperando','fora-da-rodada','fora')) OR EXISTS (SELECT 1 FROM public.erp_dev_main_teste t WHERE t.verde = false) OR EXISTS (SELECT 1 FROM public.erp_esteira_vaga_reserva r WHERE r.liberada_em IS NOT NULL AND r.criada_em > now() - interval '30 minutes' AND r.liberada_em - r.criada_em < interval '5 minutes') )$cmd$);
  RAISE NOTICE 'esteira-dono-5min repointado (wake contínuo): job %', v_job;
END $mig$;
