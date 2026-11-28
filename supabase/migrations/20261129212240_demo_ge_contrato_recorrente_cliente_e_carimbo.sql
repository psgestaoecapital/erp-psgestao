-- PDCA GE · /dashboard/cadastros/contratos-recorrentes · GAP de SEED da DEMO GE (aud8 85/95 obsoleto)
-- Jornada já VERDE no código/RPC (fn_contrato_gerar_receber idempotente, trava anti-dup intacta).
-- Este arquivo só corrige a QUALIDADE DO SEED da empresa DEMO GE (vitrine), para a jornada
-- "cobrança recorrente → a-faturar → Faturar agora → contas a receber" não mostrar "(sem nome)"
-- nem estado "já faturado" sem título correspondente.
--
-- SÓ-DEMO: toda escrita é guardada por companies.is_demo = true E pelo id fixo da DEMO GE
-- (b0700000-0000-4000-a000-000000000004) E pelo id do contrato de demonstração.
-- ADITIVA / IDEMPOTENTE: só atualiza quando o estado ainda está inconsistente; re-rodar não faz nada.
-- NÃO toca estrutura, NÃO toca dado de cliente real, NÃO apaga nada, NÃO cria/mexe em título pago.
--
-- Contrato alvo: 0f8211a8-f1ae-4f58-8be9-4f94a9b0f450 ("Contrato recorrente de demonstração (despesa)",
--                "BPO financeiro", R$800/mês, dia_venc 5, ativo), na DEMO GE.
--
-- GAP 1 (critério e/d — lista mostra "(sem nome)"): o contrato tem cliente_id/cliente_nome NULL.
--        → vincula a um cliente EXISTENTE da própria DEMO GE ("Cliente Demo PF 11",
--          id 04f9db30-94b6-4527-953e-2fa8ae5bd71e). Não há cliente PJ no seed da DEMO; PF atende
--          o requisito ("toda cobrança recorrente deve ter cliente") sem fabricar cadastro novo.
--
-- GAP 2 (critério c — o que é "faturado" tem de aparecer em contas a receber): o contrato marca
--        ultimo_titulo_gerado_em=2026-11-04 e total_titulos_gerados=2, mas tem ZERO linhas em
--        erp_receber (nem ativas nem soft-deletadas). → reconcilia o carimbo para "ainda não
--        faturado" (NULL / 0), deixando a jornada demonstrável: o contrato passa a aparecer em
--        "Contratos a Faturar" e o "Faturar agora" gera o título de verdade pela RPC existente.

-- GAP 1 — vincular cliente (só enquanto estiver sem cliente)
UPDATE public.erp_contratos c
SET cliente_id   = '04f9db30-94b6-4527-953e-2fa8ae5bd71e'::uuid,
    cliente_nome = 'Cliente Demo PF 11'
FROM public.companies co
WHERE c.id         = '0f8211a8-f1ae-4f58-8be9-4f94a9b0f450'::uuid
  AND c.company_id = co.id
  AND co.is_demo   = true
  AND c.company_id = 'b0700000-0000-4000-a000-000000000004'::uuid
  AND c.cliente_id IS NULL;

-- GAP 2 — reconciliar carimbo "já faturado" sem título (só quando não há NENHUM título do contrato)
UPDATE public.erp_contratos c
SET ultimo_titulo_gerado_em = NULL,
    total_titulos_gerados   = 0
FROM public.companies co
WHERE c.id         = '0f8211a8-f1ae-4f58-8be9-4f94a9b0f450'::uuid
  AND c.company_id = co.id
  AND co.is_demo   = true
  AND c.company_id = 'b0700000-0000-4000-a000-000000000004'::uuid
  AND NOT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.contrato_id = c.id)
  AND (c.ultimo_titulo_gerado_em IS NOT NULL OR c.total_titulos_gerados <> 0);
