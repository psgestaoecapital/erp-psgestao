-- Hub · HB2 · Calculadora de Obra (fatia 2): tela, menu e "?" dos campos. Aditiva (objetos novos; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('hub.calculadora.sistema', 'Sistema', 'Escolha o que vai construir: parede simples ou forro F530.', 'Define quais materiais e coeficientes entram na conta.', 'Parede simples: chapa de gesso nas duas faces.', 'Usar parede para um forro: os materiais são outros.', 1),
 ('hub.calculadora.comprimento', 'Comprimento (m)', 'Comprimento total da parede ou do forro, em metros, sem descontar portas.', 'Base da quantidade de guias, montantes, banda e área.', '12,5', 'Digitar em centímetros: use metros (12,5 e não 1250).', 2),
 ('hub.calculadora.pe_direito', 'Pé-direito (m)', 'Altura da parede, do piso ao teto, em metros.', 'A altura define a bitola do perfil e o espaçamento dos montantes.', '2,8', 'Medir só o vão da porta: aqui vale a altura da parede inteira.', 3),
 ('hub.calculadora.vaos', 'Vãos a descontar (m²)', 'Soma da área de portas e janelas, em m². Deixe vazio se não houver.', 'Reduz a área de chapa, parafuso, massa e fita.', 'Porta 0,8 × 2,1 m = 1,68', 'Descontar vão em forro: não se aplica.', 4),
 ('hub.calculadora.largura', 'Largura (m)', 'Menor lado do ambiente a forrar, em metros.', 'Com o comprimento, dá a área do forro e o perímetro da tabica.', '3', 'Trocar largura por área: informe os dois lados.', 5),
 ('hub.calculadora.resultado', 'Lista de materiais', 'Nada a preencher. Toque em "ver a conta" para conferir cada quantidade.', 'Mostra a quantidade real para comprar, já arredondada para cima por embalagem e com perda.', 'Chapa: 33 un.', 'Comprar a quantidade bruta: a coluna Comprar já vem arredondada.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES ('projetos_calculadora', 'Calculadora de Obra', 'hub', 'projetos_engenharia', '🧮', '/dashboard/projetos/calculadora', 124, true,
        'Calcula os materiais de parede de drywall e forro F530 a partir das medidas, com a conta aberta item a item.', '2_svc', NULL, false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_calculadora' FROM public.plan_modules pm
 WHERE pm.module_id = 'projetos_engenharia'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_calculadora');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos)
SELECT 'F.projetos_calculadora.materiais_drywall', 'projetos_calculadora', 'operacional', 'Calculadora de materiais de drywall',
       'Parede simples e forro F530: lista de materiais por medida, com perda, embalagem e a conta aberta.', 'pronto', 60, 'alta',
       COALESCE((SELECT array_agg(DISTINCT plan_id::text) FROM public.plan_modules WHERE module_id = 'projetos_calculadora'), ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.projetos.calculadora', '/dashboard/projetos/calculadora', 'hub', 'Hub · Calculadora de Obra',
       'Calcula materiais de parede de drywall e forro F530 por medida, com a conta aberta.', NULL, true, now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/projetos/calculadora');
INSERT INTO public.screen_route_features (screen_id, feature_id)
SELECT s.id, 'F.projetos_calculadora.materiais_drywall' FROM public.system_screens s WHERE s.rota = '/dashboard/projetos/calculadora'
ON CONFLICT (screen_id, feature_id) DO NOTHING;
UPDATE public.system_screens SET estado_real = 'pronto', atualizado_em = now()
 WHERE rota = '/dashboard/projetos/calculadora' AND estado_real IS NULL;
