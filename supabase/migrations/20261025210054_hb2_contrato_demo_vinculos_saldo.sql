-- HB2 · Contrato de preços: semente DEMO (Construtora Modelo) de vínculos com o catálogo + quantidade contratada · desenvolvedor_6_g (faixa 54).
-- Só INSERT em tabelas de contrato da empresa DEMO, idempotente (ON CONFLICT DO NOTHING); nenhuma estrutura nova.
-- Vínculo: serviço do contrato -> serviço do catálogo da própria DEMO (mesmo código). Saldo: quantidade contratada por serviço.
INSERT INTO public.erp_tabela_preco_vinculo (company_id, tabela_id, servico_ref, catalogo_servico_id)
SELECT i.company_id, i.tabela_id, i.servico_ref, s.id
  FROM (SELECT DISTINCT company_id, tabela_id, servico_ref FROM public.erp_tabela_preco_item
         WHERE tabela_id IN ('b0700000-0000-4000-a000-0000000e0001','b0700000-0000-4000-a000-0000000e0002')
           AND company_id = 'b0700000-0000-4000-a000-000000000006') i
  JOIN public.projetos_servicos s ON s.company_id = i.company_id AND s.codigo = i.servico_ref AND s.ativo
ON CONFLICT (tabela_id, servico_ref) DO NOTHING;

INSERT INTO public.erp_tabela_preco_saldo (company_id, tabela_id, servico_ref, quantidade_contratada)
SELECT 'b0700000-0000-4000-a000-000000000006'::uuid, v.t::uuid, v.r, v.q
  FROM (VALUES
    ('b0700000-0000-4000-a000-0000000e0001','DEMO-S01', 1800::numeric),
    ('b0700000-0000-4000-a000-0000000e0001','DEMO-S02', 2400),
    ('b0700000-0000-4000-a000-0000000e0002','DEMO-FC-S01', 5000),
    ('b0700000-0000-4000-a000-0000000e0002','DEMO-FC-S02', 3200),
    ('b0700000-0000-4000-a000-0000000e0002','DEMO-FC-S03', 4200),
    ('b0700000-0000-4000-a000-0000000e0002','DEMO-FC-S04', 1500),
    ('b0700000-0000-4000-a000-0000000e0002','DEMO-FC-S05', 900)
  ) v(t, r, q)
 WHERE EXISTS (SELECT 1 FROM public.erp_tabela_preco_item i WHERE i.tabela_id = v.t::uuid AND i.servico_ref = v.r)
ON CONFLICT (tabela_id, servico_ref) DO NOTHING;
