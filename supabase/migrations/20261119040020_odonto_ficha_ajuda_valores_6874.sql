-- #6874 — Odonto · Ficha do paciente: os campos de dinheiro (R$) passaram a usar a máscara
-- padrão (CampoMoeda). RD-95: cada campo precisa do "?" com texto no banco (erp_ajuda_campo).
-- Aditiva e idempotente (ON CONFLICT), tabela de referência global, sem dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('odonto.plano.entrada', '/dashboard/odonto/pacientes', 'Aprovar plano', 'Entrada (R$)',
   'O valor da entrada que o paciente paga à vista ao aprovar o plano. Deixe em branco (ou R$ 0,00) se não houver entrada. Digite o valor em reais — o campo formata sozinho enquanto você digita (ex.: digitar 15000 vira R$ 150,00).',
   'A entrada sai do total do plano antes de dividir o restante nas parcelas. Com entrada, a 1ª cobrança no financeiro já nasce quitada e as parcelas seguintes repartem o que sobra.',
   'Plano de R$ 1.200,00 com entrada de R$ 200,00 em 5 parcelas → entrada R$ 200,00 + 5× R$ 200,00.',
   'Esquecer que o campo lê centavos: digitar 200 mostra R$ 2,00, não R$ 200,00. Confira o valor formatado antes de aprovar.',
   'odonto', 1, 1, 'publicado'),
  ('odonto.receber.valor', '/dashboard/odonto/pacientes', 'Receber título', 'Valor (R$)',
   'Quanto está sendo recebido agora deste título. Já vem preenchido com o valor em aberto; altere se o paciente pagar um valor diferente. O campo formata em reais enquanto você digita.',
   'É o valor da baixa no contas a receber. Recebimento menor que o total deixa o restante em aberto; igual ao total quita o título.',
   'Título de R$ 350,00 e o paciente paga tudo → Valor R$ 350,00. Pagou metade → R$ 175,00 (o resto fica em aberto).',
   'Digitar o valor sem conferir a máscara (lê centavos) ou trocar a conta financeira: o recebimento entra na conta escolhida no campo Conta.',
   'odonto', 2, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
