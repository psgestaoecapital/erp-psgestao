-- RD-95: "?" da ação "Não se aplica" na lista de documentos do funcionário
-- (/dashboard/compliance/funcionarios/[id] · aba Documentos). Nasce do chamado #4037 (Frioeste):
-- cada colaborador de uma empresa terceira tem necessidades diferentes (o auxiliar mecânico não faz
-- NR10; o eletricista faz), então precisa de um botão ao lado de cada item para marcar como não
-- aplicável só para aquela pessoa. A ação reusa a RPC já provada fn_compliance_pessoa_dispensar.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela/RLS/dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Documentos do funcionário', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/compliance/funcionarios/[id]', 'compliance', 'publicado'
FROM (VALUES
 ('compliance.funcionario.doc_nao_se_aplica', 'Não se aplica',
  'Clique em "Não se aplica" ao lado do documento/treinamento que esta pessoa não precisa ter.',
  'Tira da lista da pessoa um documento que vem do cargo/setor mas não cabe a ela — cada colaborador da mesma empresa terceira pode ter exigências diferentes.',
  'O auxiliar mecânico não faz NR10: marque NR10 como "não se aplica" só para ele; o eletricista da mesma empresa continua com a NR10 exigida.',
  'Não se aplica não apaga nem some para sempre: dá para voltar a exigir no painel "Quais documentos esta pessoa precisa". Use com cuidado em item OBRIGATÓRIO.',
  1)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
