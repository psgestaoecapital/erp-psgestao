-- Hub HB2 · Calculadora de Obra PS (tela, fatia 2): menu, system_screens e "?" dos campos. Aditiva e idempotente.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, is_shared, subgrupo, surface_in_groups)
SELECT 'projetos_calculadora_obra', 'Calculadora de obra', 'hub', '🧮', '/dashboard/projetos/calculadora', 134, true,
  'Quanto material a parede ou o forro precisa, com a conta aberta item a item.', false, 'projetos_obras', ARRAY['hub']
WHERE NOT EXISTS (SELECT 1 FROM public.module_catalog m WHERE m.id = 'projetos_calculadora_obra');

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT pm.plan_id, 'projetos_calculadora_obra', pm.is_default_active, pm.minimum_sla, pm.legacy
FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_calculadora_obra');

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.projetos.calculadora', '/dashboard/projetos/calculadora', 'hub_construcao', 'Calculadora de obra',
  'Calcula chapas, perfis, parafusos e massa de parede simples e forro F530, com a conta aberta.', NULL, true, now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/projetos/calculadora');

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'projetos', 'publicado'
FROM (VALUES
 ('projetos.calculadora.sistema', 'Sistema', 'Escolha o que vai construir: parede simples (uma chapa por face) ou forro F530.', 'Define quais materiais e coeficientes entram na conta.', 'Parede simples para divisória; forro F530 para teto contínuo.', 'Usar parede simples para teto: o forro tem pendurais e perfil próprio.', 1),
 ('projetos.calculadora.comprimento', 'Comprimento (m)', 'Comprimento total da parede, em metros.', 'Dá a quantidade de guias, montantes e banda, e a área junto com o pé-direito.', '12,5', 'Digitar em centímetros (1250) em vez de metros.', 2),
 ('projetos.calculadora.pe_direito', 'Pé-direito (m)', 'Altura da parede, do piso ao teto, em metros.', 'Escolhe a bitola e o espaçamento dos montantes pela faixa de altura.', '2,8', 'Informar a altura da porta no lugar do pé-direito.', 3),
 ('projetos.calculadora.vaos', 'Vãos a descontar (m²)', 'Soma da área de portas e janelas que não levam chapa.', 'Diminui a área de chapa, parafuso e massa. Guias e montantes seguem o comprimento.', 'Porta 0,8 × 2,1 = 1,68', 'Descontar duas vezes o mesmo vão.', 4),
 ('projetos.calculadora.largura', 'Largura do forro (m)', 'Menor lado do ambiente, em metros.', 'Com o comprimento, dá a área do forro e o perímetro da tabica.', '3', 'Medir pelo forro já com sanca: use o vão real.', 5),
 ('projetos.calculadora.comprimento_forro', 'Comprimento do forro (m)', 'Maior lado do ambiente, em metros.', 'Com a largura, dá a área do forro e o perímetro da tabica.', '4', 'Trocar largura e comprimento não muda a conta, mas digitar só um deles sim.', 6),
 ('projetos.calculadora.ver_conta', 'Ver a conta', 'Nada a preencher: abre a conta de cada item.', 'Mostra a fórmula usada, com perda e embalagem, para você conferir.', 'Chapa: 33,32 m² × 2 faces × perda 1,05 ÷ 2,16 m² = 33 chapas.', 'Achar que a perda está duplicada: ela entra uma vez só, em cada item.', 7)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
