-- Agentes v3 (complemento, mensagem 60a65c7f): ids gilberto-automotivo (faixa 15) e gilberto-industria (faixa 25).
-- Existem nos checks e em erp_agente_rotina, mas desligados (aciona=false) até a etapa futura. Aditivo e idempotente.
ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT IF EXISTS erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','rodrigo-code','jordana-code','andre-code','stephany-code']));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso' OR para = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados']));

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao) VALUES
  ('gilberto-automotivo', false, 'Desenvolvedor da vertical Automotivo; faixa 15; liga em etapa futura'),
  ('gilberto-industria',  false, 'Desenvolvedor da vertical Indústria; faixa 25; liga em etapa futura')
ON CONFLICT (agente) DO NOTHING;
