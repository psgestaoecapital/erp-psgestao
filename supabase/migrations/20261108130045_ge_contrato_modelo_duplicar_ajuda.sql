-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — item1: ação "Duplicar" na aba de Modelos
-- (/dashboard/contratos → ContratosModelosPanel). A aba já tinha criar/editar/inativar/reativar + versões;
-- faltava "duplicar" (requisito explícito do chamado) e "?" (RD-95) para a nova ação. Duplicar reaproveita
-- a RPC fn_contrato_modelo_salvar já publicada (abre "Novo modelo" pré-preenchido com o texto do modelo
-- escolhido), sem RPC nova — só a chave de ajuda falta no banco.
--
-- ADITIVA (RD-94.1-c): só 1 texto de ajuda novo; NÃO altera tabela/função nem dado de cliente.
-- Idempotente (ON CONFLICT DO NOTHING). Versão acima da main, faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/contratos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.contrato.modelo.duplicar', 'Modelos de contrato', 'Duplicar modelo',
  'Nada a preencher: clique para criar um modelo novo já com o texto e a descrição deste, pronto para ajustar.',
  'Poupa retrabalho — você parte de um modelo parecido em vez de escrever tudo de novo; o original não muda.',
  'Duplicar "Fee mensal — marketing" para criar "Fee mensal — contabilidade" trocando só alguns trechos.',
  'Achar que editou o original: duplicar gera um modelo NOVO (nome com "(cópia)"); salve para confirmar.', 6)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
