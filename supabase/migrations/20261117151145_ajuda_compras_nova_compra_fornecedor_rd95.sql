-- Commerce · Nova compra (/dashboard/commerce/compras, modal "Nova compra") — RD-95: "?" do campo Fornecedor
-- ============================================================================
-- GAP (PDCA · varredura RD-95 GE-UI): a busca de Fornecedor do modal "Nova compra" não tinha o "?".
-- CORREÇÃO (aditiva, idempotente): uma chave em erp_ajuda_campo; o front (page.tsx) passa o `ajuda`
--   ao card Fornecedor (cobre o input de busca, que é descendente do card).
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- RD-100: linguagem do usuário, sem nome de sistema de terceiros.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.fornecedor', '/dashboard/commerce/compras', 'Nova compra', 'Fornecedor',
   'De quem você está comprando. Comece a digitar o nome (mín. 2 letras) e escolha na lista o fornecedor já cadastrado.',
   'Vincula a compra ao fornecedor, para gerar o financeiro (contas a pagar) e conferir o recebimento no nome certo.',
   'Comercial Alfa Ltda', 'Precisa escolher um da lista — só digitar o nome sem selecionar não vincula ao cadastro; se não existe, cadastre o fornecedor antes.', 'gestao_empresarial', 100)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
