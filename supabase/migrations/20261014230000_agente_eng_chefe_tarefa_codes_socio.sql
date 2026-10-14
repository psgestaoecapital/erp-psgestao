-- Meta CEO 14/10: o eng_chefe passa a poder mandar TAREFA (não só aviso) ao Code de sócio ATIVO
-- (erp_agente_dono.ativo), para desenvolvimento/chamados fora da carteira quando há backlog.
-- Mantém a trava para Code de sócio desligado. Núcleo/permissão/financeiro/fiscal seguem exigindo OK do CEO
-- (regra 4 do Canal PS, aplicada pelo Code via pode_executar). Corrige o check do 05/10 (msg f19d2b63).
ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso' OR para IN ('gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','teste-despertador')
         OR de ~ '^[a-z][a-z0-9]*-chat$' OR de IN ('eng_chefe','ceo'));

CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.de IN ('eng_chefe','ceo') THEN
    -- tarefa para Code de sócio só se o dono estiver ativo; desligado = só aviso
    IF NEW.tipo <> 'aviso' AND EXISTS (SELECT 1 FROM erp_agente_dono d WHERE d.agente = NEW.para AND NOT d.ativo) THEN
      RAISE EXCEPTION 'Code de sócio % está desligado: só aviso', NEW.para USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
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
