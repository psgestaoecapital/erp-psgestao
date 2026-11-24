-- SÓ-DEMO · tela 327 (/dashboard/projetos/mao-obra · /dashboard/projetos/obras/[id]/horas)
-- Torna o recurso "Colaborador" (ponto por pessoa, #5736) AUDITÁVEL na Construtora Modelo - DEMO (006):
-- hoje projetos_equipe_membro = 0 linhas (006 e global) -> o seletor Colaborador fica sempre vazio
-- e nenhum dos 88 apontamentos tem membro_id. Semeia 1 equipe + 4 membros reais e liga os
-- apontamentos existentes cuja função casa (por nome), para a coluna "Colaborador" aparecer preenchida.
--
-- RD-38 (provado no dado 24/11, read-only): 006 tem 6 obras, 88 apontamentos (todos membro_id NULL),
-- 7 cargos em projetos_mao_obra; apontamentos com função: Servente(4), Gesseiro(3), Pintor(1) -> 8 ligáveis.
-- Modelo de dados (FKs conferidas): projetos_equipe_membro.funcao_mao_obra_id -> projetos_mao_obra.id;
-- projetos_obra_mao_obra_apontamento.funcao_id -> erp_funcao_mao_obra.id. Como os cargos de projetos_mao_obra
-- da 006 têm funcao_id NULL, a ligação apontamento<->membro é feita por NOME (erp_funcao_mao_obra.nome
-- = projetos_mao_obra.funcao).
--
-- SÓ-DEMO: toda escrita guardada por company_id = '...006' e por companies.is_demo. Idempotente
-- (ids fixos + ON CONFLICT DO NOTHING; UPDATE só onde membro_id IS NULL). Não toca dado de cliente.

DO $$
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000006';
  v_equipe uuid := 'b0700006-e001-4001-8001-000000000001';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_demo AND COALESCE(is_demo,false)) THEN
    RAISE NOTICE 'empresa 006 não é is_demo — seed SÓ-DEMO ignorado';
    RETURN;
  END IF;

  INSERT INTO projetos_equipe (id, company_id, nome, descricao, custo_medio_hora, qtd_pessoas, ativo)
  VALUES (v_equipe, v_demo, 'Equipe de Obra — Civil', 'Equipe exemplo da obra (DEMO)', 26.00, 4, true)
  ON CONFLICT (id) DO NOTHING;

  -- membros apontam para cargos reais de projetos_mao_obra da própria 006 (FK), custo coerente com o cargo
  INSERT INTO projetos_equipe_membro (id, equipe_id, company_id, nome_pessoa, funcao_mao_obra_id, funcao_nome, custo_hora, ordem) VALUES
    ('b0700006-e001-4001-8001-0000000000a1', v_equipe, v_demo, 'José da Silva',   'a9b410a9-6766-4f7b-a52a-2d860d30f322', 'Servente', 18.00, 0),
    ('b0700006-e001-4001-8001-0000000000a2', v_equipe, v_demo, 'Antônio Pereira', '9dc4ec66-3052-4aa4-b0a2-c1b4402c5ff4', 'Gesseiro', 32.00, 1),
    ('b0700006-e001-4001-8001-0000000000a3', v_equipe, v_demo, 'Marcos Oliveira', 'faf215eb-1fef-40d7-a61f-07e1f11ed75f', 'Pintor',   26.00, 2),
    ('b0700006-e001-4001-8001-0000000000a4', v_equipe, v_demo, 'João Santos',     'd573029a-39c7-47a7-9d87-83361462d8fd', 'Pedreiro', 28.00, 3)
  ON CONFLICT (id) DO NOTHING;

  -- liga apontamentos existentes (DEMO) ao membro cujo cargo casa por NOME com a função do apontamento
  UPDATE projetos_obra_mao_obra_apontamento a
     SET membro_id = m.id
    FROM projetos_equipe_membro m
    JOIN projetos_mao_obra pmo ON pmo.id = m.funcao_mao_obra_id
    JOIN erp_funcao_mao_obra efo ON lower(btrim(efo.nome)) = lower(btrim(pmo.funcao))
   WHERE a.company_id = v_demo
     AND a.excluido_em IS NULL
     AND a.membro_id IS NULL
     AND a.funcao_id = efo.id
     AND m.company_id = v_demo
     AND m.equipe_id = v_equipe;
END $$;
