-- RD-95 · ajuda "?" dos campos de % de reajuste da tela Contratos (/dashboard/contratos).
-- Acompanha a correcao de decimal (#5620 sweep virgula): os inputs de % de reajuste passaram a aceitar
-- virgula e ganharam o "?" do componente padrao AjudaCampo. As 3 chaves abaixo sao as desses campos:
--   * ge.contrato.novo.reajuste_pct   -> form "Novo contrato", campo "% Reajuste" (visivel so em Fixo/Customizado)
--   * ge.contrato.editar.reajuste_pct -> modal "Editar contrato", campo "Reajuste (%)"
--   * ge.contrato.reajuste.percentual -> modal "Reajustar", campo "Percentual de Reajuste (%)"
--
-- ADITIVA e idempotente (RD-94.1): so INSERT em tabela de referencia global (erp_ajuda_campo), com
-- ON CONFLICT (chave) DO NOTHING. Nao altera dado de cliente, nao reescreve funcao/view, nao mexe em RLS.
-- A tabela ja tem RLS/guarda proprias; nenhuma policy ou grant e tocado aqui.
--
-- Prova no dado (RD-38, conferido em producao antes desta migration):
--   * erp_ajuda_campo.chave e UNIQUE (erp_ajuda_campo_chave_key); as 3 chaves NAO existem ainda
--     (SELECT count(*) WHERE chave IN (...) = 0) -> os INSERTs criam; reexecucao nao duplica.
--   * colunas NOT NULL: chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum -> todas preenchidas.
--   * padrao de rota/grupo/vertical copiado da chave irma ge.contrato.novo.valor_mensal (rota /dashboard/contratos,
--     grupo 'Contratos', vertical 'gestao_empresarial').

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.contrato.novo.reajuste_pct', '/dashboard/contratos', 'Contratos', '% de reajuste',
   'O percentual anual de reajuste do contrato. Digite com virgula para as casas decimais (o ponto tambem e aceito como separador).',
   'Quando o tipo de reajuste e Fixo ou Customizado, este percentual e aplicado sobre o valor mensal no aniversario do contrato.',
   '7,5',
   'Digitar o percentual como valor cheio. Para sete e meio por cento digite 7,5 (nao 0,075 nem 750).',
   'gestao_empresarial', 5),
  ('ge.contrato.editar.reajuste_pct', '/dashboard/contratos', 'Contratos', 'Reajuste (%)',
   'O percentual de reajuste gravado no contrato. Digite com virgula para as casas decimais (o ponto tambem e aceito).',
   'E o percentual que a opcao Reajustar sugere e que aplica sobre o valor mensal quando o reajuste for Fixo/Customizado.',
   '5,25',
   'Usar ponto no lugar da virgula achando que o campo nao aceita decimal: 5,25 e aceito normalmente.',
   'gestao_empresarial', 6),
  ('ge.contrato.reajuste.percentual', '/dashboard/contratos', 'Contratos', 'Percentual de Reajuste (%)',
   'O percentual que sera aplicado AGORA neste reajuste. Digite com virgula para os decimais; use os botoes (+3%, +5%...) para preencher rapido.',
   'Define o quanto o valor mensal sobe neste reajuste; a previa do novo valor e calculada com este percentual.',
   '4,5',
   'Deixar em zero (o botao Aplicar fica desabilitado) ou digitar o novo valor em reais em vez do percentual.',
   'gestao_empresarial', 7)
ON CONFLICT (chave) DO NOTHING;
