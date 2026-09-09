-- ============================================================
-- Oficina · Papeis do dono e do mecanico + trava de valor na lista de OS (Wave B.1)
-- SPEC "Oficina · Papeis do dono e do mecanico" (09/09, Eng. Chefe).
-- Origem: Kleiton (dono do KGF) — "no usuario dos funcionarios ainda puxa os valores nas OS".
--
-- ESTA MIGRATION (B.1) faz o nucleo, generico para qualquer oficina:
--   1) Cria os papeis OFICINA_DONO e OFICINA_MECANICO no CHECK de tenant_user_roles
--      (papel_gestao = tenant_user_roles.role, lido por fn_oficina_papel / fn_acesso_efetivo).
--      Schema-only: INERTE ate o CEO atribuir os papeis (§6, fora deste arquivo, com "pode aplicar").
--   2) fn_oficina_os_listar: a lista de OS por RPC, que OMITE o valor (total) quando quem chama
--      e OFICINA_MECANICO. O front troca a leitura direta de erp_os por esta RPC.
--
-- RESIDUO DECLARADO (decisao do CEO — B agora, A depois; erp_contexto_projeto 72fcbdcf):
--   A trava e na RPC/no app, NAO na RLS. Depois desta migration, erp_os.total AINDA SAI do banco
--   por PostgREST direto (a RLS deixa a linha passar com a coluna). Um mecanico com o app aberto
--   NAO alcanca; alguem que saiba montar a chamada, SIM. O §3.3 do SPEC fica PARCIALMENTE atendido.
--   O endurecimento definitivo (mover o financeiro de erp_os para tabela-irma 1:1 com RLS que nega
--   o mecanico) e a ONDA A, planejada a parte (erp_os.total e lido em patio/OS/faturamento/comissao/
--   relatorios — mover exige repontar todos, refactor em producao).
--
-- FORA DESTA MIGRATION (ondas seguintes, declaradas): gating de valor no Diagnostico
-- (fn_oficina_diagnostico_obter) e na ficha (OrdemServicoCard); Comissao so a propria (O1);
-- esconder telas Aprovacao/WhatsApp/Financeiro/Comissao-cheia do mecanico; tela "Usuarios da
-- Oficina" para o dono convidar mecanicos (extensao de fn_acessos_convidar_pessoa/pode_gerir,
-- com OFICINA_DONO tratado como escalonamento — dono nao cria dono, O3).
-- ============================================================

-- 1) Papeis novos no CHECK (narrowing-safe: so ADICIONA valores; nao afeta as 4 linhas existentes)
ALTER TABLE public.tenant_user_roles DROP CONSTRAINT IF EXISTS tenant_user_roles_role_check;
ALTER TABLE public.tenant_user_roles ADD CONSTRAINT tenant_user_roles_role_check
  CHECK (role = ANY (ARRAY[
    'CLIENT_OWNER','CLIENT_MANAGER','CLIENT_OPERATOR','CLIENT_VIEWER',
    'OFICINA_DONO','OFICINA_MECANICO'
  ]::text[]));

-- 2) Lista de OS por RPC, com trava de valor para o mecanico.
--    Espelha a query atual (os/page.tsx): company_id, excluida, order by created_at desc, limit 200.
CREATE OR REPLACE FUNCTION public.fn_oficina_os_listar(
  p_company_id uuid,
  p_excluidas boolean DEFAULT false,
  p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_mecanico boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;

  -- fn_oficina_papel devolve o papel_gestao (tenant_user_roles.role) do usuario atual nesta empresa.
  v_mecanico := (public.fn_oficina_papel(p_company_id) = 'OFICINA_MECANICO');

  SELECT jsonb_build_object(
    'ok', true,
    'mecanico', v_mecanico,
    'itens', COALESCE(jsonb_agg(t ORDER BY (t->>'created_at') DESC), '[]'::jsonb)
  )
  INTO v FROM (
    SELECT jsonb_build_object(
      'id', o.id,
      'company_id', o.company_id,
      'numero', o.numero,
      'cliente_nome', o.cliente_nome,
      'equipamento', o.equipamento,
      'placa', o.placa,
      'modelo', o.modelo,
      'status', o.status,
      'data_abertura', o.data_abertura,
      'created_at', o.created_at,
      -- TRAVA DE VALOR (§3.3): o mecanico nunca recebe o total no payload.
      'total', CASE WHEN v_mecanico THEN NULL ELSE o.total END,
      -- "faturada" e status, nao valor — segue disponivel para os dois papeis.
      'faturada', (COALESCE(o.titulos_gerados, false) OR o.lancamento_id IS NOT NULL)
    ) AS t
    FROM erp_os o
    WHERE o.company_id = p_company_id
      AND o.excluida = p_excluidas
    ORDER BY o.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  ) s;

  RETURN v;
END $function$;
