-- Libera 2 novos identificadores de agente na lista branca de erp_agente_rotina / erp_agente_mensagem
-- e registra as rotinas. Aditivo: só ACRESCENTA valores aos CHECKs.
--
-- dev7claudeps (Dev 2 do Hub, assinatura nova 26/10) — produz telas do Hub, faixa própria.
-- aud8claudeps (2º Auditor visual, assinatura nova 26/10) — loop foto->insight->nota nas telas do Hub.

BEGIN;

ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY[
    'gilberto-desenv', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
    'gilberto-chamados', 'rodrigo-code', 'jordana-code', 'andre-code', 'stephany-code',
    'teste-despertador', 'gilberto-esteira', 'gilberto-revisor', 'eng-chefe-auto',
    'code-desenvolvedor-3', 'desenvolvedor_4_g', 'desenvolvedor_5_g', 'desenvolvedor_6_g',
    'auditor_pdca_g', 'dev7claudeps', 'aud8claudeps'
  ]));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (
    (tipo = 'aviso')
    OR (para = ANY (ARRAY[
      'gilberto-desenv', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
      'gilberto-chamados', 'teste-despertador', 'desenvolvedor_4_g', 'desenvolvedor_5_g',
      'desenvolvedor_6_g', 'auditor_pdca_g', 'dev7claudeps', 'aud8claudeps'
    ]))
    OR (de ~ '^[a-z][a-z0-9]*-chat$')
    OR (de = 'eng_chefe')
  );

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao, atualizado_em) VALUES
  ('dev7claudeps', true, 'Dev 2 do Hub (assinatura nova 26/10). Produz telas do Hub, faixa propria. Corrige gaps do auditor ate nota>=95 + PDCA verde.', now()),
  ('aud8claudeps', true, '2o Auditor visual (assinatura nova 26/10). Loop foto->insight->nota nas telas do Hub, abre tarefa de correcao pro dev da faixa.', now())
ON CONFLICT (agente) DO UPDATE SET aciona = true, observacao = EXCLUDED.observacao, atualizado_em = now();

COMMIT;
