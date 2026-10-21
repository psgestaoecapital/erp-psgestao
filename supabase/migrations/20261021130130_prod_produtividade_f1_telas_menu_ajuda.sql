-- Produtividade Indústria · Fatia 1 — TELAS: menu + system_screens + ajuda de campo (RD-95)
-- Code: rodrigo-code · Autorizado pelo CEO em sessão (19/10). ADITIVA (RD-97). PR 2 de 3.
-- Registra 3 rotas novas (produtos, tarefas+vídeo, apontamento) no menu e no catálogo de auditoria,
-- e semeia o "?" (erp_ajuda_campo) de cada campo das telas. Depende das RPCs do PR1 (migration banco).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Menu (module_catalog) — reaproveita o subgrupo 'produtividade' já existente (grupo industrial)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, icone, ordem, ativo, is_shared, ramos_aplicaveis, surface_in_groups) VALUES
  ('produtividade_produtos',    'Produtos (árvore)',   '/dashboard/produtividade/produtos',    'industrial', 'produtividade', 'ListTree', 206, true, true, ARRAY['bovinos']::text[], ARRAY[]::text[]),
  ('produtividade_tarefas',     'Tarefas e vídeos',    '/dashboard/produtividade/tarefas',     'industrial', 'produtividade', 'ClipboardList', 207, true, true, ARRAY['bovinos']::text[], ARRAY[]::text[]),
  ('produtividade_apontamento', 'Apontamento horário', '/dashboard/produtividade/apontamento', 'industrial', 'produtividade', 'Clock', 208, true, true, ARRAY['bovinos']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. system_screens (catálogo de auditoria) — lista as RPCs que cada tela chama
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, rpcs_chamadas, auditavel_robo, motivo_nao_auditavel)
VALUES
  ('prod_produtos', '/dashboard/produtividade/produtos', 'industria',
   'Produtos (árvore de desmontagem)', 'Cadastro por planta dos produtos/itens da produção (código, nome, papel, linha, conservação, peso). Incluir/editar/arquivar e carga em lote por "Colar lista".', 'produtividade',
   'pronto', 'media', ARRAY['fn_prod_produto_colar']::text[], false, 'Cadastro por planta; depende de empresa/planta selecionada e de dados do cliente.'),
  ('prod_tarefas', '/dashboard/produtividade/tarefas', 'industria',
   'Tarefas e vídeos', 'Grão de tarefa sob a etapa do fluxo (cap/h "a medir"), com bloco de vídeos preparado (consentimento LGPD + upload, status aguardando análise — sem IA nesta fatia).', 'produtividade',
   'pronto', 'media', ARRAY['fn_prod_tarefa_listar','fn_prod_tarefa_salvar','fn_prod_tarefa_arquivar','fn_prod_video_consentimento_salvar','fn_prod_video_subir','fn_prod_video_acesso_registrar']::text[], false, 'Vídeo = dado pessoal (LGPD); upload por planta do cliente, não auditável pelo robô.'),
  ('prod_apontamento', '/dashboard/produtividade/apontamento', 'industria',
   'Apontamento horário', 'Confronto hora a hora do produzido × capacidade por posto, com produtividade % e ociosidade (semáforo). Lançamento manual (ponto/balança quando ligados).', 'produtividade',
   'pronto', 'media', ARRAY['fn_prod_apontar_hora','fn_prod_produtividade_hora']::text[], false, 'Apontamento por planta do cliente; depende de dados de produção reais.')
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  modulo = EXCLUDED.modulo, estado_real = EXCLUDED.estado_real, prioridade_monitoramento = EXCLUDED.prioridade_monitoramento,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, auditavel_robo = EXCLUDED.auditavel_robo, motivo_nao_auditavel = EXCLUDED.motivo_nao_auditavel,
  atualizado_em = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Ajuda de campo (RD-95) — "?" de cada campo, coluna e filtro das 3 telas
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 Produtos (árvore) — /dashboard/produtividade/produtos
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Produtos', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/produtividade/produtos', 'industria', 'publicado'
FROM (VALUES
  ('prod.produto.planta', 'Planta', 'A planta industrial cujos produtos você quer ver/editar.', 'O cadastro é por planta; trocar a planta mostra os produtos dela.', 'Frigorífico Frioeste', 'Editar produtos achando que é de outra planta.', 5),
  ('prod.produto.codigo', 'Código', 'O código do item como ele aparece no seu sistema atual (ATAK) ou na etiqueta.', 'Liga o produto ao que já existe na sua operação e evita duplicar cadastro.', '64', 'Deixar em branco ou repetir o código de outro item.', 10),
  ('prod.produto.nome', 'Nome do produto', 'O nome do corte/produto como a equipe chama no dia a dia.', 'Identifica o produto nas telas de fluxo, apontamento e relatórios.', 'PICHANHA FATIADA RESF CXP', 'Nome genérico demais que se confunde com outro corte.', 20),
  ('prod.produto.papel', 'Papel', 'O que o item é no fluxo: entrada do animal, carcaça, quarto, para desossa, produto final (com/sem osso), miúdo ou subproduto.', 'Organiza a árvore de desmontagem (do animal ao produto final) e os cálculos.', 'produto_final_sem_osso', 'Classificar um produto final como entrada, ou vice-versa.', 30),
  ('prod.produto.linha', 'Linha', 'Se o item é da linha padrão ou da linha precoce (animais precoces, em paralelo).', 'Separa os indicadores das duas linhas quando a planta tem precoce.', 'padrao', 'Misturar precoce com padrão quando a planta separa as duas.', 40),
  ('prod.produto.conservacao', 'Conservação', 'Como o item é mantido: resfriado ou congelado.', 'Ajuda na organização por câmara e no planejamento.', 'RESFRIADO', 'Marcar resfriado um item que só sai congelado.', 50),
  ('prod.produto.peso_aprox', 'Peso aprox. (kg)', 'O peso médio aproximado de uma unidade/caixa do item, em quilos.', 'Serve de referência para estimativas; pode ser ajustado depois.', '10', 'Informar o peso total do lote em vez do peso de uma unidade.', 60),
  ('prod.produto.colar_lista', 'Colar lista', 'Cole várias linhas (código;nome;papel;linha;seção;peso;conservação) para cadastrar em lote.', 'Carrega centenas de itens de uma vez, com prévia antes de gravar.', '64;PICANHA FATIADA RESF CXP;produto_final_sem_osso;padrao;;10;RESFRIADO', 'Colar sem o cabeçalho certo ou com colunas fora de ordem.', 70),
  ('prod.produto.busca', 'Buscar produto', 'Digite parte do código ou do nome para filtrar a lista.', 'Encontra rápido um item na lista grande.', 'picanha', 'Esperar resultado com o termo escrito errado.', 80),
  ('prod.produto.filtro_papel', 'Filtrar por papel', 'Escolha um papel para ver só os itens daquele tipo.', 'Confere rápido, por exemplo, só os produtos finais.', 'produto_final_sem_osso', 'Esquecer o filtro ligado e achar que faltam itens.', 90)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 3.2 Tarefas e vídeos — /dashboard/produtividade/tarefas
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tarefas e vídeos', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/produtividade/tarefas', 'industria', 'publicado'
FROM (VALUES
  ('prod.tarefa.fluxo', 'Fluxo', 'O fluxo (produto final) cujas tarefas você quer ver/editar.', 'As tarefas pendem das etapas de um fluxo; escolher o fluxo abre as etapas.', 'Desossa de Dianteiro', 'Cadastrar tarefa no fluxo errado.', 10),
  ('prod.tarefa.etapa', 'Etapa', 'A etapa do fluxo onde a tarefa acontece (o posto/atividade).', 'Agrupa as tarefas por etapa para medir cada passo.', 'Serra de peito', 'Pôr a tarefa numa etapa que não é a dela.', 20),
  ('prod.tarefa.nome', 'Nome da tarefa', 'O nome do movimento/tarefa feito no posto.', 'É o grão onde o vídeo e o tempo padrão se penduram.', 'Cortar costela', 'Nome vago que não descreve o movimento.', 30),
  ('prod.tarefa.ordem', 'Ordem', 'A ordem em que a tarefa aparece dentro da etapa.', 'Mantém a lista na sequência real do trabalho.', '1', 'Repetir a mesma ordem em duas tarefas.', 40),
  ('prod.tarefa.cargo', 'Cargo', 'O cargo de quem executa a tarefa (opcional).', 'Liga a tarefa ao custo-hora do cargo.', 'Desossador', 'Escolher um cargo que não existe na planta.', 50),
  ('prod.tarefa.cap_hora', 'Cap./h', 'Quanto a tarefa produz por hora. Deixe em branco se ainda vai medir — nunca ponha zero.', 'A capacidade entra no cálculo de produtividade; em branco = a medir.', '120', 'Pôr 0 no lugar de deixar em branco (0 trava o cálculo).', 60),
  ('prod.tarefa.unidade_cap', 'Unidade da cap.', 'A unidade da capacidade (peças/h, kg/h…).', 'Deixa claro o que o número de cap./h significa.', 'peças/h', 'Informar cap./h sem dizer a unidade.', 70),
  ('prod.tarefa.estado', 'Estado', 'Se a tarefa está em validação ou já validada.', 'Mostra o que ainda precisa de conferência antes de valer no cálculo.', 'em_validacao', 'Marcar válida uma tarefa sem capacidade medida.', 80),
  ('prod.video.consentimento', 'Consentimento', 'Escolha o consentimento do colaborador que aparece no vídeo (obrigatório antes de subir).', 'Sem consentimento registrado o sistema não guarda o vídeo (LGPD).', 'João da Silva — termo v1', 'Subir vídeo sem o consentimento do colaborador.', 90),
  ('prod.video.colaborador', 'Colaborador', 'O nome do colaborador que consente em aparecer no vídeo.', 'Registra quem autorizou, de forma versionada (LGPD).', 'João da Silva', 'Registrar consentimento sem identificar o colaborador.', 100),
  ('prod.video.termo', 'Versão do termo', 'A versão do termo de consentimento assinado.', 'Guarda qual texto o colaborador aceitou.', 'v1', 'Deixar a versão do termo em branco.', 110),
  ('prod.video.arquivo', 'Vídeo da tarefa', 'O vídeo do movimento (celular fixo de lado, corpo inteiro, 1 posto, 60–90 s, mín. 3 ciclos).', 'Fica guardado com segurança aguardando a análise (na próxima fatia).', 'tarefa-costela.mp4', 'Gravar em pé/tremendo ou com mais de um posto no quadro.', 120),
  ('prod.video.protocolo', 'Protocolo ok', 'Marque se o vídeo seguiu o protocolo de gravação exibido na tela.', 'Ajuda a saber se o vídeo serve para a análise depois.', 'sim', 'Marcar ok sem seguir o protocolo.', 130),
  ('prod.video.guardar_ate', 'Guardar até', 'Até quando o vídeo deve ser mantido (prazo de guarda, LGPD).', 'Define o descarte do dado pessoal no prazo.', '2027-10-19', 'Deixar sem prazo e guardar além do necessário.', 140),
  ('prod.video.status', 'Status do vídeo', 'Situação do vídeo: aguardando análise, analisado ou rejeitado.', 'Mostra o que já foi processado (a análise vem na próxima fatia).', 'aguardando_analise', 'Esperar análise automática nesta fatia (ainda não há IA).', 150)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 3.3 Apontamento horário — /dashboard/produtividade/apontamento
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Apontamento horário', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/produtividade/apontamento', 'industria', 'publicado'
FROM (VALUES
  ('prod.apont.planta', 'Planta', 'A planta industrial cujo apontamento você vai lançar/ver.', 'O apontamento é por planta; trocar a planta troca os postos e produtos.', 'Frigorífico Frioeste', 'Lançar produção na planta errada.', 5),
  ('prod.apont.fluxo', 'Fluxo', 'O fluxo cujo apontamento você vai lançar/ver.', 'Separa a produção por fluxo (produto final).', 'Desossa de Dianteiro', 'Lançar no fluxo errado.', 10),
  ('prod.apont.data', 'Data', 'O dia do apontamento.', 'Organiza a produção por dia e permite o confronto hora a hora.', '2026-10-19', 'Lançar numa data trocada.', 20),
  ('prod.apont.posto', 'Posto', 'O posto onde a produção foi feita.', 'Permite comparar o produzido com a capacidade daquele posto.', 'Posto 3', 'Lançar sem posto e perder o confronto de capacidade.', 30),
  ('prod.apont.produto', 'Produto', 'O produto que saiu naquela hora.', 'Diz o que foi produzido no posto/hora.', 'PICANHA FATIADA RESF CXP', 'Apontar um produto que não é daquele posto.', 40),
  ('prod.apont.hora', 'Hora', 'A hora cheia do apontamento (0 a 23).', 'Monta o confronto hora a hora do dia.', '8', 'Pôr hora fora de 0–23 ou somar duas horas numa linha.', 50),
  ('prod.apont.qtd', 'Qtd. produzida', 'Quanto foi produzido naquele posto, naquela hora.', 'É a base do cálculo de produtividade e ociosidade.', '95', 'Lançar o acumulado do dia em vez do da hora.', 60),
  ('prod.apont.unidade', 'Unidade', 'A unidade do que foi produzido (peças, kg…).', 'Deixa claro o que o número representa.', 'peças', 'Trocar a unidade entre horas do mesmo posto.', 70),
  ('prod.apont.pessoas', 'Pessoas presentes', 'Quantas pessoas estavam no posto naquela hora (só a contagem — nunca nomes).', 'Ajuda a entender a produtividade por pessoa, respeitando a LGPD.', '4', 'Tentar registrar nomes — aqui é só a contagem.', 80),
  ('prod.apont.fonte', 'Fonte', 'De onde veio o número: manual, do ponto (ATAK) ou da balança.', 'Mostra a origem do dado e a confiança dele.', 'manual', 'Marcar ponto quando foi digitado à mão.', 90),
  ('prod.apont.produtividade', 'Produtividade %', 'Indicador calculado: produzido ÷ capacidade do posto.', 'Mostra, com semáforo, se o posto rendeu o esperado e a ociosidade.', '79%', 'Comparar postos de capacidades diferentes como se fossem iguais.', 100)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC de escrita do produto com as colunas novas da F1 (a fn_prod_produto_salvar da onda2
--    não persiste linha/secao_origem/peso_aprox_kg/conservacao). Aditiva (função nova).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prod_produto_f1_salvar(
  p_company_id uuid, p_plant_id uuid, p_codigo text, p_nome text,
  p_id uuid DEFAULT NULL, p_papel text DEFAULT 'acabado', p_linha text DEFAULT NULL,
  p_secao_origem text DEFAULT NULL, p_peso_aprox_kg numeric DEFAULT NULL, p_conservacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF btrim(coalesce(p_codigo,'')) = '' THEN RAISE EXCEPTION 'codigo_invalido'; END IF;
  IF btrim(coalesce(p_nome,'')) = '' THEN RAISE EXCEPTION 'nome_invalido'; END IF;
  IF p_id IS NULL THEN
    BEGIN
      INSERT INTO public.prod_produto (company_id, plant_id, codigo, nome, papel, linha, secao_origem, peso_aprox_kg, conservacao, chave_externa)
      VALUES (p_company_id, p_plant_id, btrim(p_codigo), btrim(p_nome), coalesce(p_papel,'acabado'), p_linha, p_secao_origem, p_peso_aprox_kg, p_conservacao, btrim(p_codigo))
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'codigo_ja_existe'; END;
  ELSE
    UPDATE public.prod_produto SET
      codigo = btrim(p_codigo), nome = btrim(p_nome), papel = coalesce(p_papel,'acabado'),
      linha = p_linha, secao_origem = p_secao_origem, peso_aprox_kg = p_peso_aprox_kg, conservacao = p_conservacao,
      chave_externa = btrim(p_codigo), updated_at = now()
    WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_prod_produto_f1_salvar(uuid,uuid,text,text,uuid,text,text,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produto_f1_salvar(uuid,uuid,text,text,uuid,text,text,text,numeric,text) TO authenticated, service_role;
