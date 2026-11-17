-- GE · /dashboard/contratos — chamado #8384: contrato perdido/encerrado/cancelado/excluído não tinha como ser
-- refeito. A tela de detalhe ganhou a ação "🔁 Refazer este contrato" (abre o formulário de inclusão já preenchido
-- com os dados do contrato, para criar uma cópia nova pelo mesmo fluxo). Esta migration só registra a chave de
-- ajuda RD-95 ("?") dessa ação.
-- ADITIVO e idempotente: só uma linha nova em erp_ajuda_campo (ON CONFLICT DO NOTHING). Nenhuma função/view/policy muda.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, vertical, ordem, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('ge.contrato.refazer', '/dashboard/contratos', 'Contratos', 'Refazer este contrato', 'gestao_empresarial', 29,
  'Clique para criar uma CÓPIA NOVA deste contrato. O formulário de inclusão abre já preenchido com cliente, tipo, valor, periodicidade, reajuste e forma de pagamento; a data de início vem como hoje.',
  'Permite refazer um contrato que foi encerrado, cancelado ou excluído (ex.: um contrato perdido) sem redigitar tudo. O contrato antigo NÃO é alterado — você cria um novo e revisa os dados antes de salvar.',
  'Contrato "BPO Financeiro Mensal" foi cancelado por engano; abra o detalhe, clique em "Refazer este contrato", confira os dados e clique em "Incluir contrato".',
  'Esperar que "Refazer" reative o contrato antigo: ele cria um contrato NOVO. Confira cliente e valor antes de salvar e ajuste a data de início se precisar.')
ON CONFLICT (chave) DO NOTHING;
