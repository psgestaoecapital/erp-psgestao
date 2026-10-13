-- URGENTE: tela órfã bloqueando a Jordana. /dashboard/cadastros/produtos EXISTE (system_screens,
-- estado 'parcial') mas NÃO estava no module_catalog → não aparecia em CADASTROS no menu. O bloco de
-- ST retido do #1743 vive nessa ficha; sem a tela no menu a Jordana não chega nele.
--
-- Cataloga a tela espelhando "Serviços" (ge_cadastros_servicos): grupo gestao_empresarial, subgrupo
-- cadastros. ordem 26 (logo após Serviços=25). Sem função nova (fora do gate fn-guards). RD-52.

INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, rota, ordem, ativo, is_shared, legacy, rbac_isento, descricao)
VALUES
  ('ge_cadastros_produtos', 'Produtos', 'gestao_empresarial', 'cadastros',
   '/dashboard/cadastros/produtos', 26, true, true, false, false,
   'Cadastro de produtos · catálogo NF-e (NCM, CFOP, CST, ICMS/ST retido). Ficha fiscal do item.')
ON CONFLICT (id) DO UPDATE
  SET ativo=true, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo, rota=EXCLUDED.rota,
      ordem=EXCLUDED.ordem, nome=EXCLUDED.nome, descricao=EXCLUDED.descricao;
