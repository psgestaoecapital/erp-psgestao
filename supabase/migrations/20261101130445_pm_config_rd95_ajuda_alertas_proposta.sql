-- RD-95 (CEO 08/10): "?" nos campos das abas Alertas e Proposta das Configurações do P&M · /dashboard/pm/configuracoes.
-- O auditor PDCA pediu fechar RD-95. Esta PR cobre as 2 abas de formulário estático (Alertas: régua do
-- semáforo; Proposta: regras). As abas Funil/Listas (campos por linha) ficam para PR seguinte.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/configuracoes', 'pm', 'publicado'
FROM (VALUES
 ('pm.config.alertas_ambar', 'Configurações · Alertas', 'Dias para âmbar',
  'Número de dias que um lead pode ficar parado numa etapa do funil antes de virar âmbar (atenção).',
  'Define quando o kanban de leads acende o alerta amarelo, para a equipe retomar o contato a tempo.',
  'Com 7, um lead parado há 7 dias numa etapa fica âmbar.',
  'Pôr um valor maior que o "Dias para vermelho": o sistema recusa, o vermelho tem de ser maior ou igual ao âmbar.',
  1),
 ('pm.config.alertas_vermelho', 'Configurações · Alertas', 'Dias para vermelho',
  'Número de dias parado numa etapa para o lead virar vermelho (atrasado). Deve ser maior ou igual ao âmbar.',
  'Define quando o lead é marcado como atrasado no kanban, sinalizando risco de perder a oportunidade.',
  'Com 10, um lead parado há 10 dias fica vermelho.',
  'Deixar igual ao âmbar sem querer: o lead pularia o estágio de atenção; use um valor maior para ter os dois avisos.',
  2),
 ('pm.config.proposta_exigir_catalogo', 'Configurações · Proposta', 'Exigir item do catálogo',
  'Marque para obrigar que todo item da proposta venha do catálogo de serviços (bloqueia itens avulsos digitados na hora).',
  'Padroniza as propostas e garante preço/descrição consistentes com o catálogo da empresa.',
  'Marcar quando a agência quer que ninguém invente item fora da tabela.',
  'Marcar sem ter catálogo montado: o vendedor fica sem itens para escolher e não consegue fechar a proposta.',
  3),
 ('pm.config.proposta_condicao', 'Configurações · Proposta', 'Condição de pagamento padrão',
  'Texto da condição de pagamento que já vem preenchida em cada nova proposta (pode ser editada na proposta).',
  'Poupa digitação e padroniza a condição comercial mais usada pela agência.',
  'Ex.: "Mensal" ou "30/60/90 dias".',
  'Escrever um valor fixo que nem sempre vale: é só o padrão inicial; confira em cada proposta.',
  4),
 ('pm.config.proposta_desconto_max', 'Configurações · Proposta', 'Desconto máximo (%)',
  'Percentual máximo de desconto permitido nas propostas. Deixe vazio para não impor limite.',
  'Protege a margem impedindo descontos acima do teto definido pela empresa.',
  '10 limita o desconto de qualquer proposta a 10%.',
  'Confundir vazio com zero: vazio é "sem limite"; 0 proíbe qualquer desconto.',
  5)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
