-- Hub · Desempenho Comercial — RD-95 ("?" em cada indicador, aba de período e fase do funil) + RD-98 p3 (origem do dado).
-- Migration ADITIVA: só linhas de ajuda (upsert pela chave) e metadados de system_screens. Sem tocar dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Desempenho', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/desempenho', 'projetos', 'publicado'
FROM (VALUES
 ('projetos.desempenho.aba_periodo','Período (Mês · Trimestre · Ano)','Escolha a janela de datas. Mês, trimestre e ano são os do calendário atual; "Personalizado" abre as datas.','Define em que datas as vendas ganhas e perdidas são contadas. O pipeline aberto não depende do período.','Trimestre: 01/10 a 31/12','Olhar "Mês" logo no começo do mês e achar que não vendeu nada — troque para Trimestre ou Ano.',5),
 ('projetos.desempenho.conversao','Conversão','Não se preenche. É calculada: ganhas ÷ (ganhas + perdidas) no período, em %.','Mostra quanto das propostas decididas viraram venda. Verde ≥ 40%, âmbar ≥ 20%, vermelho abaixo.','3 ganhas e 1 perdida = 75%','Esperar valor sem nenhuma venda decidida: sem ganhas nem perdidas no período aparece "—", não 0%.',20),
 ('projetos.desempenho.ganhas','Ganhas','Não se preenche. Conta as oportunidades que fecharam como ganho dentro do período.','Mede as vendas fechadas; o valor abaixo é a soma das propostas ganhas.','3 ganhas · R$ 554.613,05','Oportunidade ganha sem data de fechamento não entra no período.',30),
 ('projetos.desempenho.perdidas','Perdidas','Não se preenche. Conta as oportunidades perdidas dentro do período.','Mostra o que escapou e quanto valia; o motivo está no bloco "Por que não fechou".','1 perdida · R$ 40.000,00','Perder sem informar o motivo: aparece como "(sem motivo)".',40),
 ('projetos.desempenho.ticket_medio','Ticket médio','Não se preenche. É o valor ganho dividido pela quantidade de ganhas.','Ajuda a calibrar o porte das obras que a equipe fecha.','R$ 184.871,02','Comparar períodos com poucas vendas: uma obra grande distorce a média.',50),
 ('projetos.desempenho.comissao','Comissão gerada','Não se preenche. Valor ganho × % de comissão do orçamento vinculado.','Estima a comissão devida à equipe comercial no período.','R$ 8.300,00','Oportunidade sem orçamento vinculado não gera comissão.',60),
 ('projetos.desempenho.pipeline','Pipeline aberto','Não se preenche. Soma das oportunidades que ainda não foram ganhas nem perdidas.','Mostra quanto ainda pode virar venda, independentemente do período.','R$ 226.948,80 · 6 oport.','Somar o pipeline à receita: ele é potencial, não venda.',70),
 ('projetos.desempenho.velocidade','Velocidade','Não se preenche. Média de dias entre criar a oportunidade e fechá-la como ganho.','Mostra o tamanho do ciclo de venda.','21 d','Sem ganhas no período não há média ("—").',80),
 ('projetos.desempenho.funil','Funil por fase','Não se preenche. Quantidade e valor de oportunidades em cada fase.','Mostra onde as oportunidades se acumulam. Ganho e Perdido contam só o período.','Prospecção 1 · R$ 41.000,00','Achar que o funil soma o total do pipeline: Ganho e Perdido seguem o período escolhido.',90),
 ('projetos.desempenho.fase_prospeccao','Fase · Prospecção','Não se preenche. Oportunidades recém-registradas, ainda sem visita.','Topo do funil: mostra se há demanda nova entrando.','2 em prospecção','Deixar oportunidade parada aqui por semanas.',91),
 ('projetos.desempenho.fase_visita','Fase · Visita','Não se preenche. Oportunidades com visita técnica feita.','Indica quantas já foram vistas em obra e aguardam orçamento.','1 com visita feita','Visita feita sem registrar no ERP não aparece aqui.',92),
 ('projetos.desempenho.fase_proposta','Fase · Proposta','Não se preenche. Oportunidades com proposta enviada ao cliente.','Mostra o valor já colocado na mesa.','R$ 49.948,80','Proposta enviada por fora do ERP não conta.',93),
 ('projetos.desempenho.fase_negociacao','Fase · Negociação','Não se preenche. Oportunidades em negociação de preço ou prazo.','Último passo antes de ganhar ou perder.','1 em negociação','Esquecer de mover para Ganho/Perdido ao fechar.',94),
 ('projetos.desempenho.fase_ganho','Fase · Ganho','Não se preenche. Oportunidades ganhas dentro do período.','Fecha o ciclo: vira obra e contrato.','3 ganhas','Mudar de período e achar que sumiram.',95),
 ('projetos.desempenho.fase_perdido','Fase · Perdido','Não se preenche. Oportunidades perdidas dentro do período.','Base para entender os motivos de perda.','1 perdida','Marcar como perdido sem motivo.',96),
 ('projetos.desempenho.ranking','Ranking de vendedores','Não se preenche. Cada vendedor com oportunidades, propostas, ganhas, conversão, ticket e comissão. Só gestor vê.','Compara o desempenho da equipe comercial no período.','1º Maria · R$ 300.000,00','Comparar vendedores com carteiras de tamanho muito diferente.',100),
 ('projetos.desempenho.perdas','Perdas por motivo','Não se preenche. Perdidas do período agrupadas pelo motivo informado.','Mostra por que o cliente não fechou (preço, prazo, concorrente…).','Preço · R$ 40.000,00 · 1','Não registrar o motivo ao perder: tudo cai em "(sem motivo)".',110),
 ('projetos.desempenho.ir_oportunidades','Ir para Oportunidades','Não se preenche. Atalho que abre o funil de oportunidades.','Quando a tela está vazia, é por onde se cadastra a primeira oportunidade.','—','—',120)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical, status = EXCLUDED.status;

-- RD-98 p3: origem do dado de src/app/dashboard/projetos/desempenho/page.tsx (grep: .from + .rpc)
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_crm_oportunidade','erp_orcamentos']::text[],
       rpcs_chamadas = ARRAY['fn_crm_desempenho']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/desempenho';
