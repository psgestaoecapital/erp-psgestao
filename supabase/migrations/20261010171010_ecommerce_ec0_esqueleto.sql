-- EC0 · esqueleto da vertical E-commerce (CEO 08/10, caixa 26fd9c69; blueprint erp_documento_vertical vertical=ecommerce V1).
--   1) vertical/plano próprios (v15_ecommerce, vertical 'ecommerce') e grupo de menu 'ecommerce' aceito no CHECK;
--   2) módulos do menu: a página inicial (viva) + as telas futuras como "em construção" (rota do placeholder único);
--   3) área "E-commerce" em area_menu_config (o seletor casa por vertical do plano; super admin PS vê tudo);
--   4) empresa de demonstração "Loja Modelo - DEMO" (b0700000-…-0007, is_demo, GE Pro + E-commerce a R$ 0, sem dados)
--      com acesso copiado da demo GE, e demo_por_area 'ecommerce' apontando para ela;
--   5) textos do "?" (RD-95) dos indicadores da página inicial.
-- Aditiva e idempotente: nada é apagado; empresa real nenhuma muda; Comércio/GE intacto.

ALTER TABLE public.module_catalog DROP CONSTRAINT module_catalog_grupo_check;
ALTER TABLE public.module_catalog ADD CONSTRAINT module_catalog_grupo_check CHECK (grupo = ANY (ARRAY[
  'erp_core','erp_ext','industrial','assessor','contador','wealth','admin','dev','hub','oficina',
  'compliance','pm','services','commerce','fiscal','agro','bpo','custeio_a','custeio_b',
  'gestao_empresarial','odonto','medica','revenda_veiculos','ecommerce']::text[]));

INSERT INTO public.plan_catalog (id, nome, max_usuarios, max_empresas, descricao, ativo, plan_group, billing_model, vertical, sla_level, legacy)
VALUES ('v15_ecommerce', 'E-commerce', 5, 1,
        'Operação multicanal (catálogo, canais, pedidos, expedição, pós-venda) sobre o financeiro, o fiscal e o estoque da Gestão Empresarial: lucro real de cada pedido, SKU e canal.',
        true, 'recorrente_leve', 'mensal_fixo', 'ecommerce', 'basic', false)
ON CONFLICT (id) DO NOTHING;

-- subgrupo pai (FK de module_catalog.subgrupo): sem ele o db push quebrava em banco que ainda não o tinha
INSERT INTO public.module_subgrupos (id, grupo, label, ordem, ativo)
VALUES ('ecommerce', 'ecommerce', 'E-commerce', 300, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, is_shared, legacy, subgrupo, prioridade, rbac_isento, rbac_isento_motivo)
VALUES
 ('ecommerce_inicio',   'E-commerce · O que fazer hoje', 'ecommerce', 'ShoppingCart', '/dashboard/ecommerce',                          300, true, 'Cockpit da vertical: pedidos a separar, anúncios com problema, perguntas, repasses e ruptura.', false, false, 'ecommerce', 'alta',  true, 'EC0: página informativa sem dado nem ação; as telas com dado (EC1+) entram com RBAC próprio'),
 ('ecommerce_catalogo', 'Catálogo único',                'ecommerce', 'Package',      '/dashboard/em-construcao/ecommerce_catalogo',   301, true, 'EC1 · produto da GE com variações, kits, atributos e qualidade do cadastro por canal.',        false, false, 'ecommerce', 'alta',  true, 'EC0: placeholder "em construção"'),
 ('ecommerce_canais',   'Canais de venda',               'ecommerce', 'Share2',       '/dashboard/em-construcao/ecommerce_canais',     302, true, 'EC2 · conectar a conta do canal (Mercado Livre primeiro) e ver o que sincroniza.',            false, false, 'ecommerce', 'alta',  true, 'EC0: placeholder "em construção"'),
 ('ecommerce_pedidos',  'Pedidos e expedição',           'ecommerce', 'Truck',        '/dashboard/em-construcao/ecommerce_pedidos',    303, true, 'EC3 · central de pedidos, NF-e automática [→GE], separação por QR e etiquetas em lote.',      false, false, 'ecommerce', 'alta',  true, 'EC0: placeholder "em construção"'),
 ('ecommerce_lucro',    'Lucro real e repasses',         'ecommerce', 'TrendingUp',   '/dashboard/em-construcao/ecommerce_lucro',      304, true, 'EC4 · conciliação de repasses [→GE], lucro por pedido, SKU e canal, DRE por canal.',          false, false, 'ecommerce', 'alta',  true, 'EC0: placeholder "em construção"'),
 ('ecommerce_anuncios', 'Anúncios e preço por margem',   'ecommerce', 'Tags',         '/dashboard/em-construcao/ecommerce_anuncios',   305, true, 'EC6 · edição em massa, preço mínimo por canal pela margem, alerta de anúncio com prejuízo.',  false, false, 'ecommerce', 'media', true, 'EC0: placeholder "em construção"'),
 ('ecommerce_posvenda', 'Pós-venda',                     'ecommerce', 'MessagesSquare','/dashboard/em-construcao/ecommerce_posvenda',  306, true, 'EC7 · caixa única de perguntas, mensagens e devoluções com IA, reputação.',                    false, false, 'ecommerce', 'media', true, 'EC0: placeholder "em construção"')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.area_menu_config
  (id, area_slug, ordem, nome_menu, icone, rota_raiz, status_comercial, visivel_sempre,
   plano_principal_id, descricao_curta, pct_evolucao_atual, ativo)
VALUES
  ('ecommerce','ecommerce',45,'E-commerce','ShoppingCart','/dashboard/ecommerce',
   'em_construcao', false, 'v15_ecommerce','Canais · pedidos · lucro real por venda', 5, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES ('b0700000-0000-4000-a000-000000000007', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Loja Modelo Demonstração LTDA', 'Loja Modelo - DEMO',
        true, 'auditoria', '55500000000304', false, 'SC')
ON CONFLICT (id) DO UPDATE SET
  razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false, cnpj = EXCLUDED.cnpj;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
SELECT 'b0700000-0000-4000-a000-000000000007', p.plan_id, 'active', 0, 'monthly', p.tier,
       'Demonstração · CEO 08/10 (Loja Modelo, E-commerce + Gestão Empresarial)'
FROM (VALUES ('v15_ecommerce', NULL::text), ('v15_gestao_empresarial_pro', 'pro')) AS p(plan_id, tier)
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions ts
                  WHERE ts.company_id = 'b0700000-0000-4000-a000-000000000007' AND ts.plan_id = p.plan_id);

INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT uc.user_id, 'b0700000-0000-4000-a000-000000000007', uc.role, uc.origem
FROM public.user_companies uc
WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x
                  WHERE x.user_id = uc.user_id AND x.company_id = 'b0700000-0000-4000-a000-000000000007');

INSERT INTO public.demo_por_area (area, company_id) VALUES ('ecommerce', 'b0700000-0000-4000-a000-000000000007')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;

-- "?" (RD-95) dos 5 indicadores da página inicial
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
 ('ecommerce.inicio.pedidos_separar', '/dashboard/ecommerce', 'O que fazer hoje', 'Pedidos a separar',
  'Nada a preencher: o número aparece sozinho quando um canal estiver conectado.',
  'Conta os pedidos pagos que já entraram e ainda não foram separados e conferidos. É a primeira fila do dia na expedição.',
  'Entraram 18 pedidos até as 9h e 6 já foram conferidos: aparece 12.',
  'Achar que o zero significa "sem vendas". Enquanto nenhum canal estiver conectado, o zero só indica que ainda não há dado.', 'ecommerce', 10),
 ('ecommerce.inicio.anuncios_problema', '/dashboard/ecommerce', 'O que fazer hoje', 'Anúncios com problema',
  'Nada a preencher: o sistema aponta os anúncios pausados, sem estoque ou que dão prejuízo.',
  'Mostra onde você está perdendo venda ou dinheiro: anúncio pausado por falta de estoque, sem atributo obrigatório ou com preço abaixo do mínimo pela margem.',
  '3 anúncios do Mercado Livre estão pausados porque o estoque zerou.',
  'Corrigir o preço no canal e esquecer o custo do produto: o alerta usa o custo e as taxas cadastrados.', 'ecommerce', 20),
 ('ecommerce.inicio.perguntas', '/dashboard/ecommerce', 'O que fazer hoje', 'Perguntas sem resposta',
  'Nada a preencher: reúne as perguntas e mensagens dos compradores de todos os canais.',
  'Responder rápido melhora a reputação e a conversão. Aqui você vê quantas perguntas esperam resposta, de todos os canais numa caixa só.',
  '5 perguntas, a mais antiga há 2 horas.',
  'Deixar para o fim do dia: canais penalizam resposta lenta.', 'ecommerce', 30),
 ('ecommerce.inicio.repasses', '/dashboard/ecommerce', 'O que fazer hoje', 'Repasses a conciliar',
  'Nada a preencher: os repasses dos canais chegam pela conexão e são conferidos pedido a pedido.',
  'Compara o que o canal depositou com o que você deveria receber (descontando taxa, comissão, frete e estorno). A diferença é dinheiro que pode estar sendo perdido.',
  'Repasse de R$ 4.210,00 com 2 pedidos divergentes.',
  'Conciliar só pelo valor total do depósito: a divergência costuma estar em um pedido.', 'ecommerce', 40),
 ('ecommerce.inicio.ruptura', '/dashboard/ecommerce', 'O que fazer hoje', 'Ruptura prevista',
  'Nada a preencher: calculada pelo giro de vendas e pelo prazo do fornecedor.',
  'Avisa quais produtos vão acabar antes de a próxima compra chegar, para você comprar a tempo e não perder o anúncio.',
  'O produto SKU-123 vende 4 por dia, tem 20 em estoque e o fornecedor leva 7 dias: ruptura em 5 dias.',
  'Cadastrar o prazo do fornecedor errado: a previsão sai errada.', 'ecommerce', 50)
ON CONFLICT (chave) DO NOTHING;
