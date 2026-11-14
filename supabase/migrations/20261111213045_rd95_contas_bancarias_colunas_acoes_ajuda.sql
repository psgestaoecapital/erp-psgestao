-- Gestão Empresarial · Cadastros › Contas Bancárias (/dashboard/cadastros/contas-bancarias)
-- Jornada auditada (PDCA, DEMO GE, nota 85/95): dados reais (2 contas DEMO-GE, saldo consolidado
-- R$ 15.500), CRUD Nova/Editar/Reativar presentes. Gap principal = RD-95: 0 "?" na tela.
-- Este PR cobre o "?" (AjudaCampo) na AÇÃO Nova conta, no INDICADOR Saldo consolidado e na LEGENDA de
-- dados/colunas/ações da lista (Dados da conta banco/agência/conta, Saldo inicial, Integração bancária,
-- Editar, Inativar/Reativar) — 7 chaves novas aqui.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo + metadados da própria tela; NÃO altera tabela/função nem
-- dado de cliente. Idempotente (ON CONFLICT DO NOTHING). Versão acima da main, faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/contas-bancarias', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.contas_bancarias.nova', 'Ações', 'Nova conta',
  'Abre o formulário para cadastrar uma conta nova: nome, tipo (corrente, poupança, caixinha, cartão…), banco/agência/conta e saldo inicial.',
  'Cria a conta que passa a aparecer no dashboard, no fluxo de caixa e na conciliação.',
  'Cadastre "Itaú · Conta Corrente" com o saldo do extrato de hoje.',
  'Cadastrar sem saldo inicial correto: o saldo consolidado nasce errado se o valor inicial não bate com o extrato.', 1),
 ('ge.contas_bancarias.saldo_consolidado', 'Indicadores', 'Saldo consolidado',
  'Nada a preencher: é a soma do saldo das contas marcadas com "Soma no saldo".',
  'Mostra, num número só, quanto a empresa tem somando as contas que você escolheu consolidar.',
  'Duas contas que somam R$ 10.000 e R$ 5.500 → saldo consolidado R$ 15.500. O rodapé mostra "X de Y contas".',
  'Estranhar um valor menor que a soma de tudo: contas marcadas "Não soma" (caixinha, cartão) ficam de fora de propósito.', 2),
 ('ge.contas_bancarias.dados_conta', 'Colunas', 'Dados da conta (banco · agência · conta)',
  'Nada a preencher aqui: é a identificação bancária que você informou no cadastro (banco, agência e número da conta).',
  'Ajuda a distinguir contas parecidas e a conferir se os dados batem com a integração/boleto.',
  '"Conta Corrente · Itaú · Ag. 1234 · CC 56789-0".',
  'Confundir contas do mesmo banco sem olhar agência/conta: o nome ajuda, mas os dados bancários é que identificam.', 3),
 ('ge.contas_bancarias.col_saldo_inicial', 'Colunas', 'Saldo inicial',
  'Nada a preencher aqui: é o saldo que você informou na data inicial da conta. Edite na própria conta.',
  'É o ponto de partida do saldo — o fluxo de caixa soma as movimentações a partir dele.',
  'Se a conta começou a ser usada com R$ 2.000, esse é o saldo inicial.',
  'Alterar o saldo inicial para "acertar" o saldo de hoje: o certo é lançar/conciliar as movimentações, não mexer no inicial.', 4),
 ('ge.contas_bancarias.integracao', 'Ações da linha', 'Integração bancária',
  'Nada a preencher: abre o painel para configurar a integração da conta (credenciais, boleto, importação de extrato).',
  'Permite trazer o extrato e emitir boletos sem digitar tudo à mão.',
  'Configure a integração do banco para importar o extrato e conciliar automático.',
  'Deixar a conta sem integração e estranhar que o extrato não aparece sozinho: sem configurar, a importação é manual.', 5),
 ('ge.contas_bancarias.editar', 'Ações da linha', 'Editar',
  'Nada a preencher: abre a conta para alterar nome, tipo, dados bancários, cor e as marcações (soma no saldo, incluir no resumo/fluxo/orçamento).',
  'Permite corrigir os dados e controlar onde a conta entra nos totais, sem criar outra.',
  'Marque "Não soma" numa caixinha que você não quer no saldo consolidado.',
  'Desmarcar "incluir no fluxo" sem querer: a conta some do fluxo de caixa e o total parece errado.', 6),
 ('ge.contas_bancarias.inativar', 'Ações da linha', 'Inativar / Reativar',
  'Nada a preencher: "Inativar" esconde a conta (soft-delete, o histórico fica); reative depois nas configurações.',
  'Tira do caminho contas encerradas sem perder os lançamentos e conciliações já feitos nelas.',
  'Inative uma conta que você fechou no banco; o histórico dela continua nos relatórios.',
  'Inativar uma conta com conciliações pendentes: resolva as pendências antes para não deixar movimentação solta.', 7)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: a tela passa a chamar as RPCs de ajuda; registra sem perder as origens já declaradas.
UPDATE public.system_screens s
   SET rpcs_chamadas = (
     SELECT ARRAY(SELECT DISTINCT e FROM unnest(
       COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
     ) AS e ORDER BY e)
   )
 WHERE s.rota = '/dashboard/cadastros/contas-bancarias';
