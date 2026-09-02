-- Catálogo de planos (plan_catalog / plan_modules) — adiciona a vertical "Revenda de Veículos".
-- Descoberta na auditoria (RD-38): a lista de verticais do wizard de nova empresa
-- (/dashboard/admin/acessos) vem da TABELA plan_catalog (o wizard faz supabase.from('plan_catalog')),
-- NÃO é hardcoded no front e NÃO é ge_tiers_comerciais (que tem só os 4 tiers Light/Pro/etc).
-- Logo, vertical nova = INSERT (aparece sem deploy). Este arquivo versiona esse INSERT (RD-52).
--
-- Preço: EM BRANCO (a definir) — o CEO ainda não precificou. Padrão idêntico a Odonto/Agro/Médica
-- (preco_min/max NULL, ativo=true). Preço em tela é proposta comercial: não se inventa.
-- prioridade_comercial=15: acrescenta no fim da lista (ordenação é escolha comercial; fácil mudar).

INSERT INTO public.plan_catalog
  (id, nome, vertical, descricao, description_v15, ativo, legacy, preco_min, preco_max,
   sla_level, plan_group, max_empresas, max_usuarios, billing_model, is_replacement, prioridade_comercial)
VALUES
  ('v15_revenda', 'Revenda de Veículos', 'commerce',
   'ERP para revenda de veículos novos e usados: ficha do veículo por chassi, custo real amarrado ao carro, pátio com dias parados, proposta e venda com troca, financiamento e consignação. Regime fiscal do usado (PIS/COFINS sobre a diferença).',
   NULL, true, false, NULL, NULL,
   'basic', 'recorrente_leve', 1, 5, 'mensal_fixo', false, 15)
ON CONFLICT (id) DO NOTHING;

-- Módulos: espelha o vizinho commerce (v15_commerce_pro, 44 módulos, que JÁ inclui revenda_patio/
-- veiculo/vendas). Assim o plano nasce funcional (base ERP + revenda), no mesmo padrão dos vizinhos.
-- Idempotente (não há índice único em plan_modules → guarda por NOT EXISTS).
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT 'v15_revenda', src.module_id, src.is_default_active, src.minimum_sla, src.legacy
FROM public.plan_modules src
WHERE src.plan_id = 'v15_commerce_pro'
  AND NOT EXISTS (
    SELECT 1 FROM public.plan_modules d
    WHERE d.plan_id = 'v15_revenda' AND d.module_id = src.module_id
  );
