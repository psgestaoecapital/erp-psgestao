-- Estância Umuarama (636af107-…) — psgc_depara + recálculo do DRE (Parte 9).
-- O de-para (#1735) reclassificou erp_pagar/erp_receber.categoria para o plano próprio, mas o
-- psgc_depara (que o fn_psgc_recalcular_dre_mes usa: origem_codigo=categoria → psgc_codigo) estava
-- chaveado nas categorias ANTIGAS, deixando o DRE errado (soja em 9.1 não-op; distribuição na despesa).
-- Este PR: reconstrói o psgc_depara para os novos códigos, separa o 4.07 em subcontas (imposto de
-- venda × despesa × multa) e recalcula os 22 meses (08/2025–05/2027).
--
-- psgc_depara é POR EMPRESA (0 linhas globais; recalc lê WHERE company_id=…): não afeta as outras 17.
-- Provado em rollback (impersonação não precisa): por grupo/regime (competência) —
--   CMV 321.663 · DESP 1.069.530 (c/ ICMS 518 movido p/ dedução) · IMPOSTOS_VENDA 518 ·
--   NAO_OPER 695.529 (investimento 612.594 + 1.04 82.935) · DESTINACAO 1.000.000 · ROB = dado vivo,
--   com soja (1.02→1.1) dentro do operacional; distribuição (6.01→0.3) e investimento (5.x→9.3) fora.
-- RD-52 (arquivo=ledger). Não cria função nova (sem gate fn-guards).

-- A) Subcontas do 4.07 (o de-para colapsou ICMS/IPTU/taxas/certificado/multa num só código).
INSERT INTO public.erp_plano_contas (company_id,codigo,descricao,grupo,tipo,pai_codigo,nivel,is_totalizador,ativo) VALUES
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.07.01','Imposto sobre venda (ICMS)','despesa','despesa','4.07',3,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.07.02','IPTU, taxas e certificados','despesa','despesa','4.07',3,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.07.03','Multas','despesa','despesa','4.07',3,false,true);

-- B) Recategoriza os lançamentos vivos em 4.07 pela categoria ORIGINAL do espelho (bkp #1735).
UPDATE public.erp_pagar SET categoria='4.07.01'
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND categoria='4.07'
   AND id IN (SELECT id FROM public.bkp_umuarama_categoria_20260923 WHERE origem='pagar' AND categoria='7 - ICMS');
UPDATE public.erp_pagar SET categoria='4.07.02'
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND categoria='4.07'
   AND id IN (SELECT id FROM public.bkp_umuarama_categoria_20260923 WHERE origem='pagar'
              AND categoria IN ('7 - IPTU','3 - Taxas Certificação','7 - Certificado Digital'));
UPDATE public.erp_pagar SET categoria='4.07.03'
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND categoria='4.07'
   AND id IN (SELECT id FROM public.bkp_umuarama_categoria_20260923 WHERE origem='pagar' AND categoria='3 - Multa');

-- C) psgc_depara: inativa TODAS as entradas antigas da Umuarama e faz upsert do mapa novo.
UPDATE public.psgc_depara SET ativo=false WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38';

INSERT INTO public.psgc_depara (company_id,origem_codigo,origem_sistema,psgc_codigo,metodo,confianca,revisado,ativo) VALUES
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1.01','erp','1.1','manual',100,true,true),   -- Venda de gado → ROB
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1.02','erp','1.1','manual',100,true,true),   -- Venda de soja → ROB (era 9.1, errado)
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1.03','erp','1.4','manual',100,true,true),   -- Arrendamento → ROB
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1.04','erp','9.2','manual',100,true,true),   -- Outras receitas → não operacional
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.01','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.02','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.03','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.04','erp','4.3','manual',100,true,true),   -- mão de obra direta
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.05','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.06','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.07','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.08','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.09','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.10','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.11','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.12','erp','4.1','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.13','erp','4.4','manual',100,true,true),   -- terceirização produtiva
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.01','erp','6.1','manual',100,true,true),   -- pessoal
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.02','erp','6.5','manual',100,true,true),   -- serviços administrativos
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.02.04','erp','6.5','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.02.05','erp','6.5','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.03','erp','6.4','manual',100,true,true),   -- utilidades
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.04','erp','6.8','manual',100,true,true),   -- veículos
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.05','erp','6.11','manual',100,true,true),  -- outras despesas fixas
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.06','erp','5.1','manual',100,true,true),   -- comissão → despesa variável
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.07','erp','6.9','manual',100,true,true),   -- (pai; sem lançamento após split)
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.07.01','erp','3.1','manual',100,true,true),-- ICMS → dedução da receita
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.07.02','erp','6.9','manual',100,true,true),-- IPTU/taxas/certificado → despesa fixa
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.07.03','erp','6.11','manual',100,true,true),-- multas
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','5.01','erp','9.3','manual',100,true,true),   -- investimento (CAPEX) → fora do resultado
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','5.02','erp','9.3','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','5.03','erp','9.3','manual',100,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','6.01','erp','0.3','manual',100,true,true)    -- distribuição de lucros → destinação (fora do resultado)
ON CONFLICT (company_id,origem_codigo,origem_sistema) DO UPDATE
  SET psgc_codigo=EXCLUDED.psgc_codigo, ativo=true, revisado=true, confianca=100, metodo='manual', updated_at=now();

-- D) Recalcula o DRE materializado (psgc_dre) dos 22 meses com movimento.
DO $recalc$
DECLARE v_d date;
BEGIN
  FOR v_d IN SELECT generate_series('2025-08-01'::date,'2027-05-01'::date,'1 month'::interval)::date LOOP
    PERFORM public.fn_psgc_recalcular_dre_mes('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38',
              extract(year from v_d)::int, extract(month from v_d)::int);
  END LOOP;
END $recalc$;
