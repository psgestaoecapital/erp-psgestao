-- Revisor acordável pelo banco (CEO 16/10 12:30): 'gilberto-revisor' passa a ser destino válido da caixa
-- (erp_agente_rotina_agente_check e erp_agente_mensagem_socio_so_aviso) e ganha a linha da rotina (aciona = true).
-- Até o CEO cadastrar agente_rotina_url_/token_gilberto-revisor no cofre, o acionamento responde
-- "rotina_nao_configurada_no_cofre" (esperado); a etiqueta no GitHub continua sendo o caminho.
ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT IF EXISTS erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check CHECK (agente = ANY (ARRAY[
  'gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados',
  'rodrigo-code','jordana-code','andre-code','stephany-code','teste-despertador','gilberto-esteira','gilberto-revisor']::text[]));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso CHECK (
  tipo = 'aviso'
  OR para = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados',
                       'teste-despertador','jordana-code','rodrigo-code','gilberto-esteira','gilberto-revisor']::text[])
  OR de ~ '^[a-z][a-z0-9]*-chat$');

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao)
VALUES ('gilberto-revisor', true, 'Revisor de PR sensível: autoriza com MERGE AUTORIZADO #N — gilberto-revisor · patch-id <40 hex>')
ON CONFLICT (agente) DO UPDATE SET aciona = true, atualizado_em = now();
