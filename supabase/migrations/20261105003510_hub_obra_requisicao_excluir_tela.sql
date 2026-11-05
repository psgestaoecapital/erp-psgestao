-- Hub · Gestão de Obras · aba Materiais (HBF-1.1 · slice 3) — backend da tela
-- A tela /dashboard/projetos/obras/[id]/materiais lista as requisições da obra,
-- permite requisitar material em 1 passo a partir dos itens de escopo (slice 1,
-- fn_obra_requisicao_criar/_listar já em produção) e exclui o vínculo de forma
-- RASTREÁVEL. Fronteira [→GE]: a SOLICITAÇÃO de compra continua da GE — excluir aqui
-- apaga apenas o VÍNCULO obra↔solicitação (a solicitação permanece para o comprador).
-- Tudo aditivo: 1 RPC nova de exclusão rastreável + chaves de ajuda (RD-95) + registro
-- da origem do dado em system_screens (RD-98 p3).

-- 1) Exclusão RASTREÁVEL do vínculo de requisição (soft-delete + audit_log) ------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_requisicao_excluir(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE r public.projetos_obra_requisicao%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.projetos_obra_requisicao WHERE id = p_id AND excluido_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Requisição não encontrada (talvez já excluída).'); END IF;
  -- defesa em profundidade: a empresa do registro tem de ser a do usuário (a RLS também cobre)
  PERFORM public.fn__guarda_empresa(r.company_id);
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;

  UPDATE public.projetos_obra_requisicao
     SET excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = btrim(p_motivo)
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (r.company_id, auth.uid(), 'projetos_obra_requisicao', p_id::text, 'excluir',
            jsonb_build_object('obra_id', r.obra_id, 'solicitacao_id', r.solicitacao_id, 'qtd_itens', r.qtd_itens),
            jsonb_build_object('motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true);
END;
$f$;

REVOKE ALL ON FUNCTION public.fn_obra_requisicao_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_requisicao_excluir(uuid, text) TO authenticated, service_role;

-- 2) Ajuda de campo (RD-95 "?") da aba Materiais --------------------------------------------------
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status) VALUES
 ('projetos.obra_materiais.tela','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Materiais',
  'Veja e gere as requisições de material desta obra. A compra em si continua no setor de Compras (GE).',
  'Transforma os itens de escopo da obra em pedido de compra sem redigitar — rastreável e ligado à obra.',
  'Abra a aba Materiais da obra para pedir o material do piso que vai começar.',
  'Procurar aqui o estoque/nota fiscal: isso fica em Compras (GE); aqui nasce o pedido.','projetos',1,'publicado'),
 ('projetos.obra_materiais.kpi_requisicoes','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Requisições',
  'Quantas requisições de material desta obra já foram geradas (não excluídas).',
  'Mostra de relance se a obra já tem pedidos de compra em andamento.',
  '3 requisições: três pedidos já enviados ao setor de Compras.',
  'Confundir com itens: uma requisição pode ter vários itens de escopo.','projetos',2,'publicado'),
 ('projetos.obra_materiais.kpi_itens_escopo','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Itens de escopo',
  'Quantos itens de escopo da obra têm descrição e podem virar requisição.',
  'Indica o quanto do escopo ainda pode ser requisitado.',
  '5 itens de escopo: você pode gerar a requisição com todos ou só alguns.',
  'Itens sem descrição não entram na requisição.','projetos',3,'publicado'),
 ('projetos.obra_materiais.requisitar','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Requisitar material',
  'Toque para escolher os itens de escopo e gerar, em 1 passo, uma solicitação de compra na GE.',
  'Gera o pedido de compra a partir do escopo já cadastrado, sem redigitar material e quantidade.',
  'Vai começar a alvenaria: requisite os itens de alvenaria do escopo.',
  'Gerar duas vezes os mesmos itens: confira as requisições já existentes antes.','projetos',4,'publicado'),
 ('projetos.obra_materiais.selecionar_itens','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Selecionar itens',
  'Marque os itens de escopo que entram nesta requisição. A quantidade vem da contratada (o comprador ajusta na GE).',
  'Deixa você pedir só o material da etapa que vai começar, não a obra inteira de uma vez.',
  'Marque "Piso industrial" e "Rodapé" para a etapa de piso.',
  'Deixar tudo marcado quando só uma etapa vai começar: pede material cedo demais.','projetos',5,'publicado'),
 ('projetos.obra_materiais.selecionar_todos','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Selecionar todos',
  'Marca ou desmarca todos os itens de escopo de uma vez.',
  'Atalho para requisitar a obra inteira quando faz sentido pedir tudo junto.',
  'Obra pequena: marque todos e gere uma única requisição.',
  'Usar em obra grande sem conferir: revise antes de gerar.','projetos',6,'publicado'),
 ('projetos.obra_materiais.justificativa','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Justificativa',
  'Texto livre explicando o porquê do pedido (etapa, prazo). Vai junto na solicitação de compra.',
  'Ajuda o comprador a priorizar e dá rastro do motivo do pedido.',
  '"Material para iniciar o piso na semana que vem."',
  'Deixar vazio: o comprador fica sem contexto para priorizar.','projetos',7,'publicado'),
 ('projetos.obra_materiais.gerar','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Gerar requisição',
  'Confirma e cria a solicitação de compra (rascunho) na GE com os itens marcados.',
  'Fecha o pedido em 1 passo; depois é só acompanhar o status aqui.',
  'Marcou 3 itens e a justificativa: toque em Gerar.',
  'Gerar sem marcar nenhum item: escolha ao menos um item com descrição.','projetos',8,'publicado'),
 ('projetos.obra_materiais.col_numero','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Nº',
  'Número da solicitação de compra na GE.',
  'Identifica o pedido para procurar em Compras.',
  '#124: solicitação 124 na GE.',
  'Confundir com o número da obra.','projetos',9,'publicado'),
 ('projetos.obra_materiais.col_titulo','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Título',
  'Título gerado para a solicitação (obra + "materiais do escopo").',
  'Descreve o pedido na lista de Compras.',
  '"Obra DEMO-FC-001 — materiais do escopo".',
  'Editar aqui: o título se ajusta na GE.','projetos',10,'publicado'),
 ('projetos.obra_materiais.col_status','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Status',
  'Em que fase a solicitação está na GE (rascunho, enviada, aprovada, etc.).',
  'Acompanha o andamento do pedido sem sair da obra.',
  'Rascunho: ainda não foi enviada ao comprador.',
  'Achar que "rascunho" já comprou: o fluxo segue na GE.','projetos',11,'publicado'),
 ('projetos.obra_materiais.col_itens','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Itens',
  'Quantos itens de escopo entraram nesta requisição.',
  'Mostra o tamanho do pedido de relance.',
  '4 itens: a requisição levou quatro linhas de escopo.',
  'Confundir com quantidade de material (que está na GE).','projetos',12,'publicado'),
 ('projetos.obra_materiais.col_criada','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Criada em',
  'Data e hora em que a requisição foi gerada.',
  'Ajuda a saber há quanto tempo o pedido espera.',
  '01/11 14:20.',
  'Confundir com a data de entrega (definida em Compras).','projetos',13,'publicado'),
 ('projetos.obra_materiais.ver_ge','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Ver em Compras',
  'Abre a lista de solicitações de Compras (GE) para acompanhar e tratar o pedido.',
  'Leva ao setor responsável pela compra, sem duplicar o fluxo no Hub.',
  'Toque para enviar a solicitação ao fornecedor na GE.',
  'Esperar comprar aqui: a compra é feita na GE.','projetos',14,'publicado'),
 ('projetos.obra_materiais.excluir','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Excluir',
  'Remove o vínculo desta requisição com a obra (com motivo, rastreável). A solicitação na GE não é apagada.',
  'Desfaz um pedido gerado por engano sem mexer no que já corre em Compras.',
  'Requisitou a etapa errada: exclua o vínculo e informe o motivo.',
  'Achar que cancela a compra na GE: aqui só o vínculo sai; cancele na GE se preciso.','projetos',15,'publicado'),
 ('projetos.obra_materiais.vazio','/dashboard/projetos/obras/[id]/materiais','Materiais da obra','Nenhuma requisição',
  'Aparece quando a obra ainda não tem requisição. Toque em "Requisitar material" para criar a primeira.',
  'Deixa claro que a tela funciona — só falta gerar o primeiro pedido.',
  'Obra nova: gere a requisição dos itens da primeira etapa.',
  'Achar que está quebrada: é só não haver pedido ainda.','projetos',16,'publicado'),
 ('projetos.cockpit.materiais','/dashboard/projetos/obras/[id]/cockpit','Cockpit da obra','Materiais da obra',
  'Atalho para a aba Materiais: requisições de material desta obra, geradas a partir do escopo.',
  'Leva da visão geral da obra ao pedido de material em 1 passo.',
  'Vai começar uma etapa: abra Materiais e requisite os itens do escopo.',
  'Procurar o estoque aqui: a compra em si fica no setor de Compras (GE).','projetos',17,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 3) Origem do dado (RD-98 p3): registra a tela em system_screens ---------------------------------
INSERT INTO system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas)
SELECT 'dashboard.projetos_obras_id_materiais', '/dashboard/projetos/obras/[id]/materiais', 'hub_construcao', 'Materiais da obra',
       'Lista e gera as requisições de material da obra a partir dos itens de escopo (slice 1), com exclusão rastreável. A compra segue na GE.',
       ARRAY['projetos_obra_requisicao','erp_compras_solicitacao','projetos_obra_item']::text[],
       ARRAY['fn_obra_requisicao_listar','fn_obra_requisicao_criar','fn_obra_requisicao_excluir']::text[]
WHERE NOT EXISTS (SELECT 1 FROM system_screens WHERE rota='/dashboard/projetos/obras/[id]/materiais');

UPDATE system_screens
   SET views_consumidas = ARRAY['projetos_obra_requisicao','erp_compras_solicitacao','projetos_obra_item']::text[],
       rpcs_chamadas    = ARRAY['fn_obra_requisicao_listar','fn_obra_requisicao_criar','fn_obra_requisicao_excluir']::text[]
 WHERE rota='/dashboard/projetos/obras/[id]/materiais';
