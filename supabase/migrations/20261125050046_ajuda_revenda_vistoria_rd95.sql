-- RD-95: ajuda "?" dos campos da tela Vistoria do veículo (/dashboard/revenda/veiculo/[id]/vistoria).
-- Aditiva e idempotente: insere só as 3 chaves novas (KM, Foto da região, Descrição do item) se ainda não existirem.
-- Não altera estrutura, RLS nem dado de cliente — erp_ajuda_campo é catálogo global de texto de ajuda.
-- Prova RD-38: SELECT ... WHERE rota = '/dashboard/revenda/veiculo/[id]/vistoria' = 0 linhas antes; 3 depois.
-- Code: rodrigo-code

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem
FROM (VALUES
  (
    'revenda.vistoria.km', '/dashboard/revenda/veiculo/[id]/vistoria', 'Vistoria do veículo', 'KM do veículo',
    'Informe a quilometragem que aparece no painel do veículo no momento da vistoria.',
    'Registra o KM de entrada; fica no histórico da vistoria e ajuda a avaliar o estado e a precificar o veículo.',
    '84500',
    'Digitar o KM com ponto ou vírgula (84.500) — informe só os números.',
    'revenda', 10
  ),
  (
    'revenda.vistoria.foto', '/dashboard/revenda/veiculo/[id]/vistoria', 'Vistoria do veículo', 'Foto da região',
    'Tire ou anexe a foto da região do veículo que está sendo vistoriada (use a câmera do celular).',
    'Comprova o estado da lataria/interior na entrada e evita discussão depois; região obrigatória só libera o avanço com a foto.',
    'Foto do para-choque dianteiro mostrando o risco.',
    'Pular a foto de uma região marcada como obrigatória — o botão de avançar fica bloqueado até anexar.',
    'revenda', 20
  ),
  (
    'revenda.vistoria.item_descricao', '/dashboard/revenda/veiculo/[id]/vistoria', 'Vistoria do veículo', 'O que precisa?',
    'Descreva em poucas palavras o reparo ou a troca necessária no item avaliado.',
    'Detalha o serviço previsto para o item; entra no orçamento de recondicionamento e no custo estimado do veículo.',
    'Reparo no tecido/couro do banco do motorista',
    'Deixar vago (só "arrumar") — descreva o que será feito para o custo sair certo.',
    'revenda', 30
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo a WHERE a.rota = v.rota AND a.chave = v.chave
);
