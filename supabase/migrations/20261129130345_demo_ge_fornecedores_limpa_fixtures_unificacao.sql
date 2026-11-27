-- SÓ-DEMO · Limpa a lista de fornecedores da empresa DEMO "Gestão Empresarial"
-- (b0700000-0000-4000-a000-000000000004) das FIXTURES de teste da unificação de documento,
-- que poluem /dashboard/cadastros/fornecedores e aparecem a um prospect (critério e / RD-98).
-- Irmã da limpeza de clientes (PR das fixtures de clientes da mesma DEMO) — mesmo padrão e prova.
--
-- RD-38 (prova no dado, 27/11): na ...004, fornecedores ativos e visíveis = 21, dos quais 3 são
-- fixtures com assinatura inequívoca "<11 dígitos de doc>-<hash>" no fim do nome
-- ("Fornecedor 43 40354425113-mvphiray", "...43666757649-mwh7vglu", "...45135627905-mwt16yea").
-- Os 18 legítimos ("Fornecedor Demo N", "Atacado Beta Ltda", "Distribuidora Alfa Ltda",
-- "Suprimentos Gama Ltda", etc.) NÃO casam o padrão — 0 falsos-positivos provados.
--
-- Natureza: SÓ-DEMO, ADITIVA, IDEMPOTENTE e REVERSÍVEL. A tela lista por ativo=true; marcamos as
-- fixtures como ativo=false (mesmo efeito do botão "Inativar", RD-98 p4 — reaparecem em
-- "Ver só inativos"). Guarda dupla (id fixo da DEMO + companies.is_demo=true). Sem DELETE físico;
-- nenhum dado de fornecedor real tocado; nenhuma estrutura alterada.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000004';
  v_is_demo boolean; v_antes int; v_depois int;
BEGIN
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = v_company;
  IF v_is_demo IS NOT TRUE THEN
    RAISE NOTICE 'empresa % inexistente ou não-DEMO: limpeza ignorada', v_company;
    RETURN;
  END IF;

  SELECT count(*) INTO v_antes FROM erp_fornecedores
  WHERE company_id = v_company AND ativo = true
    AND nome_fantasia ~ '[0-9]{11}-[A-Za-z0-9]{6,10}$';

  UPDATE erp_fornecedores SET ativo = false
  WHERE company_id = v_company AND ativo = true
    AND nome_fantasia ~ '[0-9]{11}-[A-Za-z0-9]{6,10}$';

  SELECT count(*) INTO v_depois FROM erp_fornecedores
  WHERE company_id = v_company AND ativo = true
    AND nome_fantasia ~ '[0-9]{11}-[A-Za-z0-9]{6,10}$';

  RAISE NOTICE 'DEMO GE fornecedores: fixtures de unificação inativadas — antes=% depois=%', v_antes, v_depois;
END $$;
