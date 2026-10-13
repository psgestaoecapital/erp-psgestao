-- SPEC OD-1 · Odonto — Pacientes: RG + número/código legível do paciente (prontuário).
-- RD-56/RD-41. DDL em tabela de domínio (erp_odonto_paciente) — CEO autoriza (§1 do OD-1).
-- ADITIVO E NÃO-DESTRUTIVO (RD-55): a tela Pacientes + Ficha (5 abas) JÁ EXISTEM e estão 'pronto'
-- (ver system_screens 'odonto_pacientes'). Aqui só somamos 2 campos + auto-sequencial no salvar,
-- preservando 100% do comportamento atual do fn_odonto_paciente_salvar (fronteira GE / cliente_id).

-- 1) Colunas novas (idempotente)
ALTER TABLE public.erp_odonto_paciente
  ADD COLUMN IF NOT EXISTS rg text,
  ADD COLUMN IF NOT EXISTS numero_paciente text;   -- código/nº legível (ex.: 2520); auto-sequencial por company

-- Unicidade do número por empresa (ignora nulos/vazios). Não colide entre clínicas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_odonto_paciente_numero
  ON public.erp_odonto_paciente (company_id, numero_paciente)
  WHERE numero_paciente IS NOT NULL AND numero_paciente <> '';

-- 2) Próximo número sequencial por empresa. Advisory lock por company evita corrida (2 cadastros
--    simultâneos na mesma clínica não pegam o mesmo número). Só conta números puramente numéricos.
CREATE OR REPLACE FUNCTION public.fn_odonto_proximo_numero_paciente(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_next int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('odonto_num_pac_' || p_company_id::text));
  SELECT COALESCE(MAX((numero_paciente)::int), 0) + 1 INTO v_next
  FROM erp_odonto_paciente
  WHERE company_id = p_company_id AND numero_paciente ~ '^[0-9]+$';
  RETURN v_next::text;
END $f$;
REVOKE ALL ON FUNCTION public.fn_odonto_proximo_numero_paciente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_proximo_numero_paciente(uuid) TO authenticated;

-- 3) Backfill: numera os pacientes já existentes por empresa, na ordem de cadastro (created_at).
DO $$
DECLARE c uuid; r record; n int;
BEGIN
  FOR c IN SELECT DISTINCT company_id FROM erp_odonto_paciente
           WHERE numero_paciente IS NULL OR numero_paciente = '' LOOP
    n := COALESCE((SELECT MAX((numero_paciente)::int) FROM erp_odonto_paciente
                   WHERE company_id = c AND numero_paciente ~ '^[0-9]+$'), 0);
    FOR r IN SELECT id FROM erp_odonto_paciente
             WHERE company_id = c AND (numero_paciente IS NULL OR numero_paciente = '')
             ORDER BY created_at, id LOOP
      n := n + 1;
      UPDATE erp_odonto_paciente SET numero_paciente = n::text WHERE id = r.id;
    END LOOP;
  END LOOP;
END $$;

-- 4) fn_odonto_paciente_salvar v2: + rg, + numero_paciente (auto se vazio). Idêntico ao anterior
--    em TUDO o mais (validação de acesso, NULLIF, fronteira GE via fn_odonto_cliente_do_paciente).
CREATE OR REPLACE FUNCTION public.fn_odonto_paciente_salvar(
  p_company_id uuid, p_id uuid DEFAULT NULL, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := p_id; v_cli uuid; v_nasc date; v_num text;
BEGIN
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta clínica.'); END IF;
  IF COALESCE(btrim(p_dados->>'nome'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome do paciente.'); END IF;
  v_nasc := (NULLIF(btrim(COALESCE(p_dados->>'data_nascimento','')),''))::date;

  IF v_id IS NULL THEN
    INSERT INTO erp_odonto_paciente (
      company_id, nome, cpf, rg, data_nascimento, sexo, telefone, celular, email,
      cep, logradouro, numero, complemento, bairro, cidade, uf,
      responsavel_nome, responsavel_cpf, responsavel_parentesco,
      convenio_nome, convenio_carteirinha, alergias, observacao, numero_paciente, criado_por, ativo)
    VALUES (
      p_company_id, btrim(p_dados->>'nome'), NULLIF(btrim(p_dados->>'cpf'),''), NULLIF(btrim(p_dados->>'rg'),''), v_nasc, NULLIF(p_dados->>'sexo',''),
      NULLIF(btrim(p_dados->>'telefone'),''), NULLIF(btrim(p_dados->>'celular'),''), NULLIF(btrim(p_dados->>'email'),''),
      NULLIF(btrim(p_dados->>'cep'),''), NULLIF(btrim(p_dados->>'logradouro'),''), NULLIF(btrim(p_dados->>'numero'),''),
      NULLIF(btrim(p_dados->>'complemento'),''), NULLIF(btrim(p_dados->>'bairro'),''), NULLIF(btrim(p_dados->>'cidade'),''), NULLIF(btrim(p_dados->>'uf'),''),
      NULLIF(btrim(p_dados->>'responsavel_nome'),''), NULLIF(btrim(p_dados->>'responsavel_cpf'),''), NULLIF(btrim(p_dados->>'responsavel_parentesco'),''),
      NULLIF(btrim(p_dados->>'convenio_nome'),''), NULLIF(btrim(p_dados->>'convenio_carteirinha'),''),
      NULLIF(btrim(p_dados->>'alergias'),''), NULLIF(btrim(p_dados->>'observacao'),''),
      NULLIF(btrim(p_dados->>'numero_paciente'),''), auth.uid(), true)
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_paciente SET
      nome=btrim(p_dados->>'nome'), cpf=NULLIF(btrim(p_dados->>'cpf'),''), rg=NULLIF(btrim(p_dados->>'rg'),''), data_nascimento=v_nasc, sexo=NULLIF(p_dados->>'sexo',''),
      telefone=NULLIF(btrim(p_dados->>'telefone'),''), celular=NULLIF(btrim(p_dados->>'celular'),''), email=NULLIF(btrim(p_dados->>'email'),''),
      cep=NULLIF(btrim(p_dados->>'cep'),''), logradouro=NULLIF(btrim(p_dados->>'logradouro'),''), numero=NULLIF(btrim(p_dados->>'numero'),''),
      complemento=NULLIF(btrim(p_dados->>'complemento'),''), bairro=NULLIF(btrim(p_dados->>'bairro'),''), cidade=NULLIF(btrim(p_dados->>'cidade'),''), uf=NULLIF(btrim(p_dados->>'uf'),''),
      responsavel_nome=NULLIF(btrim(p_dados->>'responsavel_nome'),''), responsavel_cpf=NULLIF(btrim(p_dados->>'responsavel_cpf'),''), responsavel_parentesco=NULLIF(btrim(p_dados->>'responsavel_parentesco'),''),
      convenio_nome=NULLIF(btrim(p_dados->>'convenio_nome'),''), convenio_carteirinha=NULLIF(btrim(p_dados->>'convenio_carteirinha'),''),
      alergias=NULLIF(btrim(p_dados->>'alergias'),''), observacao=NULLIF(btrim(p_dados->>'observacao'),''),
      -- número: respeita o informado; senão mantém o existente (não sobrescreve nem apaga)
      numero_paciente=COALESCE(NULLIF(btrim(p_dados->>'numero_paciente'),''), numero_paciente), updated_at=now()
    WHERE id=v_id AND company_id=p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Paciente não encontrado.'); END IF;
  END IF;

  -- número automático (RD-51): se ficou sem número (novo cadastro ou linha antiga editada), gera agora.
  UPDATE erp_odonto_paciente
    SET numero_paciente = public.fn_odonto_proximo_numero_paciente(p_company_id)
    WHERE id = v_id AND (numero_paciente IS NULL OR numero_paciente = '');
  SELECT numero_paciente INTO v_num FROM erp_odonto_paciente WHERE id = v_id;

  -- FRONTEIRA GE: cria/liga o cliente (cliente_id). Se falhar, o paciente já foi salvo —
  -- devolve cliente_id null (honesto); dá pra reconciliar depois (fn_odonto_backfill_cliente).
  BEGIN v_cli := public.fn_odonto_cliente_do_paciente(v_id); EXCEPTION WHEN OTHERS THEN v_cli := NULL; END;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'cliente_id', v_cli, 'numero_paciente', v_num);
END $function$;

REVOKE ALL ON FUNCTION public.fn_odonto_paciente_salvar(uuid,uuid,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_paciente_salvar(uuid,uuid,jsonb) TO authenticated;

-- 5) atualiza o catálogo de telas (idempotente) — 8 abas (Sobre/Orçamentos/Odontograma/Débitos/
--    Prontuário + Anamnese/Imagens/Documentos em construção) e RG/nº no cadastro.
UPDATE public.system_screens SET
  descricao_funcional = 'Lista pesquisável de pacientes (nome/CPF/celular) com nº do paciente e badge de saldo + ficha com abas Sobre/Orçamentos/Odontograma/Débitos/Prontuário (funcionais) e Anamnese/Imagens/Documentos (em construção · OD-2→). Sobre mostra consultas + última evolução; Orçamentos aprova (gera a receber); Débitos recebe via 7 formas. Cadastro cria/vincula o cliente GE (cliente_id) e agora grava RG + número sequencial do paciente.',
  atualizado_em = now()
WHERE id = 'odonto_pacientes';
