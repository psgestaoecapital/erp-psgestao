-- Hub > Financeiro > Permutas — FATIA 1b: menu + system_screens + ajuda (RD-95) da tela (CEO 12/11, ctx 74dfdb57).
-- A tela (src/app/dashboard/hub/permutas/page.tsx) consome as RPCs da FATIA 1a (#4832). Aditivo e idempotente.

-- Menu: Hub (grupo='hub') > FINANCEIRO (subgrupo='financeiro'). Primeiro módulo financeiro do Hub.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific,
  is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, prioridade, ramos_aplicaveis,
  rbac_isento, rbac_isento_motivo, so_ps, so_demo)
VALUES ('hub_permutas', 'Permutas', 'hub', 'ArrowLeftRight', '/dashboard/hub/permutas', 60, true,
  'Gestão de permutas da obra: cada permuta é uma conta-corrente de imóvel — valor do contrato + reajuste CUB = valor atualizado, quitado por material, serviço, dinheiro ou imóvel, e o saldo em aberto. Multi-CNPJ e consolidado do grupo.',
  null, null, true, '[]'::jsonb, false, 'financeiro', '[]'::jsonb, false, null, null, false, null, false, false)
ON CONFLICT (id) DO NOTHING;

-- Liga a todo plano que já tem um módulo do Hub (reusa as associações do hub_orcamento_itens).
INSERT INTO public.plan_modules (id, plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT gen_random_uuid(), pm.plan_id, 'hub_permutas', pm.is_default_active, pm.minimum_sla, pm.legacy
FROM public.plan_modules pm
WHERE pm.module_id = 'hub_orcamento_itens'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'hub_permutas');

-- Origem do dado (RD-98 p3): a tela aparece em system_screens, com RPCs/tabelas consumidas.
INSERT INTO public.system_screens (rota, area, titulo, descricao_funcional, componentes_principais, views_consumidas, rpcs_chamadas, estado_real, modulo)
VALUES ('/dashboard/hub/permutas', 'hub', 'Permutas',
  'Gestão de permutas (conta-corrente de imóvel): cartões do grupo, lista por permuta com progresso e status, extrato (contrato + reajuste CUB = atualizado; movimentos por mês; saldo), cadastro e movimento manual, consolidado multi-CNPJ.',
  '["ChipsEmpresa","CartoesKPI","ListaPermutas","ExtratoModal","CadastroModal","MovimentoModal"]'::jsonb,
  '["hub_permuta","hub_permuta_movimento","hub_permuta_reajuste","projetos_obras","companies"]'::jsonb,
  '["fn_permuta_listar","fn_permuta_salvar","fn_permuta_movimento_add","fn_permuta_reajuste_add","fn_permuta_excluir","fn_permuta_extrato","fn_permuta_consolidado_grupo"]'::jsonb,
  'ativo', 'hub_permutas')
ON CONFLICT (rota) DO UPDATE SET views_consumidas = EXCLUDED.views_consumidas, rpcs_chamadas = EXCLUDED.rpcs_chamadas, atualizado_em = now();

-- Ajuda de campo (RD-95): "?" em cada campo, filtro, indicador e ação da tela.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('hub.permutas.como','/dashboard/hub/permutas','Permutas','Como funciona','Nada a preencher.','Cada permuta é uma conta-corrente de imóvel: a empresa recebe um imóvel (valor do contrato) e quita por material, serviço, dinheiro ou imóvel. Valor atualizado = contrato + reajuste CUB; saldo = atualizado − quitado.','Recebeu um apto de R$ 100 mil, já entregou R$ 60 mil em gesso e serviço → saldo R$ 40 mil.','Achar que material/serviço entregue é despesa: aqui ele QUITA a permuta.','hub',1,'publicado'),
  ('hub.permutas.empresa','/dashboard/hub/permutas','Permutas','Empresa','Escolha uma empresa do grupo, Todas, ou Consolidado.','Filtra as permutas por CNPJ. Consolidado soma os CNPJs do grupo e elimina a permuta intragrupo.','Ver só a Tryo Gesso, ou o Consolidado dos 4 CNPJs.','Comparar o Consolidado com a soma crua: o intragrupo é eliminado.','hub',2,'publicado'),
  ('hub.permutas.a_receber','/dashboard/hub/permutas','Permutas','Permuta a receber','Nada a preencher.','Soma do valor atualizado (contrato + reajuste CUB) de todas as permutas em aberto.','3 permutas somando R$ 420 mil atualizados.','Confundir com saldo: isto é o total do contrato, não o que falta.','hub',3,'publicado'),
  ('hub.permutas.produzido','/dashboard/hub/permutas','Permutas','Produzido / Quitado','Nada a preencher.','Soma do que já foi entregue para quitar as permutas (material + serviço + dinheiro + imóvel).','R$ 260 mil já produzidos/entregues.','Contar o mesmo material duas vezes: cada movimento entra uma vez.','hub',4,'publicado'),
  ('hub.permutas.saldo','/dashboard/hub/permutas','Permutas','Saldo','Nada a preencher.','O que falta quitar: valor atualizado − produzido. Negativo = pagou a mais.','Atualizado R$ 420 mil − produzido R$ 260 mil = saldo R$ 160 mil.','Ignorar o reajuste CUB: ele aumenta o valor atualizado e o saldo.','hub',5,'publicado'),
  ('hub.permutas.reajuste','/dashboard/hub/permutas','Permutas','Reajuste CUB acumulado','Nada a preencher.','Quanto o CUB já reajustou o valor dos contratos, somado por competência.','CUB acumulou R$ 18 mil no ano sobre as permutas.','Esquecer de lançar o CUB do mês: o valor atualizado fica defasado.','hub',6,'publicado'),
  ('hub.permutas.status_resumo','/dashboard/hub/permutas','Permutas','Quitadas × Em aberto','Nada a preencher.','Quantas permutas já foram quitadas e quantas seguem em aberto.','5 em aberto, 2 quitadas.','Achar que "em aberto" inclui as quitadas.','hub',7,'publicado'),
  ('hub.permutas.lista','/dashboard/hub/permutas','Permutas','Permutas','Nada a preencher.','Uma linha por permuta: ativo, obra, empresa, valor atualizado, quitado, saldo, barra de progresso e status. Clique para abrir o extrato.','Apto 1202 Amazon — 60% quitado, em andamento.','Não clicar na linha achando que não abre: ela abre o extrato.','hub',8,'publicado'),
  ('hub.permutas.status_col','/dashboard/hub/permutas','Permutas','Status','Nada a preencher.','A iniciar (cinza), em andamento, quitado (verde) ou pagou a mais (vermelho), calculado pelo saldo.','Saldo zerado → verde "Quitado".','Mudar o status na mão: ele é calculado pelos movimentos.','hub',9,'publicado'),
  ('hub.permutas.extrato','/dashboard/hub/permutas','Permutas','Extrato da permuta','Nada a preencher.','Mostra "valor do contrato + reajuste CUB = valor atualizado" no topo, e os movimentos agrupados por mês com data, tipo, nº da nota e valor; no fim, total quitado e saldo.','Novembro: NF123 gesso R$ 30 mil + NF124 serviço R$ 20 mil.','Ler o saldo sem o reajuste: o atualizado já inclui o CUB.','hub',10,'publicado'),
  ('hub.permutas.incluir','/dashboard/hub/permutas','Permutas','Incluir permuta','Abre o cadastro de uma nova permuta.','Cadastra o contrato: ativo, obra, valores, índice de reajuste e data base.','+ Incluir permuta → Apto 1202.','—','hub',11,'publicado'),
  ('hub.permutas.ativo_descr','/dashboard/hub/permutas','Permutas','Ativo (imóvel)','Descreva o imóvel recebido na permuta.','Identifica a conta-corrente: o imóvel que a empresa recebeu.','Apto 1202 Amazon; Lote 14 Quadra C.','Deixar vazio: o ativo é obrigatório.','hub',12,'publicado'),
  ('hub.permutas.obra','/dashboard/hub/permutas','Permutas','Obra','Escolha a obra do Hub ligada à permuta (opcional).','Liga a permuta à obra para puxar medição/custo na próxima fatia.','Obra "Edifício Amazon".','—','hub',13,'publicado'),
  ('hub.permutas.contratante','/dashboard/hub/permutas','Permutas','Contratante','Quem entregou o imóvel (a incorporadora/cliente).','Identifica a outra parte da permuta.','Incorporadora Amazon Ltda.','—','hub',14,'publicado'),
  ('hub.permutas.tipo_contrato','/dashboard/hub/permutas','Permutas','Tipo de contrato','100% dinheiro, 100% permuta, ou misto (parte permuta, parte dinheiro).','Define como o contrato é pago.','Misto: 40% permuta, 60% dinheiro.','Marcar misto sem informar o % de permuta.','hub',15,'publicado'),
  ('hub.permutas.pct_permuta','/dashboard/hub/permutas','Permutas','% de permuta','No misto, o percentual pago em permuta.','Documenta a divisão permuta × dinheiro.','40%.','—','hub',16,'publicado'),
  ('hub.permutas.valor_permuta','/dashboard/hub/permutas','Permutas','Valor da permuta','O valor do imóvel recebido (o crédito a quitar).','É a base do valor atualizado e do saldo.','R$ 100.000,00.','Pôr o valor em dinheiro aqui: use o campo Valor em dinheiro.','hub',17,'publicado'),
  ('hub.permutas.valor_dinheiro','/dashboard/hub/permutas','Permutas','Valor em dinheiro','No misto, a parte paga em dinheiro.','Informa a parcela em dinheiro do contrato.','R$ 150.000,00.','—','hub',18,'publicado'),
  ('hub.permutas.indice_reajuste','/dashboard/hub/permutas','Permutas','Índice de reajuste','O índice que corrige o contrato (ex.: CUB-SC).','Identifica o índice; o reajuste é lançado por mês.','CUB-SC.','—','hub',19,'publicado'),
  ('hub.permutas.data_base','/dashboard/hub/permutas','Permutas','Data base','A data de referência do contrato para o reajuste.','A partir dela conta o reajuste CUB.','01/01/2026.','—','hub',20,'publicado'),
  ('hub.permutas.intragrupo','/dashboard/hub/permutas','Permutas','Permuta intragrupo','Marque se a permuta é entre empresas do próprio grupo.','No consolidado do grupo, a intragrupo é eliminada (não soma duas vezes).','Permuta entre Tryo Gesso e Tryo Acabamentos.','—','hub',21,'publicado'),
  ('hub.permutas.anexo','/dashboard/hub/permutas','Permutas','Contrato (anexo)','Cole o link do contrato (upload do arquivo chega na próxima fatia).','Guarda a referência do contrato assinado.','Link do PDF do contrato.','—','hub',22,'publicado'),
  ('hub.permutas.mov_tipo','/dashboard/hub/permutas','Permutas','Tipo do movimento','Material, serviço/medição, dinheiro ou imóvel.','Diz como a permuta foi quitada neste lançamento.','Material (gesso).','—','hub',23,'publicado'),
  ('hub.permutas.mov_competencia','/dashboard/hub/permutas','Permutas','Competência (mês)','O mês de referência do movimento.','Agrupa os movimentos por mês no extrato e no fechamento.','Novembro/2026.','—','hub',24,'publicado'),
  ('hub.permutas.mov_valor','/dashboard/hub/permutas','Permutas','Valor','Quanto este movimento quitou da permuta.','Abate do saldo.','R$ 30.000,00.','—','hub',25,'publicado'),
  ('hub.permutas.mov_data','/dashboard/hub/permutas','Permutas','Data','A data do movimento/nota.','Ordena os movimentos do mês.','10/11/2026.','—','hub',26,'publicado'),
  ('hub.permutas.mov_num_nota','/dashboard/hub/permutas','Permutas','Nº da nota','O número da nota fiscal do material/serviço.','Rastreia a origem do movimento.','NF 123.','—','hub',27,'publicado'),
  ('hub.permutas.mov_cnpj','/dashboard/hub/permutas','Permutas','CNPJ emissor','O CNPJ que emitiu a nota.','Identifica de qual empresa saiu o material/serviço.','46.439.081/0001-21.','—','hub',28,'publicado'),
  ('hub.permutas.mov_empresa_emissora','/dashboard/hub/permutas','Permutas','Empresa emissora','A empresa do grupo que emitiu (ex.: Tryo Gesso emite material).','Liga o movimento ao CNPJ do grupo que produziu.','Tryo Gesso.','—','hub',29,'publicado'),
  ('hub.permutas.mov_obs','/dashboard/hub/permutas','Permutas','Observação','Uma nota livre sobre o movimento.','Contexto extra.','"Gesso do 12º andar".','—','hub',30,'publicado'),
  ('hub.permutas.reaj_competencia','/dashboard/hub/permutas','Permutas','Competência do CUB','O mês do reajuste.','Lança o CUB mês a mês.','Novembro/2026.','—','hub',31,'publicado'),
  ('hub.permutas.reaj_indice','/dashboard/hub/permutas','Permutas','Valor do índice','O valor do CUB no mês (opcional).','Documenta o índice usado.','CUB-SC 2.950,00/m².','—','hub',32,'publicado'),
  ('hub.permutas.reaj_valor','/dashboard/hub/permutas','Permutas','Reajuste do mês (R$)','O reajuste em reais aplicado no mês.','Soma ao valor atualizado do contrato.','R$ 5.000,00.','—','hub',33,'publicado'),
  ('hub.permutas.consolidado','/dashboard/hub/permutas','Permutas','Consolidado do grupo','Nada a preencher.','Soma os CNPJs do grupo eliminando a permuta intragrupo, com a linha do que foi eliminado.','4 CNPJs somando R$ 1,2 mi, menos R$ 80 mil intragrupo.','—','hub',34,'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
