-- CEO 16/10 · faixa 00. Aditiva: só ALARGA dois CHECKs (acrescenta 'gilberto-revisor' e 'eng-chefe-auto'; nada removido)
-- e cadastra as duas rotinas em erp_agente_rotina (aciona = true). Sem a URL/token no cofre, o acionamento responde
-- "rotina_nao_configurada_no_cofre" (esperado até o CEO cadastrar). eng-chefe-auto = auditor de plantão, guardião da RD-97.
ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT IF EXISTS erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','rodrigo-code','jordana-code','andre-code','stephany-code','teste-despertador','gilberto-esteira','gilberto-revisor','eng-chefe-auto']));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso' OR para = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','teste-despertador','jordana-code','rodrigo-code','gilberto-esteira','gilberto-revisor','eng-chefe-auto']) OR de ~ '^[a-z][a-z0-9]*-chat$');

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao) VALUES
  ('gilberto-revisor', true, 'Revisor das PRs sensíveis (MERGE AUTORIZADO por patch-id)'),
  ('eng-chefe-auto', true, 'Auditor de plantão, guardião da RD-97 (CEO 16/10)')
ON CONFLICT (agente) DO UPDATE SET aciona = EXCLUDED.aciona, observacao = EXCLUDED.observacao, atualizado_em = now();
