-- Hub · Gestão de Obras · Regularização da obra: alvará, licenças, CNO, ART e RRT (blueprint vivo tela 314).
-- Requisito "ausente": "Na ficha: alvará e licenças com validade, CNO, ARTs e RRTs...".
-- Esta fatia cobre os DOCUMENTOS de regularização com validade (o controle de responsáveis técnicos /
-- empresas executoras vem em PR própria). Tabela NOVA, aditiva, hub-owned. Não toca núcleo nem dado de
-- cliente. RLS por company_id, REVOKE anon. RPCs guardadas (SECURITY DEFINER + fn__guarda_empresa).
-- Soft-delete rastreável (RD-98 p4). A leitura devolve cada documento com a situação (vigente/vence/vencido).

-- 1) Tabela dos documentos de regularização da obra ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos_obra_licenca (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  obra_id       uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN (
                  'alvara','licenca_previa','licenca_instalacao','licenca_operacao',
                  'cno','art','rrt','habite_se','outro')),
  numero        text,
  orgao         text,
  responsavel   text,
  descricao     text,
  emissao       date,
  validade      date,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em   timestamptz,
  excluido_por  uuid
);

CREATE INDEX IF NOT EXISTS idx_obra_licenca_obra     ON public.projetos_obra_licenca(obra_id)  WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_obra_licenca_validade ON public.projetos_obra_licenca(validade) WHERE excluido_em IS NULL;

COMMENT ON TABLE public.projetos_obra_licenca IS 'Hub/Obras tela 314: documentos de regularização da obra (alvará, licenças, CNO, ART, RRT, habite-se) com validade. Aditiva, hub-owned, RLS por empresa.';

-- 2) RLS por company_id + REVOKE anon --------------------------------------------------------------
ALTER TABLE public.projetos_obra_licenca ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projetos_obra_licenca_rw ON public.projetos_obra_licenca;
CREATE POLICY projetos_obra_licenca_rw ON public.projetos_obra_licenca
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.projetos_obra_licenca FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_obra_licenca TO authenticated, service_role;

-- 3) Leitura: documentos da obra com a situação pela validade --------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_licenca_listar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_obra public.projetos_obras%ROWTYPE; v_itens jsonb; v_hoje date := current_date;
BEGIN
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'tipo', l.tipo, 'numero', l.numero, 'orgao', l.orgao,
           'responsavel', l.responsavel, 'descricao', l.descricao,
           'emissao', l.emissao, 'validade', l.validade,
           'situacao', CASE
                         WHEN l.validade IS NULL THEN 'sem_validade'
                         WHEN l.validade < v_hoje THEN 'vencido'
                         WHEN l.validade <= v_hoje + 30 THEN 'vence_30'
                         ELSE 'vigente'
                       END
         ) ORDER BY (l.validade IS NULL), l.validade, l.criado_em), '[]'::jsonb)
    INTO v_itens
    FROM public.projetos_obra_licenca l
   WHERE l.obra_id = p_obra_id AND l.company_id = v_obra.company_id AND l.excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'itens', v_itens);
END; $fn$;

-- 4) Gravação (insere ou edita) --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_licenca_salvar(
  p_obra_id uuid, p_id uuid, p_tipo text, p_numero text, p_orgao text,
  p_responsavel text, p_descricao text, p_emissao date, p_validade date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_obra public.projetos_obras%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_obra.company_id);

  IF p_tipo NOT IN ('alvara','licenca_previa','licenca_instalacao','licenca_operacao',
                    'cno','art','rrt','habite_se','outro') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Tipo de documento inválido.');
  END IF;
  IF p_emissao IS NOT NULL AND p_validade IS NOT NULL AND p_validade < p_emissao THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A validade não pode ser anterior à emissão.');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.projetos_obra_licenca
      (company_id, obra_id, tipo, numero, orgao, responsavel, descricao, emissao, validade, criado_por)
    VALUES (v_obra.company_id, p_obra_id, p_tipo, nullif(btrim(p_numero),''), nullif(btrim(p_orgao),''),
            nullif(btrim(p_responsavel),''), nullif(btrim(p_descricao),''), p_emissao, p_validade, auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_obra.company_id, auth.uid(), 'projetos_obra_licenca', v_id::text, 'obra_licenca_inserir',
            NULL, jsonb_build_object('tipo', p_tipo, 'numero', p_numero, 'validade', p_validade));
  ELSE
    UPDATE public.projetos_obra_licenca
       SET tipo = p_tipo, numero = nullif(btrim(p_numero),''), orgao = nullif(btrim(p_orgao),''),
           responsavel = nullif(btrim(p_responsavel),''), descricao = nullif(btrim(p_descricao),''),
           emissao = p_emissao, validade = p_validade, atualizado_em = now()
     WHERE id = p_id AND obra_id = p_obra_id AND company_id = v_obra.company_id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Documento não encontrado para editar.'); END IF;
    INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_obra.company_id, auth.uid(), 'projetos_obra_licenca', v_id::text, 'obra_licenca_editar',
            NULL, jsonb_build_object('tipo', p_tipo, 'numero', p_numero, 'validade', p_validade));
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $fn$;

-- 5) Exclusão rastreável (soft-delete) -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_licenca_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_item public.projetos_obra_licenca%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_item FROM public.projetos_obra_licenca WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Documento não encontrado.'); END IF;
  PERFORM public.fn__guarda_empresa(v_item.company_id);

  UPDATE public.projetos_obra_licenca
     SET excluido_em = now(), excluido_por = auth.uid(), atualizado_em = now()
   WHERE id = p_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_item.company_id, auth.uid(), 'projetos_obra_licenca', p_id::text, 'obra_licenca_excluir',
          jsonb_build_object('tipo', v_item.tipo, 'numero', v_item.numero),
          jsonb_build_object('motivo', nullif(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true);
END; $fn$;

REVOKE ALL ON FUNCTION public.fn_obra_licenca_listar(uuid)                                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_licenca_salvar(uuid, uuid, text, text, text, text, text, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_licenca_excluir(uuid, text)                                      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_licenca_listar(uuid)                                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_licenca_salvar(uuid, uuid, text, text, text, text, text, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_licenca_excluir(uuid, text)                                      TO authenticated, service_role;

-- 6) system_screens: a tela existe e é auditável --------------------------------------------------
INSERT INTO public.system_screens (id, rota, area, titulo, modulo, estado_real, auditavel_robo)
VALUES ('dashboard.projetos_obras_id_regularizacao', '/dashboard/projetos/obras/[id]/regularizacao',
        'hub_construcao', 'Regularização da obra', 'projetos_obras', 'parcial', true)
ON CONFLICT (id) DO NOTHING;

-- 7) RD-95: "?" dos campos e ações da tela ---------------------------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_licenca.tipo',
  '/dashboard/projetos/obras/[id]/regularizacao', 'Regularização da obra', 'Tipo de documento',
  'Escolha o tipo: alvará de construção, licenças ambientais (prévia, de instalação, de operação), CNO, ART, RRT, habite-se ou outro.',
  'Organiza os documentos legais da obra e permite cobrar renovação antes de vencer.',
  'Alvará de construção; Licença de operação; ART da estrutura.',
  'Lançar tudo como "Outro" — use o tipo certo para o controle de validade funcionar.',
  'hub_projetos', 1, 1, 'publicado'),
 ('projetos.obra_licenca.numero',
  '/dashboard/projetos/obras/[id]/regularizacao', 'Regularização da obra', 'Número',
  'Número do documento no órgão emissor (do alvará, da licença, da ART/RRT, do CNO...).',
  'Identifica o documento oficial para consulta e prestação de contas.',
  'Alvará 2026/1234; ART 0012345678.',
  'Deixar sem número um documento que já foi emitido — dificulta localizar depois.',
  'hub_projetos', 2, 1, 'publicado'),
 ('projetos.obra_licenca.orgao',
  '/dashboard/projetos/obras/[id]/regularizacao', 'Regularização da obra', 'Órgão emissor',
  'Quem emitiu o documento (prefeitura, órgão ambiental, CREA/CAU, Receita Federal...).',
  'Mostra a origem do documento e para onde ir na renovação.',
  'Prefeitura Municipal; CREA-SP; Secretaria do Meio Ambiente.',
  'Confundir o órgão emissor com o responsável técnico — são campos diferentes.',
  'hub_projetos', 3, 1, 'publicado'),
 ('projetos.obra_licenca.responsavel',
  '/dashboard/projetos/obras/[id]/regularizacao', 'Regularização da obra', 'Responsável técnico',
  'Nome do responsável técnico ou projetista ligado a este documento (quando houver).',
  'Liga o documento ao profissional que responde por ele (ART/RRT, projeto, execução).',
  'Eng. João da Silva — CREA 123456.',
  'Preencher o responsável no campo do órgão emissor.',
  'hub_projetos', 4, 1, 'publicado'),
 ('projetos.obra_licenca.emissao',
  '/dashboard/projetos/obras/[id]/regularizacao', 'Regularização da obra', 'Emissão',
  'Data em que o documento foi emitido.',
  'Serve de referência e evita cadastrar validade anterior à emissão.',
  '01/03/2026.',
  'Inverter emissão e validade.',
  'hub_projetos', 5, 1, 'publicado'),
 ('projetos.obra_licenca.validade',
  '/dashboard/projetos/obras/[id]/regularizacao', 'Regularização da obra', 'Validade',
  'Data até quando o documento é válido. Deixe em branco se não tem validade.',
  'A tela destaca o que está vencido ou vence nos próximos 30 dias, para renovar a tempo.',
  '28/02/2027.',
  'Deixar em branco um documento que tem prazo — ele não entrará nos alertas de vencimento.',
  'hub_projetos', 6, 1, 'publicado'),
 ('projetos.obra_licenca.adicionar',
  '/dashboard/projetos/obras/[id]/regularizacao', 'Regularização da obra', 'Adicionar documento',
  'Clique para incluir um novo documento de regularização na obra.',
  'Monta o controle legal da obra (alvará, licenças, CNO, ART/RRT, habite-se).',
  'Adicionar o alvará de construção com número, órgão e validade.',
  'Adicionar o mesmo documento duas vezes — edite o existente em vez de duplicar.',
  'hub_projetos', 7, 1, 'publicado'),
 ('projetos.obra_licenca.excluir',
  '/dashboard/projetos/obras/[id]/regularizacao', 'Regularização da obra', 'Excluir',
  'Remove o documento da lista. A exclusão fica registrada (quem e quando).',
  'Mantém a lista limpa sem perder o rastro da exclusão.',
  'Excluir um documento lançado por engano.',
  'Excluir um documento ainda válido achando que é só ocultar — ele sai da lista.',
  'hub_projetos', 8, 1, 'publicado'),
 ('projetos.cockpit.regularizacao',
  '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Regularização da obra',
  'Atalho para os documentos de regularização da obra (alvará, licenças, CNO, ART/RRT) com validade.',
  'Abre o controle legal da obra e os alertas de documento vencido ou a vencer.',
  'Clique para cadastrar o alvará, as licenças e as ARTs desta obra.',
  'Procurar os documentos legais em outra tela — eles ficam no Cockpit da obra.',
  'hub_projetos', 11, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
