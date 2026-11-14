-- RD-95 (CEO 08/10): "?" para a ação "Gerar contrato a partir de modelo" no detalhe do contrato
-- (/dashboard/contratos). Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING); não toca dado de cliente.
-- Code: desenvolvedor_4_g. Fecha o #5452: o modelo (fn_contrato_modelo_gerar) agora é acionável na tela.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.contrato.gerar_modelo.modelo', 'Contratos', 'Modelo de contrato',
  'Escolha um dos modelos de contrato já cadastrados da sua empresa (aba Modelos). Só aparecem os modelos ativos.',
  'O sistema pega o texto do modelo e troca os campos variáveis ({{cliente_nome}}, {{valor_mensal}}, datas…) pelos dados reais deste contrato, montando o texto final em um clique.',
  'Modelo "Prestação de Serviços BPO" → gera o texto já com o nome, CNPJ e valor do cliente deste contrato.',
  'Escolher um modelo com campos que este contrato ainda não tem preenchidos (ex.: valor ou data de início vazios): esses campos saem em branco. A tela avisa quais ficaram pendentes antes de salvar.',
  1, '/dashboard/contratos')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
