-- Seed DEMO002 (Agência P&M): plano de contas de despesa + classificação das
-- despesas indiretas NÃO PAGAS, para a jornada "Rentabilidade por cliente"
-- (/dashboard/pm/rentabilidade, RPC fn_pm_indiretas_rateio) ficar demonstrável.
--
-- CONTEXTO (PDCA GE, RD-38): a DEMO002 tinha plano de contas VAZIO (0 contas) e
-- 11 contas a pagar com `categoria` em rótulo livre (Locação/Mídia/Comissões/…)
-- + `data_competencia` NULL. A RPC só soma como "indireta" o que casa
-- erp_pagar.categoria = erp_plano_contas.codigo (tipo='despesa', sem contrato,
-- competência no período). Sem plano, nada classifica → rateio nunca aparece.
--
-- O QUE ESTE SEED FAZ (ADITIVO, IDEMPOTENTE, SÓ DEMO):
--  1) cria uma árvore mínima de despesas indiretas no plano de DEMO002;
--  2) classifica SOMENTE as despesas NÃO PAGAS (status aberto/vencido), setando
--     categoria=código do plano e data_competencia=1º dia do mês do vencimento.
--     Os 5 títulos PAGOS ficam INTOCADOS (regra: nunca alterar título pago) e
--     seguem corretamente no balde "a classificar".
--
-- DURABILIDADE: fn_demo_reset não toca erp_pagar nem erp_plano_contas → durável.
-- SEGURANÇA: guarda is_demo em tudo; nunca toca empresa real nem título pago.
--
-- Code: code-desenvolvedor-3

-- 1) Plano de contas de despesa (idempotente por company_id+codigo)
INSERT INTO public.erp_plano_contas
  (id, company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo, is_totalizador, sugerida_global)
SELECT v.id, 'b0700000-0000-4000-a000-000000000002'::uuid,
       v.codigo, v.descricao, 'DESPESAS', 'despesa', v.pai, v.nivel, true, v.totalizador, false
FROM (VALUES
  ('a2b00002-0000-4000-a000-000000000040'::uuid, '4',       'Despesas',            NULL::text, 1, true),
  ('a2b00002-0000-4000-a000-000000000041'::uuid, '4.01',    'Despesas Indiretas',  '4',        2, true),
  ('a2b00002-0000-4000-a000-000000000042'::uuid, '4.01.01', 'Locação',             '4.01',     3, false),
  ('a2b00002-0000-4000-a000-000000000043'::uuid, '4.01.02', 'Mídia e Publicidade', '4.01',     3, false),
  ('a2b00002-0000-4000-a000-000000000044'::uuid, '4.01.03', 'Serviços de Terceiros','4.01',    3, false),
  ('a2b00002-0000-4000-a000-000000000045'::uuid, '4.01.04', 'Comissões',           '4.01',     3, false)
) AS v(id, codigo, descricao, pai, nivel, totalizador)
WHERE EXISTS (SELECT 1 FROM public.companies c
              WHERE c.id='b0700000-0000-4000-a000-000000000002'::uuid AND c.is_demo)
  AND NOT EXISTS (SELECT 1 FROM public.erp_plano_contas pc
                  WHERE pc.company_id='b0700000-0000-4000-a000-000000000002'::uuid AND pc.codigo=v.codigo);

-- 2) Classifica as despesas NÃO PAGAS (aberto/vencido), sem contrato, cujo
--    categoria ainda é o rótulo livre. Idempotente: após virar código, o
--    WHERE pelo rótulo não casa de novo. Nunca toca título pago.
UPDATE public.erp_pagar pg
   SET categoria = m.codigo,
       data_competencia = COALESCE(pg.data_competencia, date_trunc('month', pg.data_vencimento)::date)
  FROM (VALUES
    ('Locação',    '4.01.01'),
    ('Mídia',      '4.01.02'),
    ('Equipe',     '4.01.03'),
    ('Comissões',  '4.01.04')
  ) AS m(rotulo, codigo)
 WHERE pg.company_id = 'b0700000-0000-4000-a000-000000000002'::uuid
   AND pg.contrato_id IS NULL
   AND pg.deleted_at IS NULL
   AND pg.status IN ('aberto','vencido')          -- NUNCA título pago
   AND pg.categoria = m.rotulo
   AND EXISTS (SELECT 1 FROM public.companies c
               WHERE c.id='b0700000-0000-4000-a000-000000000002'::uuid AND c.is_demo);
