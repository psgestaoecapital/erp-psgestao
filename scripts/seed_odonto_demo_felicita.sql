-- SEED [DEMO] — Odonto · Felicita (e46c50e5) — jornada completa pra o CEO ver funcionando.
-- ⚠️ NÃO é migração. Paciente 100% FICTÍCIO (CPF fake, dados fake). Zero dado real de saúde.
-- Tudo prefixado [DEMO]. Idempotente. Escopo company_id (RD-45).
-- REMOVER: SELECT fn_odonto_demo_limpar('e46c50e5-eaae-4f4f-913b-bf7aadffbb18') no app (autenticado),
--          OU rodar o bloco de limpeza abaixo via MCP.
DO $$
DECLARE
  C uuid := 'e46c50e5-eaae-4f4f-913b-bf7aadffbb18';
  v_pac uuid; v_cad uuid; v_prof uuid; v_p1 uuid; v_p2 uuid; v1 numeric; v2 numeric;
  v_plano uuid; v_pront uuid;
BEGIN
  -- limpeza idempotente (só [DEMO], ordem FK-safe)
  DELETE FROM erp_odonto_agendamento WHERE company_id=C AND paciente_id IN (SELECT id FROM erp_odonto_paciente WHERE company_id=C AND nome LIKE '[DEMO]%');
  DELETE FROM erp_odonto_plano_item WHERE company_id=C AND plano_id IN (SELECT id FROM erp_odonto_plano_tratamento WHERE company_id=C AND paciente_id IN (SELECT id FROM erp_odonto_paciente WHERE company_id=C AND nome LIKE '[DEMO]%'));
  DELETE FROM erp_odonto_plano_tratamento WHERE company_id=C AND paciente_id IN (SELECT id FROM erp_odonto_paciente WHERE company_id=C AND nome LIKE '[DEMO]%');
  DELETE FROM erp_odonto_odontograma WHERE company_id=C AND paciente_id IN (SELECT id FROM erp_odonto_paciente WHERE company_id=C AND nome LIKE '[DEMO]%');
  DELETE FROM erp_odonto_prontuario WHERE company_id=C AND paciente_id IN (SELECT id FROM erp_odonto_paciente WHERE company_id=C AND nome LIKE '[DEMO]%');
  DELETE FROM erp_odonto_paciente WHERE company_id=C AND nome LIKE '[DEMO]%';

  -- seeds existentes (cadeira/profissional/procedimentos) — reusa, não cria
  SELECT id INTO v_cad  FROM erp_odonto_cadeira      WHERE company_id=C ORDER BY created_at LIMIT 1;
  SELECT id INTO v_prof FROM erp_odonto_profissional WHERE company_id=C ORDER BY created_at LIMIT 1;
  SELECT id, valor INTO v_p1, v1 FROM erp_odonto_procedimento WHERE company_id=C AND ativo ORDER BY created_at LIMIT 1;
  SELECT id, valor INTO v_p2, v2 FROM erp_odonto_procedimento WHERE company_id=C AND ativo ORDER BY created_at OFFSET 1 LIMIT 1;
  v1 := coalesce(v1, 150); v2 := coalesce(v2, 300);

  -- 1 · paciente FICTÍCIO
  INSERT INTO erp_odonto_paciente (company_id, nome, cpf, data_nascimento, sexo, celular, email, ativo, observacao)
    VALUES (C, '[DEMO] Maria Teste', '000.000.000-00', '1990-05-20', 'F', '(00) 90000-0000', 'demo.maria@exemplo.invalido', true, '[DEMO] paciente fictício para demonstração — apagar com fn_odonto_demo_limpar')
    RETURNING id INTO v_pac;

  -- 2 · agenda (1 realizado passado, 2 futuros)
  INSERT INTO erp_odonto_agendamento (company_id, cadeira_id, profissional_id, procedimento_id, paciente_id, paciente_nome, data, hora_inicio, hora_fim, status, observacao) VALUES
    (C, v_cad, v_prof, v_p1, v_pac, '[DEMO] Maria Teste', current_date - 7, '09:00', '09:30', 'concluido',  '[DEMO]'),
    (C, v_cad, v_prof, v_p2, v_pac, '[DEMO] Maria Teste', current_date + 3, '14:00', '15:00', 'agendado',   '[DEMO]'),
    (C, v_cad, v_prof, v_p1, v_pac, '[DEMO] Maria Teste', current_date + 3, '15:00', '15:30', 'confirmado', '[DEMO]');

  -- 3 · plano/orçamento (aprovado) + itens (odontograma-light: dente/faces)
  INSERT INTO erp_odonto_plano_tratamento (company_id, paciente_id, profissional_id, titulo, status, desconto, valor_total, condicao_pagamento, observacao, aprovado_em, aprovado_por)
    VALUES (C, v_pac, v_prof, '[DEMO] Plano de tratamento — Maria Teste', 'aprovado', 0, v1 + v2, '3x sem juros', '[DEMO]', now(), 'Demo')
    RETURNING id INTO v_plano;
  INSERT INTO erp_odonto_plano_item (company_id, plano_id, procedimento_id, descricao, dente, faces, valor, status, ordem) VALUES
    (C, v_plano, v_p1, '[DEMO] Restauração', '36', 'O', v1, 'aprovado', 1),
    (C, v_plano, v_p2, '[DEMO] Tratamento',  '11', 'V', v2, 'proposto', 2);

  -- 4 · prontuário (evoluções imutáveis) + odontograma clínico
  INSERT INTO erp_odonto_prontuario (company_id, paciente_id, profissional_id, tipo, texto, data_atendimento, origem, assinado, assinado_em, assinado_por)
    VALUES (C, v_pac, v_prof, 'anamnese', '[DEMO] Anamnese: paciente fictícia, sem comorbidades relatadas, sem alergias conhecidas.', current_date - 7, 'manual', true, now(), NULL);
  INSERT INTO erp_odonto_prontuario (company_id, paciente_id, profissional_id, tipo, texto, data_atendimento, origem, assinado, assinado_em, assinado_por)
    VALUES (C, v_pac, v_prof, 'evolucao', '[DEMO] Realizada restauração em resina no dente 36 (face O). Sem intercorrências. Paciente orientada.', current_date - 7, 'manual', true, now(), NULL)
    RETURNING id INTO v_pront;
  INSERT INTO erp_odonto_odontograma (company_id, paciente_id, dente, face, condicao, procedimento_id, prontuario_id, observacao) VALUES
    (C, v_pac, '36', 'O',  'restauracao', v_p1, v_pront, '[DEMO]'),
    (C, v_pac, '11', 'V',  'carie',       v_p2, NULL,    '[DEMO] a tratar'),
    (C, v_pac, '46', NULL, 'ausente',     NULL, NULL,    '[DEMO]');
END $$;
