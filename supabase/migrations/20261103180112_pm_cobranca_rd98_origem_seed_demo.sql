-- PDCA P&M · /dashboard/pm/cobranca (aud8 85 -> >=95)
-- Code: dev7claudeps
--
-- Fecha os gaps de DADO do auditor (auditor_pdca_2, 01/11) sem tocar a jornada que ja esta verde:
--  (1) RD-98 p3 (ORIGEM DO DADO): system_screens.rpcs_chamadas da rota estava VAZIO e views_consumidas
--      nao citava o ledger agency_cobranca_lancamento. Preenche os dois (metadado de auditoria, nao e dado de cliente).
--  (3) SEED DEMO: a empresa P&M DEMO (b0700000-0000-4000-a000-000000000002) tinha 5 contratos recorrentes
--      ativos e 0 lancamentos -> o Historico abria vazio. Semeia a jornada lancada->enviada->paga + 1 estorno
--      APENAS na DEMO, derivando dos contratos VIVOS (sem id hardcoded), idempotente por (contrato,competencia).
--
-- ADITIVA: so UPDATE de metadado (system_screens) e INSERT guardado na empresa DEMO. Nao altera/remove
-- nenhum dado de cliente real nem titulo/parcela paga. Escopo por company_id. RD-38 provado no dado antes do push.

-- (1) RD-98 p3 — origem do dado da tela
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[
      'fn_agency_cobranca_listar',
      'fn_agency_cobranca_lancar',
      'fn_agency_cobranca_status',
      'fn_agency_cobranca_estornar'
    ],
    views_consumidas = ARRAY['agency_clientes','agency_contratos','agency_cobranca_lancamento'],
    atualizado_em = now()
WHERE rota = '/dashboard/pm/cobranca';

-- (3) SEED DEMO — historico de cobrancas (somente empresa DEMO, idempotente)
WITH demo AS (
  SELECT c.id AS contrato_id, c.company_id, c.cliente_id, c.fee_mensal,
         row_number() OVER (ORDER BY c.criado_em, c.id) AS rn
  FROM public.agency_contratos c
  WHERE c.company_id = 'b0700000-0000-4000-a000-000000000002'
    AND c.tipo = 'recorrente'
    AND c.status = 'ativo'
),
linhas AS (
  -- Setembro/2026: mes fechado, todas pagas
  SELECT contrato_id, company_id, cliente_id,
         DATE '2026-09-01' AS competencia, fee_mensal AS valor, 'paga'::text AS status,
         TIMESTAMPTZ '2026-09-02 12:00:00+00' AS lancado_em,
         TIMESTAMPTZ '2026-09-03 09:00:00+00' AS enviado_em,
         TIMESTAMPTZ '2026-09-10 15:00:00+00' AS pago_em,
         NULL::timestamptz AS estornado_em, NULL::text AS motivo_estorno,
         'Fechamento de setembro/2026 (dado de demonstracao)'::text AS observacao
  FROM demo
  UNION ALL
  -- Outubro/2026: pagas, exceto 1 contrato que teve a cobranca estornada
  SELECT contrato_id, company_id, cliente_id,
         DATE '2026-10-01', fee_mensal,
         CASE WHEN rn = 3 THEN 'estornada' ELSE 'paga' END,
         TIMESTAMPTZ '2026-10-02 12:00:00+00',
         CASE WHEN rn = 3 THEN NULL ELSE TIMESTAMPTZ '2026-10-03 09:00:00+00' END,
         CASE WHEN rn = 3 THEN NULL ELSE TIMESTAMPTZ '2026-10-10 15:00:00+00' END,
         CASE WHEN rn = 3 THEN TIMESTAMPTZ '2026-10-05 10:00:00+00' ELSE NULL END,
         CASE WHEN rn = 3 THEN 'Cliente renegociou o fee — cobranca refeita (demonstracao)' ELSE NULL END,
         'Competencia outubro/2026 (dado de demonstracao)'
  FROM demo
  UNION ALL
  -- Novembro/2026 (mes corrente): 1 enviada, 1 lancada; os demais ficam "A lancar" (sem linha)
  SELECT contrato_id, company_id, cliente_id,
         DATE '2026-11-01', fee_mensal,
         CASE WHEN rn = 1 THEN 'enviada' ELSE 'lancada' END,
         TIMESTAMPTZ '2026-11-01 08:00:00+00',
         CASE WHEN rn = 1 THEN TIMESTAMPTZ '2026-11-01 09:00:00+00' ELSE NULL END,
         NULL::timestamptz, NULL::timestamptz, NULL::text,
         'Competencia novembro/2026 (dado de demonstracao)'
  FROM demo
  WHERE rn IN (1, 2)
)
INSERT INTO public.agency_cobranca_lancamento
  (company_id, contrato_id, cliente_id, competencia, valor, status,
   lancado_em, enviado_em, pago_em, estornado_em, motivo_estorno, observacao)
SELECT company_id, contrato_id, cliente_id, competencia, valor, status,
       lancado_em, enviado_em, pago_em, estornado_em, motivo_estorno, observacao
FROM linhas l
WHERE NOT EXISTS (
  SELECT 1 FROM public.agency_cobranca_lancamento x
  WHERE x.contrato_id = l.contrato_id AND x.competencia = l.competencia
);

-- (4) RD-95 — "?" dos 2 KPIs financeiros novos do mes (Recebido / Em aberto)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, '/dashboard/pm/cobranca', 'Cobrança · Indicadores', v.rotulo, v.oqp, v.pqs, v.ex, v.erro, 'pm', v.ordem
FROM (VALUES
  ('pm.cobranca.kpi_recebido', 'Recebido no mês',
   'Indicador (nao se preenche): soma das cobrancas marcadas como Paga na competencia do mes corrente.',
   'Mostra quanto do fee recorrente ja entrou no mes, para acompanhar a realizacao da receita de servicos.',
   'Em novembro, 2 cobrancas pagas de R$ 3.200 e R$ 3.500 = R$ 6.700 recebido no mes.',
   'Confundir com o MRR (contratado): o Recebido conta so o que ja foi marcado como Paga, nao o total previsto.',
   10),
  ('pm.cobranca.kpi_aberto', 'Em aberto no mês',
   'Indicador (nao se preenche): soma das cobrancas Lancadas ou Enviadas (ainda nao pagas) na competencia do mes corrente.',
   'Mostra quanto do fee do mes ainda falta receber, para priorizar a cobranca dos clientes em atraso.',
   'Uma cobranca Enviada de R$ 2.500 e uma Lancada de R$ 1.800 = R$ 4.300 em aberto.',
   'Esquecer de marcar a cobranca como Paga quando o cliente paga: o valor fica indevidamente em aberto.',
   11)
) AS v(chave, rotulo, oqp, pqs, ex, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
