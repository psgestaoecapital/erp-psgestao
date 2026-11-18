-- O vigia fn_menu_vazio_auditar acusava a GE (2 itens de INÍCIO vazando) de um usuário da FRIOESTE cuja
-- empresa NÃO tem acesso à GE (empresa_tem_acesso=false). Área bloqueada/sem acesso não é "cliente parado" —
-- o cliente parado de verdade é o que TEM acesso e mesmo assim vê o menu vazio. Correção cirúrgica: contar só
-- as áreas que a empresa tem acesso (fn_listar_areas_visiveis.empresa_tem_acesso). Único ganho de lógica no
-- CTE `reais`; todo o resto do corpo é idêntico à versão viva (conferido por diff).
--
-- Provado no dado (RD-38, read-only): rodando o corpo COM o filtro, total_achados cai de 1 → 0 (a linha
-- FRIOESTE/gestao_empresarial sai; nenhum achado novo aparece; as áreas reais da Frioeste — industrial e
-- compliance — têm empresa_tem_acesso=true e 13/21 itens). Não toca dado nem acesso de nenhuma empresa.
-- SENSÍVEL (CREATE OR REPLACE de função existente) → MERGE AUTORIZADO.

CREATE OR REPLACE FUNCTION public.fn_menu_vazio_auditar()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH pares AS (
    SELECT DISTINCT uc.company_id, uc.user_id
    FROM user_companies uc
    JOIN users u ON u.id = uc.user_id AND u.system_role IS NULL AND coalesce(u.is_active, true)
    JOIN companies c ON c.id = uc.company_id AND NOT coalesce(c.is_demo, false)
  ),
  reais AS (
    -- SÓ as áreas que a empresa TEM ACESSO: área bloqueada/sem acesso não é "cliente parado".
    SELECT p.company_id, p.user_id, v.area_slug area
    FROM pares p, LATERAL fn_listar_areas_visiveis(p.company_id, p.user_id) v
    WHERE v.empresa_tem_acesso = true
  ),
  demos AS (
    SELECT d.cid company_id, '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'::uuid user_id, d.area FROM (VALUES
      ('b0700000-0000-4000-a000-000000000001'::uuid, 'oficina'),
      ('b0700000-0000-4000-a000-000000000002'::uuid, 'pm'),
      ('b0700000-0000-4000-a000-000000000003'::uuid, 'revenda_veiculos'),
      ('b0700000-0000-4000-a000-000000000004'::uuid, 'gestao_empresarial'),
      ('b0700000-0000-4000-a000-000000000005'::uuid, 'compliance'),
      ('ded00000-0000-4000-a000-000000000001'::uuid, 'oficina')) AS d(cid, area)
    WHERE EXISTS (SELECT 1 FROM companies WHERE id = d.cid)
  ),
  contagem AS (
    SELECT 'cliente' tipo, r.*, (SELECT count(*) FROM fn_modulos_sidebar_por_area(r.area, r.company_id, r.user_id)) itens FROM reais r
    UNION ALL
    SELECT 'demo', d.*, (SELECT count(*) FROM fn_modulos_sidebar_por_area(d.area, d.company_id, d.user_id)) FROM demos d
  ),
  vazios AS (SELECT * FROM contagem WHERE itens < 3)  -- vazio ou quase (menor menu real hoje: 6 itens)
  SELECT jsonb_build_object(
    'ok', NOT EXISTS (SELECT 1 FROM vazios),
    'total_achados', (SELECT count(*) FROM vazios),
    'clientes', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('empresa', coalesce(c.nome_fantasia, c.razao_social), 'area', v.area, 'itens', v.itens)), '[]')
                   FROM vazios v JOIN companies c ON c.id = v.company_id WHERE v.tipo = 'cliente'),
    'demos', (SELECT coalesce(jsonb_agg(jsonb_build_object('empresa', coalesce(c.nome_fantasia, c.razao_social), 'area', v.area, 'itens', v.itens)), '[]')
                FROM vazios v JOIN companies c ON c.id = v.company_id WHERE v.tipo = 'demo'),
    'regra', 'Área que o usuário TEM ACESSO (empresa_tem_acesso) tem que ter menu (< 3 itens é achado). Menu vem só de módulo pago (tenant_subscriptions ativa). Área bloqueada/sem acesso não conta. Achado aqui = cliente parado.')
$function$;

-- ACL explícita (fail-closed): nunca anon; preserva o acesso vivo (só serviço/CI chama este auditor).
REVOKE ALL ON FUNCTION public.fn_menu_vazio_auditar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_menu_vazio_auditar() TO service_role;
