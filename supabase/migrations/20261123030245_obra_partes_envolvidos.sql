-- Hub · Gestão de Obras · Partes envolvidas na obra (blueprint vivo tela 314, "obra como cadastro central").
-- Requisito "ausente": "Proprietário, contratante, construtora executora e escritório gestor identificados
-- separadamente; mais de um proprietário por obra; representantes autorizados."
-- Tabela NOVA, aditiva, hub-owned: várias partes por obra, cada uma com um papel. Não toca núcleo nem dado
-- de cliente. RLS por company_id, REVOKE anon. RPCs guardadas (SECURITY DEFINER + fn__guarda_empresa).
-- Soft-delete rastreável (RD-98 p4).

-- 1) Tabela das partes envolvidas na obra ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos_obra_parte (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  obra_id       uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  papel         text NOT NULL CHECK (papel IN (
                  'proprietario','contratante','construtora_executora','escritorio_gestor','representante')),
  nome          text NOT NULL,
  documento     text,
  contato       text,
  observacao    text,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em   timestamptz,
  excluido_por  uuid
);

CREATE INDEX IF NOT EXISTS idx_obra_parte_obra ON public.projetos_obra_parte(obra_id) WHERE excluido_em IS NULL;

COMMENT ON TABLE public.projetos_obra_parte IS 'Hub/Obras tela 314: partes envolvidas na obra (proprietário, contratante, construtora executora, escritório gestor, representante). Várias por obra. Aditiva, hub-owned, RLS por empresa.';

-- 2) RLS por company_id + REVOKE anon --------------------------------------------------------------
ALTER TABLE public.projetos_obra_parte ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projetos_obra_parte_rw ON public.projetos_obra_parte;
CREATE POLICY projetos_obra_parte_rw ON public.projetos_obra_parte
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.projetos_obra_parte FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_obra_parte TO authenticated, service_role;

-- 3) Leitura: partes da obra (agrupáveis por papel na tela) ----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_parte_listar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_obra public.projetos_obras%ROWTYPE; v_itens jsonb;
  v_ord jsonb := '{"proprietario":1,"contratante":2,"construtora_executora":3,"escritorio_gestor":4,"representante":5}'::jsonb;
BEGIN
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'papel', p.papel, 'nome', p.nome, 'documento', p.documento,
           'contato', p.contato, 'observacao', p.observacao
         ) ORDER BY (v_ord->>p.papel)::int, p.nome), '[]'::jsonb)
    INTO v_itens
    FROM public.projetos_obra_parte p
   WHERE p.obra_id = p_obra_id AND p.company_id = v_obra.company_id AND p.excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'itens', v_itens);
END; $fn$;

-- 4) Gravação (insere ou edita) --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_parte_salvar(
  p_obra_id uuid, p_id uuid, p_papel text, p_nome text, p_documento text, p_contato text, p_observacao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_obra public.projetos_obras%ROWTYPE; v_nome text := nullif(btrim(p_nome), ''); v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_obra.company_id);

  IF p_papel NOT IN ('proprietario','contratante','construtora_executora','escritorio_gestor','representante') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Papel inválido.');
  END IF;
  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome da parte.');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.projetos_obra_parte
      (company_id, obra_id, papel, nome, documento, contato, observacao, criado_por)
    VALUES (v_obra.company_id, p_obra_id, p_papel, v_nome, nullif(btrim(p_documento),''),
            nullif(btrim(p_contato),''), nullif(btrim(p_observacao),''), auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_obra.company_id, auth.uid(), 'projetos_obra_parte', v_id::text, 'obra_parte_inserir',
            NULL, jsonb_build_object('papel', p_papel, 'nome', v_nome));
  ELSE
    UPDATE public.projetos_obra_parte
       SET papel = p_papel, nome = v_nome, documento = nullif(btrim(p_documento),''),
           contato = nullif(btrim(p_contato),''), observacao = nullif(btrim(p_observacao),''), atualizado_em = now()
     WHERE id = p_id AND obra_id = p_obra_id AND company_id = v_obra.company_id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Parte não encontrada para editar.'); END IF;
    INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_obra.company_id, auth.uid(), 'projetos_obra_parte', v_id::text, 'obra_parte_editar',
            NULL, jsonb_build_object('papel', p_papel, 'nome', v_nome));
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $fn$;

-- 5) Exclusão rastreável (soft-delete) -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_parte_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_item public.projetos_obra_parte%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_item FROM public.projetos_obra_parte WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Parte não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_item.company_id);

  UPDATE public.projetos_obra_parte
     SET excluido_em = now(), excluido_por = auth.uid(), atualizado_em = now()
   WHERE id = p_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_item.company_id, auth.uid(), 'projetos_obra_parte', p_id::text, 'obra_parte_excluir',
          jsonb_build_object('papel', v_item.papel, 'nome', v_item.nome),
          jsonb_build_object('motivo', nullif(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true);
END; $fn$;

REVOKE ALL ON FUNCTION public.fn_obra_parte_listar(uuid)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_parte_salvar(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_parte_excluir(uuid, text)                            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_parte_listar(uuid)                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_parte_salvar(uuid, uuid, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_parte_excluir(uuid, text)                            TO authenticated, service_role;

-- 6) system_screens: a tela existe e é auditável --------------------------------------------------
INSERT INTO public.system_screens (id, rota, area, titulo, modulo, estado_real, auditavel_robo)
VALUES ('dashboard.projetos_obras_id_partes', '/dashboard/projetos/obras/[id]/partes',
        'hub_construcao', 'Partes da obra', 'projetos_obras', 'parcial', true)
ON CONFLICT (id) DO NOTHING;

-- 7) RD-95: "?" dos campos e ações da tela ---------------------------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_parte.papel',
  '/dashboard/projetos/obras/[id]/partes', 'Partes da obra', 'Papel',
  'O papel da parte na obra: proprietário, contratante, construtora executora, escritório gestor ou representante autorizado.',
  'Identifica separadamente quem é dono, quem contratou, quem executa e quem gerencia — base para contratos, responsabilidades e comunicação.',
  'O dono do terreno → Proprietário; a construtora que executa → Construtora executora.',
  'Juntar tudo num só papel — cada função é uma parte separada (pode haver mais de um proprietário).',
  'hub_projetos', 1, 1, 'publicado'),
 ('projetos.obra_parte.nome',
  '/dashboard/projetos/obras/[id]/partes', 'Partes da obra', 'Nome',
  'Nome da pessoa ou empresa que ocupa este papel na obra.',
  'É como a parte aparece em contratos, comunicações e relatórios da obra.',
  'Construtora Alfa Ltda; José da Silva.',
  'Abreviar de forma que depois ninguém reconheça a parte.',
  'hub_projetos', 2, 1, 'publicado'),
 ('projetos.obra_parte.documento',
  '/dashboard/projetos/obras/[id]/partes', 'Partes da obra', 'CPF / CNPJ',
  'CPF (pessoa física) ou CNPJ (empresa) da parte, quando houver.',
  'Identifica oficialmente a parte para contratos e documentos da obra.',
  '12.345.678/0001-90; 123.456.789-00.',
  'Misturar CPF de uma pessoa com o CNPJ da empresa dela — informe o documento da parte cadastrada.',
  'hub_projetos', 3, 1, 'publicado'),
 ('projetos.obra_parte.contato',
  '/dashboard/projetos/obras/[id]/partes', 'Partes da obra', 'Contato',
  'E-mail e/ou telefone para falar com esta parte.',
  'Facilita acionar a parte certa (dono, contratante, gestor) sem procurar fora do sistema.',
  'contato@alfa.com.br · (11) 99999-0000.',
  'Deixar sem contato quem precisa aprovar ou receber avisos da obra.',
  'hub_projetos', 4, 1, 'publicado'),
 ('projetos.obra_parte.adicionar',
  '/dashboard/projetos/obras/[id]/partes', 'Partes da obra', 'Adicionar parte',
  'Clique para incluir uma nova parte (proprietário, contratante, executora, gestor ou representante).',
  'Monta o quadro de quem é quem na obra; pode haver mais de uma parte por papel.',
  'Adicionar a construtora executora e, depois, o escritório gestor.',
  'Adicionar a mesma parte duas vezes — edite a existente em vez de duplicar.',
  'hub_projetos', 5, 1, 'publicado'),
 ('projetos.obra_parte.excluir',
  '/dashboard/projetos/obras/[id]/partes', 'Partes da obra', 'Excluir',
  'Remove a parte da lista. A exclusão fica registrada (quem e quando).',
  'Mantém o quadro de partes atualizado sem perder o rastro.',
  'Excluir uma parte cadastrada por engano.',
  'Excluir a parte achando que só oculta — ela sai da lista da obra.',
  'hub_projetos', 6, 1, 'publicado'),
 ('projetos.cockpit.partes',
  '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Partes da obra',
  'Atalho para as partes envolvidas na obra (proprietário, contratante, executora, gestor, representantes).',
  'Abre o quadro de quem é quem na obra, com documento e contato de cada parte.',
  'Clique para cadastrar o proprietário, a construtora executora e o escritório gestor.',
  'Procurar as partes em outra tela — elas ficam no Cockpit da obra.',
  'hub_projetos', 12, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
