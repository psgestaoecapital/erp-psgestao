-- Hub · ONDA S-MED · tela 335 "Minhas aprovações (app)" — rota /dashboard/projetos/aprovacoes.
-- O BACKEND JÁ EXISTE (RD-26): fn_obra_medicao_etapa_minhas_pendentes (#5808) e
-- fn_obra_medicao_etapa_listar/_iniciar/_decidir (#5806/#5861), todos guardados por empresa.
-- A PR entrega só a TELA (consome o backend) e registra a rota no menu (RD-98), em system_screens
-- (origem do dado) e o "?" de ajuda dos indicadores/filtro (RD-95). Code: desenvolvedor_4_g
--
-- Aditiva e idempotente. Não cria/altera tabela, RLS, policy, grant nem dado de cliente. Não mexe em
-- financeiro/fiscal (o título a pagar continua nascendo só na etapa de integração financeira, fora daqui).
-- RD-52: arquivo + PR, acima da main, faixa desenvolvedor_4_g (segundos :45).

-- 1) MENU (RD-98): item próprio do Hub, ao lado do Cockpit/Resultado por obra (subgrupo projetos_obras).
INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao, surface_in_groups, ramos_aplicaveis)
VALUES
  ('projetos_aprovacoes', 'Minhas aprovações', 'hub', 'projetos_obras', '2_svc', NULL,
   '/dashboard/projetos/aprovacoes', 136, true, false,
   'Caixa de aprovações: as medições que estão com você, para aprovar ou devolver sem abrir a obra.',
   ARRAY['hub']::text[], ARRAY['hub_construtora','hub_prestadora','hub_escritorio']::text[])
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo, layer = EXCLUDED.layer,
  rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true, is_shared = EXCLUDED.is_shared,
  descricao = EXCLUDED.descricao, surface_in_groups = EXCLUDED.surface_in_groups,
  ramos_aplicaveis = EXCLUDED.ramos_aplicaveis;

-- Mesmos planos do módulo irmão "Obras" do Hub (nenhum plano novo; só espelha onde Obras já aparece).
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_aprovacoes' FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_aprovacoes');

-- 2) system_screens (RD-98 pilar 3 — origem do dado). Lida no código + pg_get_functiondef:
--    page.tsx chama fn_obra_medicao_etapa_minhas_pendentes; o componente MedicaoEtapas chama
--    fn_obra_medicao_etapa_listar/_iniciar/_decidir; o "?" usa fn_ajuda_campo_listar.
INSERT INTO public.system_screens (id, rota, area, titulo, estado_real, auditada_ok, rpcs_chamadas, views_consumidas)
VALUES (
  gen_random_uuid(),
  '/dashboard/projetos/aprovacoes',
  'hub',
  'Hub · Minhas aprovações',
  'pronto',
  false,
  ARRAY['fn_obra_medicao_etapa_minhas_pendentes','fn_obra_medicao_etapa_listar','fn_obra_medicao_etapa_iniciar','fn_obra_medicao_etapa_decidir','fn_ajuda_campo_listar'],
  ARRAY['projetos_obra_medicao_etapa','projetos_obra_medicao','projetos_obras']
)
ON CONFLICT (rota) DO UPDATE SET
  area = EXCLUDED.area, titulo = EXCLUDED.titulo,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, views_consumidas = EXCLUDED.views_consumidas;

-- 3) RD-95: "?" dos indicadores e do filtro da tela (a ação "aprovar/devolver" herda o "?" do MedicaoEtapas).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('projetos.aprovacoes.tela', '/dashboard/projetos/aprovacoes', 'Minhas aprovações · Visão geral',
   'Minhas aprovações',
   'Não preenche nada: é a sua caixa de aprovações. Lista as medições que pararam numa etapa sob a sua responsabilidade, de qualquer obra.',
   'Decidir rápido, do celular, sem precisar entrar em cada obra: você vê o que está com você e aprova ou devolve na hora.',
   'Chega uma medição na etapa Engenharia que é sua: ela aparece aqui para você aprovar ou devolver com um motivo.',
   'Procurar aqui medições que já passaram por você: some da lista assim que você decide; o histórico fica na própria medição.',
   'hub', 10, 'publicado'),
  ('projetos.aprovacoes.pendentes', '/dashboard/projetos/aprovacoes', 'Minhas aprovações · Indicador',
   'Aguardando você',
   'Indicador calculado: quantas etapas de medição estão neste momento esperando a sua decisão.',
   'Dar de relance o tamanho da sua fila de aprovação, para você saber se tem algo represado.',
   'O número 3 quer dizer que há três medições paradas esperando você aprovar ou devolver.',
   'Confundir com o total de medições da obra: aqui conta só o que está com VOCÊ, não o que está com outras pessoas.',
   'hub', 20, 'publicado'),
  ('projetos.aprovacoes.filtro', '/dashboard/projetos/aprovacoes', 'Minhas aprovações · Filtro',
   'Buscar',
   'Digite parte do nome da obra, o número da medição ou o nome da etapa para encontrar uma medição na sua fila.',
   'Achar rápido uma medição específica quando você tem várias aguardando.',
   'Digitar "Engenharia" para ver só as medições que estão na sua etapa de engenharia.',
   'Esperar que a busca traga medições de outras pessoas: ela filtra apenas a sua própria fila.',
   'hub', 30, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
