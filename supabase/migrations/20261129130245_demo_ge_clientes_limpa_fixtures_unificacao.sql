-- SÓ-DEMO · Limpa a lista de clientes da empresa DEMO "Gestão Empresarial"
-- (b0700000-0000-4000-a000-000000000004) das FIXTURES de teste da unificação de documento,
-- que poluem a tela /dashboard/cadastros/clientes e aparecem a um prospect (critério e / RD-98).
-- Tarefa PDCA (auditor_pdca · reauditado 26/11): "DEMO GE poluída com fixtures de teste da
-- unificação de documento" — nomes que NÃO são linguagem do cliente.
--
-- RD-38 (prova no dado, 27/11): na ...004, ativos e visíveis = 36 clientes, dos quais 16 são
-- fixtures com assinatura inequívoca "<11 dígitos de doc>-<hash>" no fim do nome (ex.:
-- "CLIENTE 263 36737711530-MUOAUTGB", "Unificar principal 42663245253-mw9jk83n",
-- "FC Novo 39059030043-mvcrya30"). Os 20 clientes DEMO legítimos
-- ("Comércio Demo N LTDA" e "Cliente Demo PF N") NÃO casam o padrão (0 falsos-positivos provados).
--
-- Natureza: SÓ-DEMO, ADITIVA e IDEMPOTENTE, REVERSÍVEL. A tela lista por ativo=true; marcamos as
-- fixtures como ativo=false (mesmo efeito do botão "Inativar" da UI, RD-98 p4 — reaparecem em
-- "Ver só inativos" e podem ser reativadas). NÃO há DELETE físico, nenhum dado de cliente real é
-- tocado (guarda dupla: id fixo da DEMO + companies.is_demo = true), nenhuma estrutura é alterada.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000004';
  v_is_demo boolean;
  v_antes int;
  v_depois int;
BEGIN
  -- Guarda: a empresa precisa existir e ser DEMO (is_demo = true). Fora disso, nada roda.
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = v_company;
  IF v_is_demo IS NOT TRUE THEN
    RAISE NOTICE 'empresa % inexistente ou não-DEMO (is_demo <> true): limpeza ignorada', v_company;
    RETURN;
  END IF;

  SELECT count(*) INTO v_antes
  FROM erp_clientes
  WHERE company_id = v_company AND ativo = true
    AND nome_fantasia ~ '[0-9]{11}-[A-Za-z0-9]{6,10}$';

  UPDATE erp_clientes
  SET ativo = false
  WHERE company_id = v_company AND ativo = true
    AND nome_fantasia ~ '[0-9]{11}-[A-Za-z0-9]{6,10}$';

  SELECT count(*) INTO v_depois
  FROM erp_clientes
  WHERE company_id = v_company AND ativo = true
    AND nome_fantasia ~ '[0-9]{11}-[A-Za-z0-9]{6,10}$';

  RAISE NOTICE 'DEMO GE clientes: fixtures de unificação inativadas — antes=% depois=%', v_antes, v_depois;
END $$;
