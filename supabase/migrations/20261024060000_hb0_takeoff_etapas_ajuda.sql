-- HB0 (auditor F20 em /dashboard/projetos/takeoff): a tela ganha as etapas do fluxo, os contadores de ambientes e a
-- lista das plantas enviadas. Só acrescenta os textos do "?" (RD-95) das áreas novas. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/takeoff', 'projetos', 'publicado'
FROM (VALUES
 ('projetos.takeoff.etapas', 'Take-off', 'Etapas do take-off', 'Nada a preencher: mostra as 6 etapas, do envio da planta ao orçamento, e destaca a etapa em que você está.', 'Mostra o que falta para o take-off virar orçamento.', 'Etapa 4 de 6: Vincular serviços.', 'Gerar o orçamento com ambiente sem serviço: ele fica de fora dos itens.', 180),
 ('projetos.takeoff.cont_extraidos', 'Ambientes do take-off', 'Ambientes', 'Nada a preencher: quantos ambientes a planta tem, extraídos pela IA ou digitados na mão.', 'Confere se a IA achou todos os cômodos da planta.', '5 ambientes na planta da sala comercial.', 'Faltou um cômodo: use "+ Adicionar ambiente".', 190),
 ('projetos.takeoff.cont_confirmados', 'Ambientes do take-off', 'Confirmados', 'Nada a preencher: ambientes com a caixa OK marcada depois de conferir as medidas.', 'Só ambiente conferido entra no orçamento.', '3 de 5 confirmados.', 'Confirmar sem conferir a medida que a IA sugeriu.', 200),
 ('projetos.takeoff.cont_com_servico', 'Ambientes do take-off', 'Com serviço', 'Nada a preencher: ambientes que já têm um serviço do catálogo escolhido.', 'O serviço dá o preço por m², metro linear ou parede.', '4 de 5 com serviço.', 'Deixar o serviço em branco: o ambiente não vira item.', 210),
 ('projetos.takeoff.cont_prontos', 'Ambientes do take-off', 'Prontos para orçar', 'Nada a preencher: ambientes confirmados e com serviço. Só esses viram item do orçamento.', 'Mostra quantos itens o orçamento vai receber.', '5 prontos = 5 itens no orçamento.', 'Esperar itens de ambientes não confirmados.', 220),
 ('projetos.takeoff.plantas_enviadas', 'Take-off', 'Plantas enviadas', 'Toque numa planta para abrir de novo os ambientes dela.', 'Retoma um take-off de onde parou, sem enviar o arquivo outra vez.', 'Planta baixa – Sala comercial · Pronta para orçar.', 'Enviar a mesma planta de novo: abra a que já está na lista.', 230)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
