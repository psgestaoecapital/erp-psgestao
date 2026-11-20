-- MAPA DE CODES ATIVOS (CEO 20/11/2026 16:32): "os que não estão rodando há 5 dias, exclua do banco; no
-- mapa ficam só os Codes que rodaram nos últimos 5 dias — esses são os ativos e estão no processo".
-- Levantamento de 15–20/11 (erp_code_execucao_log, erp_dev_entrega, respostas na caixa):
--   ATIVOS (11): code-desenvolvedor-3, desenvolvedor_4_g, desenvolvedor_5_g, dev7claudeps, rodrigo-code,
--   jordana-code, gilberto-esteira, gilberto-revisor, aud8claudeps, auditor_pdca_1, auditor_pdca_2.
--   SEM RODAR em 5 dias (saem do mapa): desenvolvedor_6_g, auditor_pdca_g, gilberto-desenv, gilberto-chamados,
--   gilberto-produto, gilberto-automotivo, gilberto-industria, eng-chefe-auto, andre-code, stephany-code.
-- Também religa auditor_pdca_1/auditor_pdca_2 para receber TAREFA (rodavam toda hora, mas o gatilho os
-- tratava como desligados e o PDCA 1 passava a maioria das rodadas sem trabalho).
-- Cópia de segurança antes de apagar. Não toca dado de cliente.

-- 1) Cópias de segurança (só leitura de serviço)
CREATE TABLE IF NOT EXISTS public.erp_agente_rotina_bkp_20261120 AS
  SELECT * FROM public.erp_agente_rotina WHERE false;
INSERT INTO public.erp_agente_rotina_bkp_20261120
  SELECT r.* FROM public.erp_agente_rotina r
   WHERE r.agente IN ('desenvolvedor_6_g','auditor_pdca_g','gilberto-desenv','gilberto-chamados','gilberto-produto',
                      'gilberto-automotivo','gilberto-industria','eng-chefe-auto','andre-code','stephany-code')
     AND NOT EXISTS (SELECT 1 FROM public.erp_agente_rotina_bkp_20261120 b WHERE b.agente = r.agente);
ALTER TABLE public.erp_agente_rotina_bkp_20261120 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_agente_rotina_bkp_20261120 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.erp_agente_dono_bkp_20261120 AS
  SELECT * FROM public.erp_agente_dono WHERE false;
INSERT INTO public.erp_agente_dono_bkp_20261120
  SELECT d.* FROM public.erp_agente_dono d
   WHERE d.agente IN ('andre-code','stephany-code') AND NOT d.ativo
     AND NOT EXISTS (SELECT 1 FROM public.erp_agente_dono_bkp_20261120 b WHERE b.agente = d.agente);
ALTER TABLE public.erp_agente_dono_bkp_20261120 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_agente_dono_bkp_20261120 FROM PUBLIC, anon, authenticated;

-- 2) Sai do mapa quem não roda
DELETE FROM public.erp_agente_rotina
 WHERE agente IN ('desenvolvedor_6_g','auditor_pdca_g','gilberto-desenv','gilberto-chamados','gilberto-produto',
                  'gilberto-automotivo','gilberto-industria','eng-chefe-auto','andre-code','stephany-code');
DELETE FROM public.erp_agente_dono WHERE agente IN ('andre-code','stephany-code') AND NOT ativo;

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
