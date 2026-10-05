-- Agentes v3 (CEO 05/10), continuação. Aditiva. Faixa de migration 00 (gilberto-desenv).
-- Novos ids gilberto-automotivo (faixa 15) e gilberto-industria (faixa 25): entram nos CHECKs da rotina e da mensagem
-- (podem receber tarefa) e em erp_agente_rotina com aciona=false (ligam em etapa futura). Nenhuma função é alterada.

ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT IF EXISTS erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','rodrigo-code','jordana-code','andre-code','stephany-code']));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso' OR para = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados']));

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao) VALUES
  ('gilberto-automotivo', false, 'Desenvolvedor da vertical automotiva (Oficina); faixa 15; liga em etapa futura'),
  ('gilberto-industria',  false, 'Desenvolvedor da vertical indústria; faixa 25; liga em etapa futura')
ON CONFLICT (agente) DO NOTHING;
