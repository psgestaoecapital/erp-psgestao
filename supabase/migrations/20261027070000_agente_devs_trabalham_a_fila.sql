-- REGRA PERMANENTE DOS DEVS (CEO 26/10): dev trabalha a FILA, não é acordado por tarefa.
-- Mensagem tipo 'tarefa' para um Code de desenvolvimento NÃO aciona a rotina no envio: ela entra na caixa e o
-- Code a pega quando passar pela fila (despertador). Os demais gatilhos (pedido de OK do CEO, responder, avisos)
-- seguem iguais. Só troca o corpo do gatilho; nenhuma tabela, guarda ou grant muda.

CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_trg_acionar()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.arquivada
       AND NOT ( NEW.tipo = 'tarefa' AND NEW.para IN (
           'dev7claudeps','desenvolvedor_4_g','desenvolvedor_5_g','desenvolvedor_6_g',
           'code-desenvolvedor-3','gilberto-produto','gilberto-desenv',
           'gilberto-automotivo','gilberto-industria') )
    THEN
      PERFORM public.fn__agente_acionar(NEW.id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.requer_ok_ceo AND OLD.ok_ceo_em IS NULL AND NEW.ok_ceo_em IS NOT NULL AND NOT NEW.arquivada THEN
      PERFORM public.fn__agente_acionar(NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_mensagem_trg_acionar() FROM PUBLIC, anon, authenticated;
