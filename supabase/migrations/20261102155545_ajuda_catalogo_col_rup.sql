-- PDCA Hub · /dashboard/projetos/catalogo · aud8 55/95 · gap 4 (MENOR · UX)
-- Code: desenvolvedor_4_g
--
-- Exibe o RUP (coeficiente de produtividade = produtividade_unidade_dia) na listagem
-- do catálogo de serviços, numa coluna própria. Esta migration cria o "?" (RD-95) da
-- nova coluna no banco (fonte do AjudaCampo).
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. Não toca dado de
-- cliente, RLS, grants nem schema.

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES (
  'projetos.catalogo.col_rup',
  '/dashboard/projetos/catalogo',
  'Catálogo',
  'Produtividade (RUP)',
  'Coluna de leitura — mostra o RUP (coeficiente de produtividade) do serviço: quanto a equipe produz por dia na unidade do serviço. Define-se ao montar o serviço (edição), não na listagem.',
  'O RUP é a base do prazo e do custo de mão de obra: a partir dele o sistema estima quantos dias e quantas horas a execução leva. Sem RUP, o serviço entra no orçamento sem previsão de prazo/mão de obra.',
  'Um serviço de "Parede de drywall" com RUP 12 m²/dia: uma equipe executa cerca de 12 m² por dia; 120 m² levam ~10 dias.',
  'Confundir RUP com o custo. O RUP é a velocidade de produção (quantidade por dia), não o preço. Serviço marcado "Sem RUP" precisa ter a produtividade preenchida na edição.',
  'hub_projetos',
  25
)
ON CONFLICT (chave) DO NOTHING;
