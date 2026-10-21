-- HB3 fatia 2 · tela do cronograma da obra: "?" de cada campo (RD-95) + tela em system_screens. Aditiva e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.nome', 'Nome da tarefa', 'Escreva a etapa como a equipe a conhece.', 'Identifica a barra no cronograma e nas dependências.', 'Forro de gesso - sala 2', 'Nomes iguais para etapas diferentes: fica difícil ligar as dependências.', 1),
 ('projetos.cronograma.inicio', 'Início', 'Data prevista para começar a etapa.', 'Posiciona a barra no tempo e entra no avanço ponderado.', '03/11', 'Colocar início depois do fim: o sistema recusa.', 2),
 ('projetos.cronograma.fim', 'Fim', 'Data prevista para terminar a etapa.', 'Define o tamanho da barra; fim passado com menos de 100% marca a tarefa como atrasada.', '14/11', 'Esquecer de ajustar o fim quando a etapa atrasa.', 3),
 ('projetos.cronograma.percentual', '% concluído', 'Quanto da etapa já foi feito, de 0 a 100.', 'Pinta a parte feita da barra e pondera o avanço físico da obra pelos dias de cada tarefa.', '40', 'Informar 100 antes de a etapa estar realmente entregue.', 4),
 ('projetos.cronograma.linha_base', 'Gravar linha de base', 'Nada a preencher: clique para fotografar as datas atuais.', 'Guarda o plano original para mostrar quantos dias cada tarefa se afastou dele.', 'Grave quando o cronograma for aprovado pelo cliente.', 'Gravar de novo no meio da obra: a base anterior é substituída.', 5),
 ('projetos.cronograma.dep_tarefa', 'Tarefa (dependência)', 'Escolha a tarefa que só pode começar depois de outra.', 'Registra a ordem entre etapas; ciclos são recusados.', 'Pintura', 'Escolher a mesma tarefa nos dois campos.', 6),
 ('projetos.cronograma.dep_pred', 'Depende de', 'Escolha a tarefa que precisa terminar antes.', 'Forma a cadeia de etapas usada para planejar prazos e compras.', 'Forro de gesso', 'Criar dependência circular (A depende de B e B de A).', 7),
 ('projetos.cronograma.dep_defasagem', 'Defasagem (dias)', 'Dias de espera entre o fim de uma e o início da outra; use 0 se não houver.', 'Considera tempos como secagem ou cura entre etapas.', '2', 'Usar defasagem negativa sem querer sobrepor as etapas.', 8)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_obras_id_cronograma', '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'Cronograma da obra', 'Tarefas no tempo, dependências, avanço ponderado e linha de base', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;
