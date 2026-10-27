-- Hub · /dashboard/projetos/desempenho — nota 30 → 95 (aud8 27/10, caixa 3c28a6ec · Code: dev7claudeps)
--   RD-38: provado no banco que fn_crm_desempenho devolve dados reais da DEMO 006 (mês: 5 oportunidades / 1 ganha R$ 39.716;
--   ano: 7 oportunidades / 3 ganhas R$ 554.613,05). Os zeros da foto eram de antes da semente; a tela agora mostra o dado e,
--   quando o período realmente não tem movimento, explica e dá o caminho (CTA) em vez de só zeros.
--   RD-95: "?" em cada indicador, aba de período, fase do funil, ranking e perdas.   RD-98 p3: system_screens.
-- Aditiva: só linhas de ajuda + metadado da tela.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.desempenho.periodo_abas', 'Período', 'Período da análise',
 'Escolha Mês, Trimestre, Ano ou Personalizado para definir o intervalo dos números.',
 'Todos os indicadores, o funil, o ranking e as perdas passam a considerar só esse intervalo.', 'Ano: de 01/01 a 31/12', 'Comparar um mês curto com o ano inteiro.', 500, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.card_conversao', 'Indicadores', 'Conversão',
 'Nada a preencher: percentual de propostas decididas que viraram negócio (ganhas ÷ ganhas + perdidas).',
 'Mostra a eficiência comercial. Acima de 40% é alta, entre 20% e 40% é média, abaixo de 20% é baixa.', '3 ganhas e 1 perdida = 75%', 'Ler como valor em reais: é um percentual.', 510, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.card_ganhas', 'Indicadores', 'Ganhas',
 'Nada a preencher: quantidade e valor das oportunidades ganhas no período.',
 'É o resultado de vendas já fechado.', '3 ganhas · R$ 554.613,05', 'Somar o pipeline aberto como se já fosse venda.', 520, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.card_perdidas', 'Indicadores', 'Perdidas',
 'Nada a preencher: quantidade e valor das oportunidades perdidas no período.',
 'Mostra o que escapou. Veja o motivo no quadro de perdas.', '2 perdidas · R$ 80.000,00', 'Ignorar o motivo da perda: é o que ensina a melhorar.', 530, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.card_ticket', 'Indicadores', 'Ticket médio',
 'Nada a preencher: valor ganho dividido pela quantidade de ganhas.',
 'Indica o tamanho médio do negócio fechado.', 'R$ 184.871,02', 'Comparar períodos com poucas vendas.', 540, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.card_comissao', 'Indicadores', 'Comissão gerada',
 'Nada a preencher: comissão calculada sobre as vendas ganhas, pela regra de cada vendedor.',
 'Ajuda a prever o custo comercial do período.', 'R$ 5.540,00', 'Esperar valor sem regra de comissão cadastrada: aparece zero.', 550, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.card_pipeline', 'Indicadores', 'Pipeline aberto',
 'Nada a preencher: soma das oportunidades ainda em andamento, com a quantidade de oportunidades e propostas.',
 'É a previsão de vendas que ainda depende de fechamento.', 'R$ 226.948,80 · 5 oport.', 'Tratar todo o pipeline como venda certa.', 560, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.card_velocidade', 'Indicadores', 'Velocidade',
 'Nada a preencher: média de dias entre criar a oportunidade e fechá-la.',
 'Mostra quanto o ciclo de venda demora; menos dias é melhor.', '21 d', 'Concluir algo com poucos negócios fechados.', 570, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.funil', 'Funil', 'Funil por fase',
 'Nada a preencher: quantidade e valor de oportunidades em cada fase do funil.',
 'Mostra onde os negócios estão parando. A barra é proporcional à fase mais cheia.', 'Prospecção 7 · Negociação 2', 'Olhar só a última fase e esquecer o gargalo no meio.', 580, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.fase_prospeccao', 'Funil', 'Fase: Prospecção',
 'Nada a preencher: oportunidades recém-criadas, ainda sem visita.',
 'Início do funil.', '7 · R$ 300.000,00', 'Deixar oportunidade parada nesta fase.', 590, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.fase_visita_feita', 'Funil', 'Fase: Visita',
 'Nada a preencher: oportunidades em que a visita técnica já foi feita.',
 'Mostra o avanço depois do primeiro contato.', '4 · R$ 150.000,00', 'Esquecer de registrar a visita.', 600, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.fase_proposta_enviada', 'Funil', 'Fase: Proposta',
 'Nada a preencher: oportunidades com proposta enviada ao cliente.',
 'Acompanha o que está aguardando resposta.', '3 · R$ 120.000,00', 'Deixar a proposta vencer sem retorno.', 610, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.fase_negociacao', 'Funil', 'Fase: Negociação',
 'Nada a preencher: oportunidades em negociação final.',
 'São as mais próximas de fechar.', '2 · R$ 90.000,00', 'Dar desconto sem checar a margem.', 620, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.fase_ganho', 'Funil', 'Fase: Ganho',
 'Nada a preencher: oportunidades fechadas com o cliente.',
 'Gera a obra a partir da proposta aprovada.', '3 · R$ 554.613,05', 'Não conferir se a obra foi criada.', 630, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.fase_perdido', 'Funil', 'Fase: Perdido',
 'Nada a preencher: oportunidades perdidas.',
 'Veja o motivo no quadro de perdas.', '2 · R$ 80.000,00', 'Perder sem registrar o motivo.', 640, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.ranking', 'Ranking', 'Ranking de vendedores',
 'Nada a preencher: compara os vendedores no período (só o gestor vê todos).',
 'Ajuda a reconhecer quem converte mais e a dividir bem as oportunidades.', '1. Marcos — conversão 60%', 'Comparar vendedores com carteiras de tamanhos muito diferentes.', 650, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.perdas', 'Perdas', 'Perdas por motivo',
 'Nada a preencher: agrupa as oportunidades perdidas pelo motivo informado.',
 'Mostra por que o cliente não fechou: preço, prazo, concorrência etc.', 'Preço: R$ 50.000,00 · 2', 'Registrar “outros” sempre: o quadro perde utilidade.', 660, '/dashboard/projetos/desempenho', 'projetos', 'publicado'),
('projetos.desempenho.sem_dados', 'Período', 'Período sem movimento',
 'Nada a preencher: avisa que não há oportunidades nem vendas no intervalo escolhido.',
 'Evita ler zeros como se o comercial estivesse parado: pode ser só o período.', 'Mês sem oportunidades novas', 'Concluir que o sistema falhou: troque o período ou cadastre oportunidades.', 670, '/dashboard/projetos/desempenho', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_crm_oportunidade','erp_orcamentos','erp_crm_visita']::text[],
       rpcs_chamadas = ARRAY['fn_crm_desempenho']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/desempenho';
