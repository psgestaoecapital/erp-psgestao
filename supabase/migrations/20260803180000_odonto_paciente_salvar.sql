-- RD-41 · Odonto — Ficha do Paciente (🅰️). Save do paciente + ponte GE.
-- RD-26: usa a tabela existente erp_odonto_paciente + fn_odonto_cliente_do_paciente. Nenhuma
-- tabela nova. FRONTEIRA GE (RD-25): ao salvar, garante o cliente vinculado (cria/liga em
-- erp_clientes via fn_odonto_cliente_do_paciente) → ponte pro O0 gerar erp_receber.
-- RD-51: dado ausente = branco (NULLIF). Só nome é obrigatório (recepção cadastra rápido).

CREATE OR REPLACE FUNCTION public.fn_odonto_paciente_salvar(
  p_company_id uuid, p_id uuid DEFAULT NULL, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := p_id; v_cli uuid; v_nasc date;
BEGIN
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta clínica.'); END IF;
  IF COALESCE(btrim(p_dados->>'nome'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome do paciente.'); END IF;
  v_nasc := (NULLIF(btrim(COALESCE(p_dados->>'data_nascimento','')),''))::date;

  IF v_id IS NULL THEN
    INSERT INTO erp_odonto_paciente (
      company_id, nome, cpf, data_nascimento, sexo, telefone, celular, email,
      cep, logradouro, numero, complemento, bairro, cidade, uf,
      responsavel_nome, responsavel_cpf, responsavel_parentesco,
      convenio_nome, convenio_carteirinha, alergias, observacao, criado_por, ativo)
    VALUES (
      p_company_id, btrim(p_dados->>'nome'), NULLIF(btrim(p_dados->>'cpf'),''), v_nasc, NULLIF(p_dados->>'sexo',''),
      NULLIF(btrim(p_dados->>'telefone'),''), NULLIF(btrim(p_dados->>'celular'),''), NULLIF(btrim(p_dados->>'email'),''),
      NULLIF(btrim(p_dados->>'cep'),''), NULLIF(btrim(p_dados->>'logradouro'),''), NULLIF(btrim(p_dados->>'numero'),''),
      NULLIF(btrim(p_dados->>'complemento'),''), NULLIF(btrim(p_dados->>'bairro'),''), NULLIF(btrim(p_dados->>'cidade'),''), NULLIF(btrim(p_dados->>'uf'),''),
      NULLIF(btrim(p_dados->>'responsavel_nome'),''), NULLIF(btrim(p_dados->>'responsavel_cpf'),''), NULLIF(btrim(p_dados->>'responsavel_parentesco'),''),
      NULLIF(btrim(p_dados->>'convenio_nome'),''), NULLIF(btrim(p_dados->>'convenio_carteirinha'),''),
      NULLIF(btrim(p_dados->>'alergias'),''), NULLIF(btrim(p_dados->>'observacao'),''), auth.uid(), true)
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_paciente SET
      nome=btrim(p_dados->>'nome'), cpf=NULLIF(btrim(p_dados->>'cpf'),''), data_nascimento=v_nasc, sexo=NULLIF(p_dados->>'sexo',''),
      telefone=NULLIF(btrim(p_dados->>'telefone'),''), celular=NULLIF(btrim(p_dados->>'celular'),''), email=NULLIF(btrim(p_dados->>'email'),''),
      cep=NULLIF(btrim(p_dados->>'cep'),''), logradouro=NULLIF(btrim(p_dados->>'logradouro'),''), numero=NULLIF(btrim(p_dados->>'numero'),''),
      complemento=NULLIF(btrim(p_dados->>'complemento'),''), bairro=NULLIF(btrim(p_dados->>'bairro'),''), cidade=NULLIF(btrim(p_dados->>'cidade'),''), uf=NULLIF(btrim(p_dados->>'uf'),''),
      responsavel_nome=NULLIF(btrim(p_dados->>'responsavel_nome'),''), responsavel_cpf=NULLIF(btrim(p_dados->>'responsavel_cpf'),''), responsavel_parentesco=NULLIF(btrim(p_dados->>'responsavel_parentesco'),''),
      convenio_nome=NULLIF(btrim(p_dados->>'convenio_nome'),''), convenio_carteirinha=NULLIF(btrim(p_dados->>'convenio_carteirinha'),''),
      alergias=NULLIF(btrim(p_dados->>'alergias'),''), observacao=NULLIF(btrim(p_dados->>'observacao'),''), updated_at=now()
    WHERE id=v_id AND company_id=p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Paciente não encontrado.'); END IF;
  END IF;

  -- FRONTEIRA GE: cria/liga o cliente (cliente_id). Se falhar, o paciente já foi salvo —
  -- devolve cliente_id null (honesto); dá pra reconciliar depois (fn_odonto_backfill_cliente).
  BEGIN v_cli := public.fn_odonto_cliente_do_paciente(v_id); EXCEPTION WHEN OTHERS THEN v_cli := NULL; END;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'cliente_id', v_cli);
END $function$;

REVOKE ALL ON FUNCTION public.fn_odonto_paciente_salvar(uuid,uuid,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_paciente_salvar(uuid,uuid,jsonb) TO authenticated;

-- RD-35 · registra a rota da Ficha do Paciente no catálogo de telas (idempotente).
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, componentes_principais, rpcs_chamadas, estado_real, prioridade_monitoramento, modulo)
VALUES (
  'odonto_pacientes', '/dashboard/odonto/pacientes', 'odonto', 'Ficha do Paciente (lista + cadastro + abas)',
  'Lista pesquisável de pacientes (nome/CPF/celular) + ficha com abas Sobre/Orçamentos/Odontograma/Débitos/Prontuário. Cadastro cria/vincula o cliente GE (cliente_id) — ponte pro O0. CEP→endereço + IBGE invisível; menor→responsável; alergias em destaque.',
  ARRAY['PacientesOdontoPage','FichaPaciente','Odontograma'],
  ARRAY['fn_odonto_paciente_salvar','fn_odonto_cliente_do_paciente','fn_odonto_planos_paciente','fn_odonto_debitos_paciente','fn_odonto_prontuario_paciente','fn_odonto_prontuario_salvar','fn_odonto_odontograma_estado'],
  'pronto', 'alta', 'odonto_pacientes')
ON CONFLICT (id) DO UPDATE SET
  rota=EXCLUDED.rota, titulo=EXCLUDED.titulo, descricao_funcional=EXCLUDED.descricao_funcional,
  componentes_principais=EXCLUDED.componentes_principais, rpcs_chamadas=EXCLUDED.rpcs_chamadas,
  estado_real=EXCLUDED.estado_real, modulo=EXCLUDED.modulo, atualizado_em=now();
