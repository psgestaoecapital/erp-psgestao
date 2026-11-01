-- P&M · Propostas/Orçamentos (/dashboard/pm/propostas) — RD-95 "?" em todo campo/indicador + RD-98 p3 (origem do dado).
-- Motivo (PDCA auditor, nota 90): a tela já tem CRUD rastreável e dado real, faltava o "?" (AjudaCampo) nos campos do
-- formulário, do fluxo de aprovação e nos indicadores, e `system_screens` estava com origem do dado vazia.
-- ADITIVA: só insere chaves de ajuda (erp_ajuda_campo) e preenche metadado em system_screens. Nada de cliente é tocado,
-- nenhuma função/RLS/permissão. Reversão: DELETE das chaves 'pm.propostas.%' e o UPDATE volta os arrays a vazio.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Proposta', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/pm/propostas', 'pm', 'publicado'
FROM (VALUES
 ('pm.propostas.cliente', 'Cliente (cadastro GE)', 'Busque o cliente pelo nome ou CNPJ. Veio de um lead sem cadastro? Use "Cadastrar na GE" para criar na hora.', 'Liga a proposta ao cadastro único do cliente (base da Gestão Empresarial), para faturar e dar sequência sem redigitar.', 'Padaria do Zé — ou 12.345.678/0001-90.', 'Criar um cliente repetido quando ele já existe: busque antes de cadastrar.', 1),
 ('pm.propostas.titulo', 'Título', 'Nome curto que identifica a proposta na lista.', 'Diferencia esta proposta das outras do mesmo cliente.', 'Gestão de redes + tráfego — 2026.', 'Deixar em branco ou genérico ("Proposta 1"): fica difícil achar depois.', 2),
 ('pm.propostas.itens', 'Itens do orçamento', 'Adicione serviços do catálogo (preço já vem preenchido) ou itens avulsos. Informe tipo, descrição, quantidade, unidade e valor unitário.', 'A soma dos itens forma o subtotal; o preço do catálogo evita errar valor e padroniza a oferta.', 'Social 1 mês × R$ 1.800,00 + Tráfego 1 × R$ 1.200,00.', 'Digitar à mão um serviço que está no catálogo: perde a padronização e o controle de preço.', 3),
 ('pm.propostas.desconto', 'Desconto (R$)', 'Valor em reais abatido do subtotal dos itens. Deixe 0 se não houver.', 'Chega ao valor final da proposta; a empresa pode limitar o desconto máximo nas Configurações.', 'Subtotal R$ 3.000,00, desconto R$ 300,00 → final R$ 2.700,00.', 'Digitar porcentagem no campo de reais: aqui é o valor em R$, não %.', 4),
 ('pm.propostas.condicao', 'Condição de pagamento', 'Como o cliente vai pagar: mensal (recorrente), projeto à vista ou projeto parcelado.', 'Define o modelo da cobrança e, na aprovação, se nasce um contrato recorrente ou avulso.', 'Mensal — para um fee de gestão.', 'Marcar "Mensal" num projeto pontual: ele viraria recorrente por engano.', 5),
 ('pm.propostas.observacoes', 'Observações', 'Texto livre com combinados, escopo extra ou condições que o cliente precisa enxergar na proposta.', 'Registra o que não cabe nos itens e acompanha a proposta no envio.', 'Inclui 1 reunião mensal de alinhamento.', 'Colocar preço/condição aqui em vez dos campos próprios: não entra no cálculo.', 6),
 ('pm.propostas.fee', 'Fee mensal (R$)', 'Valor do contrato recorrente que nasce ao aprovar. Deixe 0 para aprovar sem contrato (projeto avulso).', 'Define a mensalidade do contrato na Gestão Empresarial e a base da cobrança automática.', 'R$ 2.500,00/mês.', 'Deixar 0 achando que não aprova: 0 aprova sim, só não cria contrato recorrente.', 7),
 ('pm.propostas.dia_venc', 'Dia do vencimento', 'Dia do mês em que a mensalidade vence (1 a 28).', 'Define quando a cobrança do contrato recorrente cai todo mês.', '10 — vence todo dia 10.', 'Usar 29–31: meses curtos não têm esses dias; o limite é 28.', 8),
 ('pm.propostas.periodicidade', 'Periodicidade', 'De quanto em quanto tempo o fee é cobrado: mensal, trimestral ou anual.', 'Define o ciclo de faturamento do contrato recorrente.', 'Mensal.', 'Escolher anual quando o combinado é mensal: muda o valor que o cliente espera pagar.', 9),
 ('pm.propostas.comissao_pct', 'Comissão do comercial (%)', 'Percentual de comissão de quem fechou. Deixe 0 se não houver.', 'Calcula a comissão gerada na aprovação, sobre a base escolhida.', '10 — 10% sobre o fee.', 'Esquecer a base: 10% do fee é diferente de 10% do valor total da proposta.', 10),
 ('pm.propostas.comissao_base', 'Base da comissão', 'Sobre o que incide a comissão: o fee mensal ou o valor da proposta.', 'Define o valor de referência do cálculo da comissão.', 'Fee mensal.', 'Marcar "Valor da proposta" num fee recorrente: a comissão sai bem maior que o combinado.', 11),
 ('pm.propostas.comissao_tipo', 'Tipo da comissão', 'Única (paga uma vez) ou recorrente (todo ciclo do contrato).', 'Define se a comissão se repete a cada cobrança ou é paga só na assinatura.', 'Única — paga só ao fechar.', 'Marcar recorrente sem alinhar: a comissão se repete todo mês.', 12),
 ('pm.propostas.kpi_total', 'Propostas (indicador)', 'Não se preenche: total de propostas da empresa (sem as excluídas).', 'Mostra o tamanho do funil comercial de uma olhada.', '14 propostas.', 'Achar que conta as excluídas: a lista e o indicador escondem as excluídas.', 13),
 ('pm.propostas.kpi_pendentes', 'Pendentes (indicador)', 'Não se preenche: propostas ainda em rascunho ou enviadas, aguardando decisão do cliente.', 'Mostra o que precisa de acompanhamento para não esfriar.', '5 pendentes.', 'Confundir com recusadas: pendente é o que ainda está em aberto.', 14),
 ('pm.propostas.kpi_aprovadas', 'Aprovadas (indicador)', 'Não se preenche: quantas propostas o cliente aprovou.', 'Mede a conversão do comercial.', '6 aprovadas.', 'Esperar que some as recusadas: conta só as aprovadas.', 15),
 ('pm.propostas.kpi_valor_aprovado', 'Valor aprovado (indicador)', 'Não se preenche: soma do valor final das propostas aprovadas.', 'Mostra quanto de negócio já foi fechado no período.', 'R$ 18.400,00.', 'Comparar com o pipeline total: aqui é só o que foi aprovado, não o em aberto.', 16)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3 (origem do dado): o que a tela realmente consome (grep .from()/.rpc() de pm/propostas/page.tsx).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_propostas','agency_proposta_itens','agency_proposta_config','agency_clientes','agency_leads','erp_clientes','erp_contratos']::text[],
       rpcs_chamadas = ARRAY['fn_agency_proposta_criar','fn_agency_proposta_editar','fn_agency_proposta_excluir','fn_agency_proposta_itens_sync','fn_agency_proposta_aprovar','fn_agency_servico_listar_proposta','fn_cliente_buscar','fn_cliente_criar_inline']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/propostas';
