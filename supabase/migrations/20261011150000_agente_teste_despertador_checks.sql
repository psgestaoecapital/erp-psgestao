-- Aceitação dos agentes (CEO 11/10) · faixa 00 (gilberto-desenv). Aditiva: só ALARGA dois CHECKs.
-- Os specs do despertador/lease/encerrar dependiam do estado VIVO de erp_agente_rotina (agentes reais congelados com
-- aciona=false → disparos=[]). Passam a usar um agente de TESTE reservado ('teste-despertador'), ligado só durante o
-- spec e removido no teardown. Nenhum agente real é ligado/desligado. Nenhuma linha é inserida aqui.
ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT IF EXISTS erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-chamados','rodrigo-code','jordana-code','andre-code','stephany-code','teste-despertador']));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso' OR para IN ('gilberto-desenv','gilberto-produto','gilberto-chamados','teste-despertador') OR de ~ '^[a-z][a-z0-9]*-chat$');
