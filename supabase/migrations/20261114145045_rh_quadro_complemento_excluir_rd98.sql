-- Quadro de pessoal (Indústria › RH › Quadro) · RD-98 pilar 2 (excluir rastreável).
-- Gap do auditor PDCA (aud8 88/95): hoje o complemento de pessoa (cargo/setor/supervisor/salário,
-- gravado por CPF ou matrícula na tabela rh_pessoa_complemento) só pode ser EDITADO/SALVO pela tela;
-- não há como REMOVER um complemento lançado por engano. RD-98 exige incluir/editar/EXCLUIR visíveis.
-- Code: desenvolvedor_4_g.
--
-- RD-38 (provado no dado): a tabela rh_pessoa_complemento JÁ tem as colunas de soft-delete
-- (excluido_em, excluido_por) e os índices únicos parciais usam "WHERE excluido_em IS NULL" — ou seja,
-- marcar excluido_em devolve a vaga (company_id,cpf)/(company_id,matricula) e a linha some do quadro,
-- mas o histórico FICA (rastreável: quem/quando). Nada é apagado fisicamente.
--
-- Aditiva: cria APENAS uma função nova (soft-delete, por empresa, com guarda de permissão idêntica ao
-- salvar). Não altera nenhuma função existente, nenhuma policy, nenhum dado de cliente. Idempotente
-- (CREATE OR REPLACE). Mesma guarda LGPD: só RH/diretoria/admin (fn__rh_pode_custo) e só a própria empresa.

CREATE OR REPLACE FUNCTION public.fn_rh_pessoa_complemento_excluir(
  p_company_id uuid, p_cpf text, p_matricula text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cpf text; v_mat text; v_id uuid;
BEGIN
  -- Mesma guarda do salvar: empresa do usuário (ou admin) + perfil que pode ver custo (LGPD).
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT fn__rh_pode_custo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_rh'); END IF;

  v_cpf := NULLIF(regexp_replace(COALESCE(p_cpf,''), '\D', '', 'g'), '');
  v_mat := NULLIF(btrim(COALESCE(p_matricula,'')), '');

  -- Soft-delete: marca excluido_em/por (rastreável) e some do quadro. Só linha ativa da própria empresa.
  UPDATE rh_pessoa_complemento
     SET excluido_em = now(), excluido_por = auth.uid(),
         atualizado_em = now(), atualizado_por = auth.uid()
   WHERE company_id = p_company_id
     AND excluido_em IS NULL
     AND (
          (v_cpf IS NOT NULL AND length(v_cpf) = 11 AND cpf = v_cpf)
       OR (v_cpf IS NULL AND v_mat IS NOT NULL AND cpf IS NULL AND matricula = v_mat)
         )
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_rh_pessoa_complemento_excluir(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_pessoa_complemento_excluir(uuid, text, text) TO authenticated, service_role;

-- RD-98 p3: a tela agora também chama esta RPC — documenta a origem/escrita em system_screens.
UPDATE public.system_screens
   SET rpcs_chamadas = (
        SELECT ARRAY(SELECT DISTINCT unnest(
          COALESCE(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_rh_pessoa_complemento_excluir']::text[]
        ))
       )
 WHERE rota = '/dashboard/industrial/rh/quadro';

-- RD-95: a nova ação "Remover" tem o seu "?" (chave nova em erp_ajuda_campo). Idempotente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('rh.quadro.remover', '/dashboard/industrial/rh/quadro', 'Quadro', 'Remover do quadro',
   'Use em quem foi lançado por engano ou não faz mais parte do quadro desta competência.',
   'Tira a pessoa do quadro sem apagar o histórico: fica registrado quem removeu e quando, e a vaga do CPF/matrícula volta a ficar livre para um novo lançamento.',
   'Removeu um CPF duplicado lançado por engano.',
   'Remover não mexe no ponto nem na folha — só desfaz o complemento (cargo, setor, supervisor, salário) daquela pessoa.',
   'industrial', 20, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
