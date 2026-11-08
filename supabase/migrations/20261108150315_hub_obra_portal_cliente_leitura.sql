-- Portal do cliente da obra (H9) — ETAPA (c): LEITURA do que o cliente acompanha
-- META CEO 02/11 · Gestão de Obras · tela 296 (Portal do cliente da obra)
-- Code: dev7claudeps
--
-- A fundação (#3768: tabela erp_obra_cliente_acesso + fn_obra_portal_minhas_obras) e a gestão
-- (#4037: equipe convida/revoga) já estão na main. Esta migration adiciona SÓ as RPCs de LEITURA
-- do conteúdo da obra que o cliente (e a equipe, em prévia) enxerga: AVANÇO (cronograma), FOTOS do
-- RDO (diário) e MEDIÇÕES. Tudo somente leitura.
--
-- SEGURANÇA/LGPD (crítica): nenhuma RPC retorna obra de empresa/cliente de terceiro.
--   • fn_obra_portal_pode_ver(obra) é o ÚNICO conferidor de acesso, FAIL-CLOSED: libera só para
--     (a) cliente com acesso ativo (erp_obra_cliente_acesso por auth.uid(), revogado_em IS NULL),
--     (b) equipe da empresa dona da obra (get_user_company_ids) ou (c) admin. Sem login → nega.
--   • Cada RPC de leitura chama o conferidor ANTES de qualquer dado e levanta 42501 quando nega.
--   • Projeção só de acompanhamento: NUNCA custo/margem/custo_previsto — só o que é do cliente
--     (percentual de avanço, fotos/atividades do diário, valor da medição que é faturado a ele).
--   • STABLE + SECURITY DEFINER + search_path fixo; REVOKE anon; GRANT authenticated/service_role.
-- Aditiva: 4 funções novas; sem UPDATE/DELETE em dado de cliente real (seed só empresa DEMO).
--
-- NOTA (títulos/faturas): o blueprint H9 cita "faturas". Hoje não há tabela de título a receber
-- amarrada por obra_id (só erp_viagem_ge_titulo, específica de frete). A medição é o que o cliente
-- vê como valor faturável. A fatura/título a receber por obra fica para a próxima fatia, após o
-- Eng. Chefe confirmar a fonte do contas-a-receber da obra (RD-38: não supor a origem do dado).

-- ───────────────────────── 1) Conferidor de acesso — FAIL-CLOSED ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_portal_pode_ver(p_obra_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Sem login: nunca. (O portal exige usuário autenticado; não há link público.)
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF p_obra_id IS NULL THEN
    RETURN false;
  END IF;
  -- Admin da plataforma.
  IF public.is_admin() THEN
    RETURN true;
  END IF;
  -- Cliente convidado com acesso ATIVO a esta obra.
  IF EXISTS (
    SELECT 1 FROM public.erp_obra_cliente_acesso a
    WHERE a.obra_id = p_obra_id AND a.user_id = auth.uid() AND a.revogado_em IS NULL
  ) THEN
    RETURN true;
  END IF;
  -- Equipe da empresa DONA da obra (prévia do que o cliente vê).
  IF EXISTS (
    SELECT 1 FROM public.projetos_obras o
    WHERE o.id = p_obra_id
      AND o.company_id IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_pode_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_pode_ver(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_pode_ver(uuid) IS
  'Portal do cliente (H9): único conferidor de acesso à obra, fail-closed (cliente convidado ativo OU equipe da empresa dona OU admin). Base das RPCs de leitura do portal.';

-- ───────────────────────── 2) AVANÇO (cronograma) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_portal_avanco(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.fn_obra_portal_pode_ver(p_obra_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'obra_id', o.id,
    'numero', o.numero,
    'nome', o.nome,
    'status', o.status,
    'pct_conclusao', o.pct_conclusao,
    'data_inicio', o.data_inicio,
    'data_prevista_fim', o.data_prevista_fim,
    'tarefas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'nome', t.nome,
               'inicio', t.inicio,
               'fim', t.fim,
               'percentual', t.percentual
             ) ORDER BY t.ordem NULLS LAST, t.inicio NULLS LAST)
      FROM public.projetos_obra_tarefa t
      WHERE t.obra_id = o.id AND t.excluido_em IS NULL
    ), '[]'::jsonb)
  )
  INTO v
  FROM public.projetos_obras o
  WHERE o.id = p_obra_id AND o.deleted_at IS NULL;
  RETURN COALESCE(v, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_avanco(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_avanco(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_avanco(uuid) IS
  'Portal do cliente (H9): avanço da obra (percentual, datas e tarefas do cronograma). Sem custo. Guarda fail-closed por fn_obra_portal_pode_ver.';

-- ───────────────────────── 3) FOTOS do RDO (diário) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_portal_fotos(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.fn_obra_portal_pode_ver(p_obra_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'data') DESC), '[]'::jsonb)
  INTO v
  FROM (
    SELECT jsonb_build_object(
             'data', r.data,
             'clima', r.clima,
             'atividades', r.atividades,
             'fotos', COALESCE(to_jsonb(r.fotos), '[]'::jsonb)
           ) AS x
    FROM public.projetos_obra_rdo r
    WHERE r.obra_id = p_obra_id
      AND r.excluido_em IS NULL
      AND r.fotos IS NOT NULL
      AND array_length(r.fotos, 1) > 0
    ORDER BY r.data DESC
    LIMIT 60
  ) s;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_fotos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_fotos(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_fotos(uuid) IS
  'Portal do cliente (H9): fotos e atividades do diário de obra (RDO). Só diários com foto. Guarda fail-closed por fn_obra_portal_pode_ver.';

-- ───────────────────────── 4) MEDIÇÕES ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_portal_medicoes(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.fn_obra_portal_pode_ver(p_obra_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero', m.numero,
           'competencia', m.competencia,
           'status', m.status,
           'valor_total', m.valor_total,
           'aprovada_em', m.aprovada_em
         ) ORDER BY m.numero DESC), '[]'::jsonb)
  INTO v
  FROM public.projetos_obra_medicao m
  WHERE m.obra_id = p_obra_id AND m.excluido_em IS NULL;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_obra_portal_medicoes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_portal_medicoes(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_obra_portal_medicoes(uuid) IS
  'Portal do cliente (H9): medições da obra (número, competência, status, valor faturável). Sem custo/margem. Guarda fail-closed por fn_obra_portal_pode_ver.';

-- ───────────────────────── 5) Ajuda de campo (RD-95) — "?" da prévia do portal ─────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub', 'publicado'
FROM (VALUES
 ('obra.portal.previa', 'Prévia do portal', 'Prévia do que o cliente vê',
  'Nada a preencher: é a visão de leitura idêntica à que o cliente convidado enxerga no portal desta obra.',
  'Deixa a equipe conferir, antes de convidar, exatamente o que o cliente vai acompanhar — avanço, fotos e medições — sem custo nem margem.',
  'Abrir a prévia e confirmar que o percentual e as fotos estão como você quer que o cliente veja.',
  'Achar que o cliente vê mais do que isto: o portal é só leitura e só desta obra; custo e margem nunca aparecem.', 20, '/dashboard/projetos/obras/[id]/portal-cliente'),
 ('obra.portal.avanco', 'Prévia do portal', 'Avanço da obra',
  'Percentual de conclusão e as tarefas do cronograma (início, fim e andamento de cada uma).',
  'Mostra ao cliente, de forma simples, o quanto a obra avançou e o que está em cada etapa — sem precisar ligar pedindo status.',
  'Obra em 62%; fundação 100%, estrutura 40%.',
  'Esperar valores financeiros aqui: esta visão é só de andamento físico; custo não entra no portal do cliente.', 21, '/dashboard/projetos/obras/[id]/portal-cliente'),
 ('obra.portal.fotos', 'Prévia do portal', 'Fotos do diário',
  'As fotos registradas no diário de obra (RDO), com a data e as atividades do dia.',
  'Dá ao cliente a evidência visual do andamento, dia a dia, do jeito que a equipe registrou no diário.',
  'Fotos da concretagem de 03/11 com a atividade "concretagem do radier".',
  'Procurar aqui fotos que não foram lançadas no RDO: o portal mostra só o que a equipe registrou no diário.', 22, '/dashboard/projetos/obras/[id]/portal-cliente'),
 ('obra.portal.medicoes', 'Prévia do portal', 'Medições',
  'As medições da obra: número, competência, situação e o valor medido no período.',
  'Mostra ao cliente o que foi medido e o valor correspondente — base do que será faturado — de forma transparente.',
  'Medição 3, competência 11/2026, aprovada, R$ 84.500,00.',
  'Confundir medição com nota fiscal: a medição é o quanto foi executado/aprovado; a fatura/NF é um passo seguinte.', 23, '/dashboard/projetos/obras/[id]/portal-cliente')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- ───────────────────────── 6) Seed DEMO: dar conteúdo ao portal na obra DEMO-OB-003 ─────────────────────────
-- A gestão (#4037) já vinculou o cliente DEMO (auditor-pdca) à obra DEMO-OB-003 (empresa DEMO 006).
-- Aqui damos a ela FOTOS de RDO e uma MEDIÇÃO para a prévia/portal ter o que mostrar na DEMO.
-- Idempotente e restrito à empresa DEMO (is_demo) — NUNCA toca cliente real.

-- 6a) Dois diários com foto (placeholder) se ainda não houver RDO com foto nesta obra DEMO.
-- os_id é NOT NULL (FK -> projetos_obra_os): amarra o diário a uma OS real da própria obra DEMO.
-- clima respeita o CHECK (sol|nublado|chuva|chuva_forte). Se a obra DEMO não tiver OS, pula (não força).
INSERT INTO public.projetos_obra_rdo (company_id, obra_id, os_id, data, clima, praticavel, efetivo, atividades, fotos)
SELECT o.company_id, o.id,
       (SELECT os.id FROM public.projetos_obra_os os
         WHERE os.obra_id = o.id AND os.excluido_em IS NULL AND os.status <> 'cancelada'
         ORDER BY os.criado_em ASC LIMIT 1),
       d.data, 'sol', true, d.efetivo, d.atividades, d.fotos
FROM public.projetos_obras o
JOIN public.companies c ON c.id = o.company_id AND c.is_demo = true
CROSS JOIN (VALUES
  (CURRENT_DATE - 3, 8, 'Concretagem do contrapiso da expedição.',
     ARRAY['https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=900','https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=900']::text[]),
  (CURRENT_DATE - 1, 6, 'Montagem das divisórias e forro da câmara fria.',
     ARRAY['https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=900']::text[])
) AS d(data, efetivo, atividades, fotos)
WHERE o.numero = 'DEMO-OB-003'
  AND o.company_id = 'b0700000-0000-4000-a000-000000000006'
  AND EXISTS (
    SELECT 1 FROM public.projetos_obra_os os
    WHERE os.obra_id = o.id AND os.excluido_em IS NULL AND os.status <> 'cancelada'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.projetos_obra_rdo r
    WHERE r.obra_id = o.id AND r.excluido_em IS NULL
      AND r.fotos IS NOT NULL AND array_length(r.fotos, 1) > 0
  );

-- 6b) Uma medição aprovada, se ainda não houver medição nesta obra DEMO.
INSERT INTO public.projetos_obra_medicao (company_id, obra_id, numero, tipo, competencia, status, valor_total, aprovada_em)
-- tipo respeita o CHECK (percentual|quantidade); status aprovada é válido.
SELECT o.company_id, o.id, 1, 'percentual', date_trunc('month', CURRENT_DATE)::date, 'aprovada', 84500.00, now()
FROM public.projetos_obras o
JOIN public.companies c ON c.id = o.company_id AND c.is_demo = true
WHERE o.numero = 'DEMO-OB-003'
  AND o.company_id = 'b0700000-0000-4000-a000-000000000006'
  AND NOT EXISTS (
    SELECT 1 FROM public.projetos_obra_medicao m
    WHERE m.obra_id = o.id AND m.excluido_em IS NULL
  );
