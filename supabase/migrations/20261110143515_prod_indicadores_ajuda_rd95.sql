-- RD-95 ("?" em todo filtro/campo) · Produtividade › Indicadores (/dashboard/produtividade/indicadores).
-- Os filtros do topo (De, Até, Setor, Base do kg) e o campo Meta kg/h-h ficavam sem o "?" padrão
-- (<AjudaCampo>): a tela usava só rótulos aria/title. Semeia as 5 chaves produtividade.indicadores.*
-- em erp_ajuda_campo para o "?" padrão (cartão de 4 blocos, abre no celular, editável sem deploy).
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.
-- Não toca cálculo nem dado — só o texto do "?" lido por fn_ajuda_campo_listar.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('produtividade.indicadores.de','Produtividade · Indicadores','De (início do período)',
 'Escolha a primeira data do período que você quer analisar. Vem preenchido com 30 dias atrás; troque para ampliar ou encurtar a janela.',
 'Define o começo do intervalo de dias usado em todos os indicadores da tela (média, melhor/pior dia, tendência) e na tabela por dia.',
 'Colocar o 1º dia do mês para ver o kg por homem-hora do mês inteiro.',
 'Deixar "De" depois de "Até": o período fica invertido e nenhum dia é medido.',
 1,'/dashboard/produtividade/indicadores','industria','publicado'),
('produtividade.indicadores.ate','Produtividade · Indicadores','Até (fim do período)',
 'Escolha a última data do período. Vem preenchido com hoje; troque se quiser fechar o período em outra data.',
 'Define o fim do intervalo analisado. Junto com "De", é a janela de dias de todos os indicadores e da tabela.',
 'Deixar em "hoje" para acompanhar o mês corrente até o dia de hoje.',
 'Escolher uma data futura: só contam os dias que já têm produção e ponto lançados.',
 2,'/dashboard/produtividade/indicadores','industria','publicado'),
('produtividade.indicadores.setor','Produtividade · Indicadores','Setor',
 'Escolha o setor cujo desempenho você quer ver (ex.: Desossa). A lista traz os setores com produção e ponto no período.',
 'Troca o foco da tela para o setor escolhido: os KPIs, o gráfico e a tabela por dia passam a ser desse setor.',
 'Selecionar "DESOSSA" para acompanhar o kg por homem-hora da desossa.',
 'Achar que um setor "não tem dado" sem conferir o período: um setor pode não ter produção na janela escolhida.',
 3,'/dashboard/produtividade/indicadores','industria','publicado'),
('produtividade.indicadores.base','Produtividade · Indicadores','Base do kg',
 'Escolha qual produção do sistema de origem entra na conta do kg (numerador): só a produção da desossa, tudo que passa por ela, ou só o produto acabado.',
 'Muda o que é contado como "kg produzido" no indicador kg por homem-hora — diferentes bases dão números diferentes para a mesma equipe.',
 'Começar pela base padrão (produção da desossa) e comparar com "só produto acabado" para entender a diferença.',
 'Comparar meses com bases diferentes: para comparar desempenho, mantenha a mesma base do kg.',
 4,'/dashboard/produtividade/indicadores','industria','publicado'),
('produtividade.indicadores.meta','Produtividade · Indicadores','Meta kg/h-h',
 'Digite a meta de quilos por homem-hora do setor (ex.: 25). Deixe em branco para não ter meta. É salva ao sair do campo.',
 'Liga o semáforo dos indicadores: verde atinge a meta, âmbar fica perto (90%), vermelho fica abaixo. Sem meta não há semáforo.',
 'Definir 25 para a desossa e ver quais dias ficaram acima ou abaixo.',
 'Digitar 0 ou um valor negativo: a meta precisa ser maior que zero (ou vazia para não ter meta).',
 5,'/dashboard/produtividade/indicadores','industria','publicado')
ON CONFLICT (chave) DO NOTHING;
