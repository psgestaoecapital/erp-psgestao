-- Hub · Calculadora de Obra (tela /calculadora) — "?" (RD-95) do selo de validação das fórmulas contra a referência.
-- SÓ ADITIVO (uma linha nova em erp_ajuda_campo). Faixa 52 (desenvolvedor_4_g).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'projetos.calculadora.validacao', 'Resultado', 'Validação da fórmula',
  'Calculado: indica se o cálculo usou as fórmulas de referência (travadas e conferidas no sistema) ou as regras próprias que a empresa editou no avançado.',
  'Mostra em que você pode confiar: "validada contra a referência" quer dizer que as contas batem com a referência técnica (NBR 15758/14715) conferida a cada versão; "regras próprias" quer dizer que a empresa mudou os coeficientes e precisa validar com o fabricante.',
  'Fórmula validada contra a referência (NBR 15758/14715 · 9 casos)',
  'Editar as regras no avançado e tratar o resultado como referência: as regras próprias são responsabilidade da empresa.',
  90, '/dashboard/projetos/calculadora', 'hub_construcao', 'publicado'
ON CONFLICT (chave) DO NOTHING;
