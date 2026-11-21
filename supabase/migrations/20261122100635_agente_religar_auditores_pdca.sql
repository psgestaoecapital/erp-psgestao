-- CEO 20/11/2026 16:20: o auditor_pdca_2 está ATIVO na conta dele (rotina de hora em hora), mas o banco o
-- tratava como "desligado" e recusava tarefa do eng_chefe ("Code ... está desligado: só aviso, tarefa não").
-- Resultado: ele acordava toda hora e achava a caixa vazia. Religa auditor_pdca_1 e auditor_pdca_2 na
-- lista de Codes que recebem tarefa do eng_chefe (foco total Hub + EHS + GE).
-- Única mudança na função: os dois nomes na lista. Corpo igual à definição viva (pg_get_functiondef em 20/11).

CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.de = 'eng_chefe' THEN
    IF NEW.tipo = 'tarefa'
       AND NEW.para NOT IN ('gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','gilberto-esteira','code-desenvolvedor-3','teste-despertador','desenvolvedor_4_g','desenvolvedor_5_g','desenvolvedor_6_g','auditor_pdca_g','dev7claudeps','aud8claudeps','auditor_pdca_1','auditor_pdca_2')
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
