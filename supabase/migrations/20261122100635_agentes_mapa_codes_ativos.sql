-- MAPA DE CODES ATIVOS (CEO 20/11/2026 16:32): "os que não estão rodando há 5 dias, exclua do banco; no
-- mapa ficam só os Codes que rodaram nos últimos 5 dias — esses são os ativos e estão no processo".
-- Levantamento de 15–20/11 (erp_code_execucao_log, erp_dev_entrega, respostas na caixa):
--   ATIVOS (11): code-desenvolvedor-3, desenvolvedor_4_g, desenvolvedor_5_g, dev7claudeps, rodrigo-code,
--   jordana-code, gilberto-esteira, gilberto-revisor, aud8claudeps, auditor_pdca_1, auditor_pdca_2.
--   SEM RODAR em 5 dias (saem do mapa): desenvolvedor_6_g, auditor_pdca_g, gilberto-desenv, gilberto-chamados,
--   gilberto-produto, gilberto-automotivo, gilberto-industria, eng-chefe-auto, andre-code, stephany-code.
-- Também religa auditor_pdca_1/auditor_pdca_2 para receber TAREFA (rodavam toda hora, mas o gatilho os
-- tratava como desligados e o PDCA 1 passava a maioria das rodadas sem trabalho).
-- Não apaga nada (o histórico fica); não toca dado de cliente.

-- 1) O banco não permite apagar o cadastro (o histórico de mensagens referencia o Code por FK, e o histórico
--    não pode ser apagado). Então o Code sai do mapa de forma PERMANENTE: ativo=false, nunca aciona.
ALTER TABLE public.erp_agente_rotina ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE public.erp_agente_rotina ADD COLUMN IF NOT EXISTS inativado_em timestamptz;
COMMENT ON COLUMN public.erp_agente_rotina.ativo IS
  'Mapa de Codes ativos (CEO 20/11/2026): false = Code fora do processo, permanentemente; não recebe tarefa nem é acionado.';

UPDATE public.erp_agente_rotina
   SET ativo = false, aciona = false, inativado_em = now(), atualizado_em = now(),
       observacao = 'INATIVO (CEO 20/11/2026): sem rodar de 15 a 20/11; fora do mapa de Codes ativos. ' || coalesce(observacao, '')
 WHERE agente IN ('desenvolvedor_6_g','auditor_pdca_g','gilberto-desenv','gilberto-chamados','gilberto-produto',
                  'gilberto-automotivo','gilberto-industria','eng-chefe-auto','andre-code','stephany-code')
   AND ativo;

-- 3) dev7claudeps volta a receber chamados e GAPS (CEO reativou a rotina em 20/11)
UPDATE public.erp_agente_papel SET pausado = false, atualizado_em = now(),
       observacao = 'Reativado pelo CEO 20/11/2026 16:20 (mapa de Codes ativos)'
 WHERE agente = 'dev7claudeps' AND pausado;

-- 4) Fila única de chamados: só devs que rodam
CREATE OR REPLACE FUNCTION public.fn_devs_pool()
 RETURNS TABLE(agente text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT a FROM (VALUES
    ('dev7claudeps'),
    ('code-desenvolvedor-3'),
    ('desenvolvedor_4_g'),
    ('rodrigo-code'),
    ('jordana-code')
  ) AS x(a);
$function$;
REVOKE ALL ON FUNCTION public.fn_devs_pool() FROM PUBLIC, anon;

-- 5) Quem recebe TAREFA do eng_chefe: só os Codes ativos (+ os dois auditores PDCA religados)
CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.de = 'eng_chefe' THEN
    IF NEW.tipo = 'tarefa'
       AND NEW.para NOT IN ('gilberto-esteira','code-desenvolvedor-3','teste-despertador','desenvolvedor_4_g','desenvolvedor_5_g','dev7claudeps','aud8claudeps','auditor_pdca_1','auditor_pdca_2')
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
REVOKE ALL ON FUNCTION public.fn__agente_mensagem_remetente_chat() FROM PUBLIC, anon;

-- 6) Caixa dos que saíram: mensagens abertas são arquivadas (o trabalho foi redistribuído pelo Eng. Chefe)
DO $$
DECLARE m record;
BEGIN
  FOR m IN SELECT id FROM public.erp_agente_mensagem
            WHERE para IN ('desenvolvedor_6_g','auditor_pdca_g','gilberto-desenv','gilberto-chamados','gilberto-produto',
                           'gilberto-automotivo','gilberto-industria','eng-chefe-auto','andre-code','stephany-code')
              AND status IN ('nova','recebida','em_andamento') AND NOT coalesce(arquivada, false)
  LOOP
    PERFORM public.fn_agente_mensagem_arquivar(m.id);
  END LOOP;
END $$;

-- 7) Fluxograma da infraestrutura: papéis = só os Codes ativos
CREATE OR REPLACE FUNCTION public.fn_infra_fluxograma()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT jsonb_build_object(
  'atualizado_em', now(),
  'esteira', fn_esteira_saude(),
  'codes', fn_codes_saude(),
  'papeis', jsonb_build_object(
     'code-desenvolvedor-3','Dev do núcleo (financeiro, fiscal, cadastros, permissões) + EHS-0/EHS-1/EHS-F',
     'desenvolvedor_4_g','Dev EHS (riscos, higiene, eSocial) + Hub',
     'desenvolvedor_5_g','Dev de emergência + EHS modo prestador e campo',
     'dev7claudeps','Dev EHS (saúde, EPI, treinamentos) + Hub',
     'rodrigo-code','Code do sócio Rodrigo (carteira dele)',
     'jordana-code','Code da sócia Jordana (carteira dela)',
     'gilberto-esteira','Guardião da esteira',
     'gilberto-revisor','Revisor das PRs sensíveis',
     'aud8claudeps','Auditor visual tela a tela (portão do selo)',
     'auditor_pdca_1','Auditor de jornadas (EHS)',
     'auditor_pdca_2','Auditor de jornadas (Gestão Empresarial)'),
  'ult_publicada_min', (SELECT round(EXTRACT(EPOCH FROM (now()-max(ocorrido_em)))/60) FROM erp_dev_entrega WHERE evento='publicada'),
  'em_teste', (SELECT count(*) FROM erp_esteira_pr_estado WHERE estado='esperando' AND motivo ILIKE '%checks rodando%'),
  'esperando', (SELECT count(*) FROM erp_esteira_pr_estado WHERE estado='esperando'),
  'relogio_ativo', EXISTS(SELECT 1 FROM cron.job WHERE jobname='monitor-merge-tick' AND active),
  'auditores_ativos', (SELECT count(*) FROM cron.job WHERE active AND (jobname ILIKE '%auditor%' OR jobname ILIKE '%gold%' OR jobname ILIKE '%screen-watcher%' OR jobname ILIKE '%truth%'))
);
$function$;
REVOKE ALL ON FUNCTION public.fn_infra_fluxograma() FROM PUBLIC, anon;
