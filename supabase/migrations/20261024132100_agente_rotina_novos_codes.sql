-- 20261024132100_agente_rotina_novos_codes.sql
-- Libera 4 novos identificadores de agente (3 Codes de desenvolvimento do Hub + 2º auditor
-- PDCA) na lista branca de erp_agente_rotina / erp_agente_mensagem. Aditivo: só ACRESCENTA
-- valores aos CHECKs, nenhuma linha existente é alterada ou removida.
--
-- desenvolvedor_4_g  (Opus 5.5)  — Hub Projetos: Viagens + cálculo/rateio no GE
-- desenvolvedor_5_g  (Sonnet 5)  — Hub Projetos: comercial (visitas/clientes/oportunidades/propostas/simulador)
-- desenvolvedor_6_g  (Sonnet 5)  — Hub Projetos: engenharia/take-off + contrato de preços BRF/medição
-- auditor_pdca_g     (Sonnet 5)  — 2º auditor PDCA, audita as telas dos 3 acima + code-desenvolvedor-3

BEGIN;

ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY[
    'gilberto-desenv', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
    'gilberto-chamados', 'rodrigo-code', 'jordana-code', 'andre-code', 'stephany-code',
    'teste-despertador', 'gilberto-esteira', 'gilberto-revisor', 'eng-chefe-auto',
    'code-desenvolvedor-3',
    'desenvolvedor_4_g', 'desenvolvedor_5_g', 'desenvolvedor_6_g', 'auditor_pdca_g'
  ]));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (
    (tipo = 'aviso')
    OR (para = ANY (ARRAY[
      'gilberto-desenv', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
      'gilberto-chamados', 'teste-despertador',
      'desenvolvedor_4_g', 'desenvolvedor_5_g', 'desenvolvedor_6_g', 'auditor_pdca_g'
    ]))
    OR (de ~ '^[a-z][a-z0-9]*-chat$')
    OR (de = 'eng_chefe')
  );

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao) VALUES
  ('desenvolvedor_4_g', true, 'Hub Projetos — Viagens + cálculo/rateio GE (Opus 5.5), ativado 24/10'),
  ('desenvolvedor_5_g', true, 'Hub Projetos — comercial: visitas/clientes/oportunidades/propostas/simulador, ativado 24/10'),
  ('desenvolvedor_6_g', true, 'Hub Projetos — engenharia/take-off + contrato BRF/medição, ativado 24/10'),
  ('auditor_pdca_g', true, '2º auditor PDCA — audita code-desenvolvedor-3/desenvolvedor_4_g/desenvolvedor_6_g, ativado 24/10')
ON CONFLICT (agente) DO UPDATE SET aciona = true, observacao = EXCLUDED.observacao, atualizado_em = now();

COMMIT;
