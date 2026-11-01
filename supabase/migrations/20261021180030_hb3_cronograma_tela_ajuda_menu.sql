-- HB3 (fatia 2) · Tela do cronograma da obra: "?" dos campos (RD-95) + system_screens. Aditiva (só texto de ajuda e cadastro de tela).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.nova_tarefa', 'Nova tarefa', 'Nada a preencher: abre o formulário para cadastrar uma etapa da obra.', 'Monta o cronograma etapa por etapa, com datas e dependências.', 'Fundação, de 01/11 a 15/11.', 'Cadastrar a obra inteira numa tarefa só: assim o avanço perde sentido.', 10),
 ('projetos.cronograma.linha_base', 'Fixar linha de base', 'Nada a preencher: clique quando o cronograma estiver combinado com o cliente.', 'Guarda as datas atuais como referência; depois o sistema mostra o que atrasou em relação a elas.', 'Fixe a base na assinatura do contrato e acompanhe os desvios.', 'Fixar a base antes de ajustar as datas: ela passa a medir contra datas provisórias.', 11),
 ('projetos.cronograma.nome', 'Nome da tarefa', 'Escreva o nome curto da etapa.', 'Identifica a barra no gráfico e a tarefa nas dependências.', 'Alvenaria do 2º pavimento.', 'Nomes iguais para etapas diferentes: confunde a escolha da predecessora.', 12),
 ('projetos.cronograma.inicio', 'Início', 'Escolha o dia em que a etapa começa.', 'Define onde a barra começa e o prazo da etapa.', '01/11/2026.', 'Início depois do fim: o sistema recusa.', 13),
 ('projetos.cronograma.fim', 'Fim', 'Escolha o dia em que a etapa termina.', 'Define o tamanho da barra e a comparação com a linha de base.', '15/11/2026.', 'Esquecer fins de semana ao estimar a duração.', 14),
 ('projetos.cronograma.percentual', 'Avanço (%)', 'Informe de 0 a 100 quanto da etapa já foi feito.', 'Pinta a barra e entra no avanço geral, ponderado pela duração de cada tarefa.', '40 para uma etapa quase na metade.', 'Lançar 100 antes da conferência em campo.', 15),
 ('projetos.cronograma.predecessora', 'Depende de', 'Escolha a etapa que precisa terminar antes desta (ou deixe em "Nenhuma").', 'Registra a ordem entre as etapas; o sistema recusa dependência circular.', 'Reboco depende de Alvenaria.', 'Ligar duas etapas uma na outra: gera ciclo e é recusado.', 16),
 ('projetos.cronograma.defasagem', 'Defasagem (dias)', 'Informe quantos dias esperar depois da predecessora (negativo adianta).', 'Ajusta a ligação, como o tempo de cura entre duas etapas.', '7 dias de cura do concreto.', 'Usar a defasagem para empurrar a data: ajuste início e fim.', 17)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_obras_id_cronograma', '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'Cronograma da obra', 'Tarefas, dependências, linha de base e barras no tempo da obra', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;
