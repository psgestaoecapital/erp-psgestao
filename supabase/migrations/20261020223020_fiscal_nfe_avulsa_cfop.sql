-- #3861 (piloto FCR, vale para todas as empresas) · NF-e avulsa com escolha de CFOP · etapa 1.
-- Catálogo GLOBAL de CFOP de saída (Ajuste SINIEF/Convênio s/nº de 1970, grupos de saída mais usados no comércio):
-- 5.xxx (dentro do estado), 7.xxx (exterior) e os 6.xxx que não têm espelho 5.xxx. O 6.xxx dos demais é o espelho do
-- 5.xxx (a tela e a rota trocam 5↔6 pela UF do destinatário, com aviso — src/lib/fiscal/nfeAvulsa.ts).
-- ADITIVA: tabela nova, sem coluna de dono e sem dado pessoal (referência pública, como a tabela oficial), RLS ligada
-- só com leitura para usuário logado; escrita só pela migration. Nenhuma função, view ou policy existente muda.
-- Os efeitos por CFOP (estoque e financeiro) e os favoritos por empresa ficam para a etapa 2.

CREATE TABLE IF NOT EXISTS public.erp_fiscal_cfop_saida (
  cfop text PRIMARY KEY CHECK (cfop ~ '^[567][0-9]{3}$'),
  descricao text NOT NULL,
  natureza_sugerida text NOT NULL,
  exige_referenciada boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true
);

ALTER TABLE public.erp_fiscal_cfop_saida ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_fiscal_cfop_saida FROM anon, public;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_fiscal_cfop_saida FROM authenticated;
GRANT SELECT ON public.erp_fiscal_cfop_saida TO authenticated;
GRANT ALL ON public.erp_fiscal_cfop_saida TO service_role;

DROP POLICY IF EXISTS cfop_saida_leitura ON public.erp_fiscal_cfop_saida;
CREATE POLICY cfop_saida_leitura ON public.erp_fiscal_cfop_saida
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.erp_fiscal_cfop_saida (cfop, descricao, natureza_sugerida, exige_referenciada)
VALUES
 ('5101', 'Venda de produção do estabelecimento', 'Venda de produção do estabelecimento', false),
 ('5102', 'Venda de mercadoria adquirida ou recebida de terceiros', 'Venda de mercadoria', false),
 ('5116', 'Venda de produção do estabelecimento originada de encomenda para entrega futura', 'Venda para entrega futura', false),
 ('5117', 'Venda de mercadoria adquirida ou recebida de terceiros, originada de encomenda para entrega futura', 'Venda para entrega futura', false),
 ('5151', 'Transferência de produção do estabelecimento', 'Transferência', false),
 ('5152', 'Transferência de mercadoria adquirida ou recebida de terceiros', 'Transferência', false),
 ('5201', 'Devolução de compra para industrialização ou produção rural', 'Devolução de compra', true),
 ('5202', 'Devolução de compra para comercialização', 'Devolução de compra', true),
 ('5405', 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído', 'Venda de mercadoria', false),
 ('5409', 'Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'Transferência', false),
 ('5411', 'Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'Devolução de compra', true),
 ('5551', 'Venda de bem do ativo imobilizado', 'Venda de ativo imobilizado', false),
 ('5552', 'Transferência de bem do ativo imobilizado', 'Transferência de ativo imobilizado', false),
 ('5553', 'Devolução de compra de bem para o ativo imobilizado', 'Devolução de compra', true),
 ('5556', 'Devolução de compra de material de uso ou consumo', 'Devolução de compra', true),
 ('5557', 'Transferência de material de uso ou consumo', 'Transferência de material de uso ou consumo', false),
 ('5901', 'Remessa para industrialização por encomenda', 'Remessa para industrialização', false),
 ('5902', 'Retorno de mercadoria utilizada na industrialização por encomenda', 'Retorno de industrialização', true),
 ('5903', 'Retorno de mercadoria recebida para industrialização e não aplicada no referido processo', 'Retorno de industrialização', true),
 ('5904', 'Remessa para venda fora do estabelecimento', 'Remessa para venda fora do estabelecimento', false),
 ('5905', 'Remessa para depósito fechado ou armazém geral', 'Remessa para depósito', false),
 ('5906', 'Retorno de mercadoria depositada em depósito fechado ou armazém geral', 'Retorno de depósito', true),
 ('5907', 'Retorno simbólico de mercadoria depositada em depósito fechado ou armazém geral', 'Retorno simbólico de depósito', true),
 ('5908', 'Remessa de bem por conta de contrato de comodato', 'Remessa em comodato', false),
 ('5909', 'Retorno de bem recebido por conta de contrato de comodato', 'Retorno de comodato', true),
 ('5910', 'Remessa em bonificação, doação ou brinde', 'Remessa em bonificação, doação ou brinde', false),
 ('5911', 'Remessa de amostra grátis', 'Remessa de amostra grátis', false),
 ('5912', 'Remessa de mercadoria ou bem para demonstração', 'Remessa para demonstração', false),
 ('5913', 'Retorno de mercadoria ou bem recebido para demonstração', 'Retorno de demonstração', true),
 ('5914', 'Remessa de mercadoria ou bem para exposição ou feira', 'Remessa para exposição ou feira', false),
 ('5915', 'Remessa de mercadoria ou bem para conserto ou reparo', 'Remessa para conserto', false),
 ('5916', 'Retorno de mercadoria ou bem recebido para conserto ou reparo', 'Retorno de conserto', true),
 ('5917', 'Remessa de mercadoria em consignação mercantil ou industrial', 'Remessa em consignação', false),
 ('5918', 'Devolução de mercadoria recebida em consignação mercantil ou industrial', 'Devolução de consignação', true),
 ('5920', 'Remessa de vasilhame ou sacaria', 'Remessa de vasilhame ou sacaria', false),
 ('5921', 'Devolução de vasilhame ou sacaria', 'Devolução de vasilhame ou sacaria', true),
 ('5922', 'Lançamento efetuado a título de simples faturamento decorrente de venda para entrega futura', 'Simples faturamento', false),
 ('5923', 'Remessa de mercadoria por conta e ordem de terceiros, em venda à ordem', 'Remessa por conta e ordem de terceiros', false),
 ('5924', 'Remessa para industrialização por conta e ordem do adquirente da mercadoria, quando esta não transitar pelo estabelecimento do adquirente', 'Remessa para industrialização por conta e ordem', false),
 ('5927', 'Lançamento efetuado a título de baixa de estoque decorrente de perda, roubo ou deterioração', 'Baixa de estoque por perda, roubo ou deterioração', false),
 ('5949', 'Outra saída de mercadoria ou prestação de serviço não especificado', 'Outras saídas', false),
 ('6107', 'Venda de produção do estabelecimento, destinada a não contribuinte', 'Venda de produção do estabelecimento', false),
 ('6108', 'Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte', 'Venda de mercadoria', false),
 ('7101', 'Venda de produção do estabelecimento (exportação)', 'Venda de produção para o exterior', false),
 ('7102', 'Venda de mercadoria adquirida ou recebida de terceiros (exportação)', 'Venda de mercadoria para o exterior', false),
 ('7949', 'Outra saída de mercadoria ou prestação de serviço não especificado (exterior)', 'Outras saídas para o exterior', false)
ON CONFLICT (cfop) DO UPDATE SET descricao = EXCLUDED.descricao, natureza_sugerida = EXCLUDED.natureza_sugerida,
  exige_referenciada = EXCLUDED.exige_referenciada;

-- "?" (RD-95) da NF-e avulsa e do botão na lista de notas
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'NF-e avulsa', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.nfe.emitir_avulsa', '/dashboard/fiscal/nfe', 'Emitir NF-e',
  'Toque para abrir a NF-e avulsa: a nota que não nasce de um pedido ou de um título (remessa para conserto, comodato, demonstração, bonificação, transferência e outras operações).',
  'Você escolhe o CFOP da operação numa lista. A nota avulsa não gera título no financeiro nem movimenta o estoque nesta etapa.',
  'Remessa de uma betoneira para conserto (CFOP 5.915).', 'Usar a NF-e avulsa para uma venda que já tem pedido: fature pelo pedido, que gera o título.', 1),
 ('fiscal.nfe_avulsa.atalho', '/dashboard/fiscal/nfe/remessa', 'Atalho de remessa',
  'Escolha um dos atalhos prontos (conserto, retorno de conserto, comodato, demonstração, garantia). Ele preenche o CFOP e a natureza.',
  'Atalho só adianta o preenchimento: o CFOP e a natureza continuam editáveis abaixo.',
  'Comodato → CFOP 5.908.', 'Escolher o atalho e não conferir se o CFOP é o que a contabilidade orientou.', 1),
 ('fiscal.nfe_avulsa.cfop', '/dashboard/fiscal/nfe/remessa', 'CFOP da nota',
  'Digite o código ou parte da descrição e escolha na lista (tabela de CFOP de saída). Pode digitar um código fora da lista, que fica com aviso.',
  'É o código fiscal da operação na NF-e. 5.xxx é dentro do estado, 6.xxx para outra UF (o ERP troca sozinho pela UF do destinatário e avisa), 7.xxx para o exterior.',
  '5.949 · Outra saída não especificada.', 'Usar 5.xxx para cliente de outro estado (a SEFAZ rejeita) ou CFOP de venda para uma remessa.', 2),
 ('fiscal.nfe_avulsa.natureza', '/dashboard/fiscal/nfe/remessa', 'Natureza da operação',
  'O texto que sai no campo "Natureza da operação" da DANFE. Vem sugerido pelo CFOP; ajuste se a contabilidade pedir outro texto.',
  'Identifica a operação para quem recebe a nota e para o fisco.', 'Remessa para conserto.', 'Deixar "Venda" numa remessa.', 3),
 ('fiscal.nfe_avulsa.finalidade', '/dashboard/fiscal/nfe/remessa', 'Finalidade',
  'Normal na maioria das notas. Complementar, ajuste ou devolução só quando a nota corrige ou devolve outra NF-e.',
  'Complementar, ajuste e devolução exigem a chave da NF-e referenciada.', 'Normal.', 'Marcar "Devolução" numa remessa para conserto: é finalidade normal com CFOP de remessa.', 4),
 ('fiscal.nfe_avulsa.chave_ref', '/dashboard/fiscal/nfe/remessa', 'Chave da NF-e referenciada',
  'Os 44 números da chave da nota de origem (está na DANFE ou no XML).',
  'Liga esta nota à nota original. Obrigatória para complementar, ajuste e devolução; recomendada no retorno (conserto, comodato, demonstração).',
  '4226 1012 3456 7800 0199 5500 1000 0012 3410 0000 1234', 'Copiar a chave com espaço faltando número: precisa ter 44 dígitos.', 5),
 ('fiscal.nfe_avulsa.icms', '/dashboard/fiscal/nfe/remessa', 'ICMS da operação',
  'Empresa do Simples: CSOSN 400 (não tributada) ou 900 (outros). Regime normal: CST 41, 50 ou 90. "Do cadastro do produto" usa a tributação de venda do produto.',
  'Remessa não é venda: o código do cadastro do produto é o de venda. No Simples, a remessa (CFOP x.9xx) exige escolher o CSOSN aqui.',
  'Remessa para conserto no Simples → 400 ou 900, conforme a contabilidade.', 'Deixar o CSOSN de venda (101/102) numa remessa.', 6),
 ('fiscal.nfe_avulsa.destinatario_tipo', '/dashboard/fiscal/nfe/remessa', 'Tipo de destinatário',
  'Cliente ou fornecedor: a lista ao lado mostra só o tipo escolhido.', 'O endereço (UF) do cadastro define o CFOP 5, 6 ou 7.', 'Fornecedor (retorno de conserto).', 'Procurar um fornecedor com o tipo "Cliente".', 7),
 ('fiscal.nfe_avulsa.destinatario', '/dashboard/fiscal/nfe/remessa', 'Destinatário',
  'Quem recebe a mercadoria. O cadastro precisa ter CNPJ/CPF e endereço completo com UF.', 'A UF decide se o CFOP é 5.xxx (mesmo estado), 6.xxx (outro estado) ou 7.xxx (exterior).',
  'Oficina parceira que vai consertar o equipamento.', 'Cadastro sem UF: a nota não sai até completar o endereço.', 8),
 ('fiscal.nfe_avulsa.produto_busca', '/dashboard/fiscal/nfe/remessa', 'Buscar produto',
  'Digite o nome ou código e toque no produto para incluir.', 'Os itens levam NCM, unidade e origem do cadastro do produto.', 'betoneira', 'Incluir produto sem NCM: a SEFAZ rejeita.', 9),
 ('fiscal.nfe_avulsa.item_quantidade', '/dashboard/fiscal/nfe/remessa', 'Quantidade',
  'Quantidade que sai nesta nota.', 'Multiplica o valor unitário no total do item.', '2', 'Quantidade zero.', 10),
 ('fiscal.nfe_avulsa.item_valor', '/dashboard/fiscal/nfe/remessa', 'Valor unitário',
  'Valor de cada unidade. Em remessa use o valor de custo ou de mercado, conforme a contabilidade.', 'Compõe o valor total da nota (mesmo sem cobrança).', '1500,00', 'Deixar zero: a SEFAZ exige valor.', 11),
 ('fiscal.nfe_avulsa.item_cfop', '/dashboard/fiscal/nfe/remessa', 'CFOP do item',
  'Deixe vazio para usar o CFOP da nota. Preencha só quando um item tem operação diferente dos outros.',
  'Cada item da NF-e tem seu CFOP; a mesma regra de UF (5/6/7) vale para ele.', '5.910 para um brinde junto da remessa.', 'Trocar o CFOP de um item sem necessidade.', 12),
 ('fiscal.nfe_avulsa.modalidade_frete', '/dashboard/fiscal/nfe/remessa', 'Frete',
  'Quem paga o transporte: sem frete, por conta do emitente (CIF), do destinatário (FOB) ou de terceiros.', 'Sai no quadro de transporte da DANFE.', 'Sem frete (o cliente retira).', 'Marcar CIF sem informar o valor quando o frete é cobrado na nota.', 13),
 ('fiscal.nfe_avulsa.valor_frete', '/dashboard/fiscal/nfe/remessa', 'Valor do frete',
  'Valor do frete cobrado na nota. Deixe zero quando não há cobrança.', 'Soma no total da NF-e.', '120,00', 'Informar frete com a modalidade "Sem frete".', 14),
 ('fiscal.nfe_avulsa.observacoes', '/dashboard/fiscal/nfe/remessa', 'Informações complementares',
  'Texto que sai em "Informações complementares" da DANFE (ex.: motivo da remessa, prazo de retorno, número da OS).',
  'No Simples, o ERP acrescenta sozinho a frase legal do Simples Nacional.', 'Remessa para conserto conforme OS 123, retorno previsto em 15 dias.', 'Colocar dado pessoal desnecessário.', 15),
 ('fiscal.nfe_avulsa.emitir', '/dashboard/fiscal/nfe/remessa', 'Emitir NF-e',
  'Confira CFOP, destinatário e itens e toque para enviar à SEFAZ.', 'A nota aparece em Notas emitidas com XML e PDF quando autorizada.',
  '—', 'Emitir em produção antes de testar a operação em homologação.', 16)
) AS v(chave, rota, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;

-- tela no inventário (a entrega conta quando o usuário a enxerga: menu Fiscal › "NFe avulsa" e botão em Notas emitidas)
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento, modulo)
VALUES ('dashboard.fiscal.nfe.remessa', '/dashboard/fiscal/nfe/remessa', 'fiscal', 'Emitir NF-e avulsa',
  'NF-e avulsa (#3861): remessas e outras operações com CFOP escolhido do catálogo de saída, troca 5/6/7 pela UF com aviso, finalidade e chave referenciada, ICMS da operação, CFOP por item, frete e informações complementares. Não gera título nem movimenta estoque (etapa 1).',
  'parcial', 'alta', 'fiscal')
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional;
