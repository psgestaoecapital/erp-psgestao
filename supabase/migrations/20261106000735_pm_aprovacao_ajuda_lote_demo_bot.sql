-- PDCA P&M · /dashboard/pm/aprovacao (Code: code-desenvolvedor-3)
-- Aditiva e idempotente. Dois efeitos, ambos re-executáveis sem duplicar nem apagar dado de cliente real:
--   (1) RD-95: cadastra o "?" dos controles NOVOS da tela (seleção em lote e ação em lote). Chave já existente
--       permanece intacta (ON CONFLICT DO NOTHING; erp_ajuda_campo.chave é UNIQUE).
--   (2) RD-98 p1 (gap do auditor): tira da fila do DEMO os jobs de teste "[BOT] ..." que poluem a Aprovação,
--       por EXCLUSÃO RASTREÁVEL (excluido_em), nunca DELETE físico. Escopo travado: só a empresa DEMO
--       (b0700000-0000-4000-a000-000000000002) e só títulos que começam com "[BOT]". Jobs reais de clientes
--       (qualquer outra empresa ou título) NÃO são tocados. WHERE excluido_em IS NULL = idempotente.

-- (1) Ajuda dos controles de lote (RD-95) -------------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('pm.aprovacao.selecionar', '/dashboard/pm/aprovacao', 'Aprovação · Seleção', 'Selecionar',
   'Marque a caixa dos jobs que o cliente aprovou (ou reprovou) de uma vez só. "Selecionar todos os visíveis" marca os que estão na tela, respeitando a busca e a paginação.',
   'Decidir vários jobs de uma vez, sem clicar job a job — útil quando o cliente dá o OK de um lote inteiro.',
   'Cliente aprovou os 6 jobs da campanha → marque os 6 → "Aprovar selecionados".',
   'Confiar que "selecionar todos" marcou a fila inteira: ele marca só os jobs VISÍVEIS; use "Mostrar mais" ou a busca para alcançar o resto.',
   'pm', 4, 'publicado'),
  ('pm.aprovacao.acao_lote', '/dashboard/pm/aprovacao', 'Aprovação · Ações', 'Aprovar / Reprovar em lote',
   'Com jobs selecionados, "Aprovar selecionados" publica todos os marcados; "Reprovar selecionados" devolve todos pra produção. Pede confirmação com a quantidade antes de aplicar.',
   'Agiliza a fila quando a decisão do cliente vale para vários jobs ao mesmo tempo, mantendo a mesma regra de status de um a um.',
   '5 jobs selecionados → "Aprovar selecionados" → confirma "Aprovar 5 job(s)?" → os 5 saem da fila como publicados.',
   'Aprovar em lote sem o retorno do cliente para cada job: publicar não tem desfazer de um clique.',
   'pm', 5, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- (2) Limpeza do DEMO — jobs de teste "[BOT]" fora da fila de aprovação (exclusão rastreável) -----------------
UPDATE public.agency_jobs
   SET excluido_em = now()
 WHERE company_id = 'b0700000-0000-4000-a000-000000000002'
   AND status = 'em_aprovacao'
   AND titulo ILIKE '[BOT]%'
   AND excluido_em IS NULL;
