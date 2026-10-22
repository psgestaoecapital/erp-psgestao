-- ESTEIRA · META 15 min (CEO 14/10) — o eng_chefe passa a poder mandar TAREFA (não só aviso) aos Codes dos sócios ATIVOS,
-- para desenvolvimento e chamados fora da carteira quando houver backlog (créditos ociosos das contas deles).
-- Mantém: Code de sócio DESLIGADO (erp_agente_dono.ativo = false) segue só com aviso; remetente-chat só ao próprio dono;
-- núcleo/permissão/financeiro/fiscal seguem exigindo requer_ok_ceo (regra do AGENTS.md, aplicada pelo eng_chefe ao enviar).
-- Via revisada: CREATE OR REPLACE de função de gatilho existente + troca de CHECK.

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso'
      OR para IN ('gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','teste-despertador')
      OR de ~ '^[a-z][a-z0-9]*-chat$'
      OR de = 'eng_chefe');  -- a trava por Code ligado/desligado está no gatilho abaixo (CHECK não consulta outra tabela)

CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.de = 'eng_chefe' THEN
    -- tarefa a Code de sócio: só se o dono estiver ATIVO (desligado = só aviso)
    IF NEW.tipo = 'tarefa'
       AND NEW.para NOT IN ('gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','teste-despertador')
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
REVOKE ALL ON FUNCTION public.fn__agente_mensagem_remetente_chat() FROM PUBLIC, anon, authenticated;
