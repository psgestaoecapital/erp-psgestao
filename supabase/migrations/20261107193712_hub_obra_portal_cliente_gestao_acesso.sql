-- Hub · Gestão de Obras · Portal do cliente (H9) — ETAPA (b): a EQUIPE concede/revoga o acesso do cliente.
-- Decisão CEO 30/10: o cliente da obra vê avanço, fotos, medições e faturas pelo portal; antes disso alguém da
-- EQUIPE da obra precisa convidar esse cliente. A fundação (#3768) criou erp_obra_cliente_acesso (RLS por empresa
-- + fn_obra_portal_minhas_obras SECURITY DEFINER filtrando por auth.uid()). Esta migration adiciona SÓ as RPCs de
-- gestão (listar/conceder/revogar) para a tela da equipe, mais a ajuda (RD-95), o registro em system_screens e um
-- vínculo DEMO para o portal ter o que mostrar.
--
-- SEGURANÇA/LGPD (crítica): toda RPC é SECURITY DEFINER com GUARDA de empresa — só age sobre obra de uma empresa do
-- próprio usuário (get_user_company_ids) ou admin. Um usuário de outra empresa é recusado (provado no PR, RD-38).
-- ADITIVA: só cria funções/ajuda/seed; não altera tabela, não toca dado de cliente real, não mexe em RBAC.
-- fn_obra_portal_minhas_obras (fundação) continua sendo o único caminho de LEITURA do cliente.

-- ───────────────────────── 1. LISTAR acessos de uma obra (lado equipe) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_cliente_acesso_listar(p_obra_id uuid)
RETURNS TABLE(
  id uuid, user_id uuid, email text, nome text, papel text,
  ativo boolean, criado_em timestamptz, convidado_por_nome text,
  revogado_em timestamptz, revogado_motivo text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT o.company_id INTO v_company FROM public.projetos_obras o
   WHERE o.id = p_obra_id AND o.deleted_at IS NULL;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Obra não encontrada.' USING ERRCODE='P0002';
  END IF;
  IF NOT ((v_company IN (SELECT get_user_company_ids())) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para esta obra.' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.user_id, u.email, COALESCE(u.full_name, u.email) AS nome, a.papel,
         (a.revogado_em IS NULL) AS ativo, a.criado_em,
         COALESCE(cu.full_name, cu.email) AS convidado_por_nome,
         a.revogado_em, a.revogado_motivo
  FROM public.erp_obra_cliente_acesso a
  JOIN public.users u ON u.id = a.user_id
  LEFT JOIN public.users cu ON cu.id = a.convidado_por
  WHERE a.obra_id = p_obra_id
  ORDER BY (a.revogado_em IS NULL) DESC, a.criado_em DESC;
END;
$function$;

-- ───────────────────────── 2. CONCEDER acesso (convidar cliente pelo e-mail) ─────────────────────────
-- V1: o cliente precisa já ter login no sistema (foundation exige user_id). Se o e-mail não tiver conta, a função
-- recusa com mensagem clara (a equipe cria o login do cliente antes). Idempotente: se já houver acesso ativo, devolve-o.
CREATE OR REPLACE FUNCTION public.fn_obra_cliente_acesso_conceder(
  p_obra_id uuid, p_email text, p_papel text DEFAULT 'cliente_obra'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_user uuid;
  v_email text := lower(trim(p_email));
  v_id uuid;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Informe o e-mail do cliente.' USING ERRCODE='22023';
  END IF;
  IF p_papel <> 'cliente_obra' THEN
    RAISE EXCEPTION 'Papel inválido para o portal do cliente.' USING ERRCODE='22023';
  END IF;

  SELECT o.company_id INTO v_company FROM public.projetos_obras o
   WHERE o.id = p_obra_id AND o.deleted_at IS NULL;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Obra não encontrada.' USING ERRCODE='P0002';
  END IF;
  IF NOT ((v_company IN (SELECT get_user_company_ids())) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para esta obra.' USING ERRCODE='42501';
  END IF;

  SELECT u.id INTO v_user FROM public.users u
   WHERE lower(u.email) = v_email AND u.is_active = true
   ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Nenhum login ativo com o e-mail %. Crie o acesso do cliente antes de convidá-lo ao portal.', v_email
      USING ERRCODE='P0002';
  END IF;

  -- idempotente: acesso ativo já existente
  SELECT a.id INTO v_id FROM public.erp_obra_cliente_acesso a
   WHERE a.obra_id = p_obra_id AND a.user_id = v_user AND a.revogado_em IS NULL
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.erp_obra_cliente_acesso
    (company_id, obra_id, user_id, email_convite, papel, convidado_por)
  VALUES (v_company, p_obra_id, v_user, v_email, 'cliente_obra', auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ───────────────────────── 3. REVOGAR acesso ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_cliente_acesso_revogar(p_acesso_id uuid, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_company uuid; v_ativo boolean;
BEGIN
  SELECT a.company_id, (a.revogado_em IS NULL) INTO v_company, v_ativo
  FROM public.erp_obra_cliente_acesso a WHERE a.id = p_acesso_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Acesso não encontrado.' USING ERRCODE='P0002';
  END IF;
  IF NOT ((v_company IN (SELECT get_user_company_ids())) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem permissão para este acesso.' USING ERRCODE='42501';
  END IF;
  IF NOT v_ativo THEN
    RETURN; -- já revogado: idempotente
  END IF;

  UPDATE public.erp_obra_cliente_acesso
     SET revogado_em = now(), revogado_por = auth.uid(),
         revogado_motivo = NULLIF(trim(coalesce(p_motivo,'')), '')
   WHERE id = p_acesso_id;
END;
$function$;

-- ───────────────────────── 4. GRANTS: só usuário autenticado; nunca anon ─────────────────────────
REVOKE ALL ON FUNCTION public.fn_obra_cliente_acesso_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_cliente_acesso_conceder(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_cliente_acesso_revogar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_cliente_acesso_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_cliente_acesso_conceder(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_cliente_acesso_revogar(uuid, text) TO authenticated;

-- ───────────────────────── 5. Ajuda de campo (RD-95) — "?" de cada campo/ação da tela ─────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub', 'publicado'
FROM (VALUES
 ('obra.portal.email_cliente', 'Convidar cliente', 'E-mail do cliente',
  'Digite o e-mail do login do cliente que vai acompanhar esta obra pelo portal.',
  'Liga o login do cliente a esta obra; a partir daí ele vê, só de leitura, o avanço, as fotos, as medições e as faturas desta obra — e de nenhuma outra.',
  'cliente@empresadele.com.br',
  'Convidar um e-mail que ainda não tem login no sistema: crie o acesso do cliente antes; o convite só liga uma conta que já existe.', 10, '/dashboard/projetos/obras/[id]/portal-cliente'),
 ('obra.portal.papel', 'Convidar cliente', 'Papel no portal',
  'O papel é sempre "Cliente da obra" — acesso somente leitura, restrito a esta obra.',
  'Deixa explícito que o convidado é cliente (não enxerga custo, margem nem obra de outro cliente) e só pode ver e aprovar revisões, nunca editar.',
  'Cliente da obra (leitura + aprovação de revisão).',
  'Esperar que o cliente edite dados: o portal é de acompanhamento; lançar medição ou RDO continua sendo da equipe.', 11, '/dashboard/projetos/obras/[id]/portal-cliente'),
 ('obra.portal.convidar_acao', 'Convidar cliente', 'Convidar',
  'Depois de digitar o e-mail, clique em Convidar para dar ao cliente o acesso ao portal desta obra.',
  'Cria o vínculo do cliente com a obra na hora; se o cliente já tiver acesso ativo, nada é duplicado.',
  'Convidar "cliente@empresadele.com.br" para a obra OBR-2026-0003.',
  'Clicar várias vezes achando que não funcionou: o convite é idempotente, não cria acesso repetido.', 12, '/dashboard/projetos/obras/[id]/portal-cliente'),
 ('obra.portal.lista_acessos', 'Acessos', 'Clientes com acesso',
  'Lista quem já tem (ou já teve) acesso ao portal desta obra, com a data do convite e quem convidou.',
  'Mostra, a qualquer momento, exatamente quais clientes enxergam esta obra — base para auditoria de LGPD.',
  'Dois clientes ativos e um revogado na semana passada.',
  'Confundir "revogado" com "excluído": o histórico fica registrado para rastreabilidade; revogar só tira o acesso, não apaga o registro.', 13, '/dashboard/projetos/obras/[id]/portal-cliente'),
 ('obra.portal.revogar_acao', 'Acessos', 'Revogar acesso',
  'Clique em Revogar para tirar o acesso de um cliente a esta obra; você pode registrar o motivo.',
  'Encerra na hora a visão do cliente sobre a obra (ex.: fim do contrato) mantendo o histórico de quem teve acesso e quando.',
  'Revogar o acesso ao encerrar a obra, com o motivo "obra entregue".',
  'Revogar sem necessidade: o cliente perde o acompanhamento imediatamente; use só quando o acesso deve mesmo terminar.', 14, '/dashboard/projetos/obras/[id]/portal-cliente'),
 ('projetos.cockpit.portal_cliente', 'Atalhos', 'Portal do cliente',
  'Abre a tela onde a equipe convida o cliente a acompanhar esta obra pelo portal (só leitura) e revoga o acesso quando necessário.',
  'É por aqui que o cliente passa a ver avanço, fotos, medições e faturas desta obra — e só desta obra.',
  'Convidar o cliente logo no início da obra para ele acompanhar sem precisar ligar pedindo status.',
  'Procurar o portal em outro menu: o acesso do cliente a cada obra é gerido aqui, dentro da própria obra.', 60, '/dashboard/projetos/obras/[id]/cockpit')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- ───────────────────────── 6. system_screens (a entrega só conta se o usuário enxerga a tela) ─────────────────────────
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real, auditada_ok)
VALUES (
  'projetos_obras_id_portal_cliente',
  '/dashboard/projetos/obras/[id]/portal-cliente',
  'projetos',
  'Portal do cliente — acesso',
  'Equipe da obra convida e revoga o acesso do cliente ao portal (somente leitura). Cada convite liga um login de cliente à obra, restrito por empresa (RLS); o cliente passa a ver avanço, fotos, medições e faturas desta obra pelo portal e nada de outra obra.',
  'hub',
  'ativo',
  false
)
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional, estado_real = EXCLUDED.estado_real;

-- ───────────────────────── 7. Seed DEMO: dar ao cliente DEMO uma obra para o portal mostrar ─────────────────────────
-- Vincula o usuário DEMO (auditor-pdca, só empresa DEMO 006) à obra DEMO-OB-003 (mesma empresa). Idempotente e
-- restrito à empresa DEMO — nunca toca cliente real. Serve para o portal (etapa c) ter dado na DEMO.
INSERT INTO public.erp_obra_cliente_acesso (company_id, obra_id, user_id, email_convite, papel, convidado_por)
SELECT o.company_id, o.id, u.id, u.email, 'cliente_obra', u.id
FROM public.projetos_obras o
CROSS JOIN public.users u
WHERE o.numero = 'DEMO-OB-003'
  AND o.company_id = 'b0700000-0000-4000-a000-000000000006'
  AND u.email = 'auditor-pdca@psgestao.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.erp_obra_cliente_acesso a
    WHERE a.obra_id = o.id AND a.user_id = u.id AND a.revogado_em IS NULL
  );
