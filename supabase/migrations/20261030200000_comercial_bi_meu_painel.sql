-- Comercial › BI do vendedor ("Meu painel") — CEO 29/10/2026 09:55, com a diretora comercial e a equipe da Frioeste:
-- "o BI precisa ser genérico, não exclusivo Frioeste; se conectar TOTVS, abastece da mesma forma. Liberar o acesso
--  para todos os vendedores e cada um ver somente os dados dele, no celular ou no notebook."
--
-- Camadas (núcleo comum, sem nome de sistema nem de vertical):
--  1) fn_com_venda_item(company, de, ate)  — TRADUTOR: entrega a venda por item num formato único. Hoje lê o ATAK
--     (ind_atak_fato, domínio comercial_venda_item). Outro ERP (TOTVS, Sankhya, SAP) = mais um ramo UNION ALL aqui,
--     com as mesmas colunas; o BI não muda.
--  2) fn_com_equipe(company)               — TRADUTOR da hierarquia comercial (gerente → supervisor → vendedor).
--  3) com_vendedor_acesso                  — vínculo usuário do PS Gestão ↔ código do vendedor/supervisor/gerente
--     no ERP de origem. Quem tem vínculo vê SÓ a própria subárvore (trava no banco, não na tela).
--  4) fn_bi_comercial_painel(...)          — a única porta da tela: guarda de empresa + escopo pelo vínculo.
--  5) fn_com_vendedor_acesso_listar/_salvar — Administração › Vendedores (só quem administra a empresa).
--
-- Aditiva: 1 tabela nova (RLS, sem acesso direto de escrita) + funções novas. Não recria função existente, não
-- altera nem apaga dado de cliente.

CREATE TABLE IF NOT EXISTS public.com_vendedor_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  codigo text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_com_vendedor_acesso_codigo ON public.com_vendedor_acesso (company_id, codigo);
ALTER TABLE public.com_vendedor_acesso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS com_vendedor_acesso_ler ON public.com_vendedor_acesso;
CREATE POLICY com_vendedor_acesso_ler ON public.com_vendedor_acesso FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin() OR public.fn_owner_pode_gerir_escopo(company_id));
REVOKE ALL ON public.com_vendedor_acesso FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.com_vendedor_acesso FROM authenticated;

-- 1) Tradutor da venda por item (formato único). Ramo ATAK.
CREATE OR REPLACE FUNCTION public.fn_com_venda_item(p_company_id uuid, p_de date, p_ate date)
RETURNS TABLE (origem text, dia date, nota text, vendedor text, cliente_cod text, cliente text, cidade text,
  produto_cod text, produto text, linha text, carne boolean, kg numeric, valor numeric, valor_tabela numeric,
  abaixo_tabela boolean, carga text, transportador text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT 'atak'::text,
    left(f.raw->>'DATA_MOVTO', 10)::date,
    f.raw->>'CHAVE_FATO',
    coalesce(nullif(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v'),
    trim(f.raw->>'COD_CLI_FOR'),
    left(trim(f.raw->>'NOME_CADASTRO'), 40),
    initcap(trim(f.raw->>'CIDADE')) || '/' || trim(f.raw->>'UF'),
    trim(f.raw->>'COD_PRODUTO'),
    left(trim(f.raw->>'DESC_PRODUTO_NF'), 40),
    split_part(f.raw->>'DESC_DIVISAO', ' - ', 1),
    (left(f.raw->>'DESC_DIVISAO', 5) = 'CARNE' OR left(f.raw->>'DESC_DIVISAO', 6) = 'MIUDOS'),
    CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG' THEN (f.raw->>'QTDE_PRI')::numeric ELSE 0 END,
    (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric,
    CASE WHEN (f.raw->>'VALOR_UNITARIO_LISTA')::numeric > 0
         THEN (f.raw->>'VALOR_UNITARIO_LISTA')::numeric * (f.raw->>'QTDE_UND')::numeric
         ELSE (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric END,
    (f.raw->>'VALOR_UNITARIO')::numeric < (f.raw->>'VALOR_UNITARIO_LISTA')::numeric,
    nullif(trim(f.raw->>'NUM_CARGA'), ''),
    coalesce(nullif(trim(f.raw->>'NOME_TRANSPORTADOR'), ''), 'Sem transportador')
  FROM public.ind_atak_fato f
  WHERE f.company_id = p_company_id AND f.dominio = 'comercial_venda_item'
    AND trim(f.raw->>'STATUS') <> 'C'
    AND trim(f.raw->>'COD_PRODUTO') <> '10'
    AND left(f.raw->>'DATA_MOVTO', 10) >= to_char(p_de, 'YYYY-MM-DD')
    AND left(f.raw->>'DATA_MOVTO', 10) <= to_char(p_ate, 'YYYY-MM-DD')
  -- Próximo ERP (ex.: TOTVS): UNION ALL SELECT 'totvs', ... com as mesmas colunas.
$fn$;

-- 2) Tradutor da hierarquia comercial. Ramo ATAK.
CREATE OR REPLACE FUNCTION public.fn_com_equipe(p_company_id uuid)
RETURNS TABLE (codigo text, nome text, cargo text, superior text, ordem text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT DISTINCT ON (trim(f.raw->>'Cod_cadastro'))
    trim(f.raw->>'Cod_cadastro'),
    CASE WHEN translate(trim(f.raw->>'Apelido'), '0123456789', '') = ''
         THEN trim(f.raw->>'Cargo') || ' ' || trim(f.raw->>'Cod_cadastro')
         ELSE initcap(trim(f.raw->>'Apelido')) END,
    trim(f.raw->>'Cargo'),
    CASE WHEN trim(f.raw->>'Subordinado_a') = trim(f.raw->>'Cod_cadastro') THEN NULL ELSE trim(f.raw->>'Subordinado_a') END,
    trim(f.raw->>'Nivel')
  FROM public.ind_atak_fato f
  WHERE f.company_id = p_company_id AND f.dominio = 'comercial_hierarquia'
  ORDER BY trim(f.raw->>'Cod_cadastro'), f.imported_at DESC
$fn$;

REVOKE ALL ON FUNCTION public.fn_com_venda_item(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_com_equipe(uuid) FROM PUBLIC, anon, authenticated;

-- 4) A porta da tela.
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_painel(p_company_id uuid, p_no text DEFAULT NULL, p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_raiz text; v_no text; v_vinculo text; v_role text; v_ate date; v_de date;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- Escopo: quem tem vínculo vê só a própria subárvore; sem vínculo, só quem dirige a empresa vê tudo.
  SELECT a.codigo INTO v_vinculo FROM com_vendedor_acesso a WHERE a.company_id = p_company_id AND a.user_id = v_uid AND a.ativo;
  IF v_vinculo IS NOT NULL THEN
    v_raiz := v_vinculo;
  ELSE
    SELECT uc.role INTO v_role FROM user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = v_uid LIMIT 1;
    IF public.is_admin() OR public.fn_owner_pode_gerir_escopo(p_company_id)
       OR v_role IN ('owner','socio','acesso_total','adm','admin','diretor','diretor_area','gerente') THEN
      v_raiz := 'empresa';
    ELSE
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_vinculo_vendedor',
        'mensagem', 'Seu usuário ainda não está ligado a um código de vendedor. Peça ao administrador em Administração › Vendedores.');
    END IF;
  END IF;

  v_ate := coalesce(p_ate, current_date);
  v_de := coalesce(p_de, v_ate - 29);

  WITH RECURSIVE eq AS (SELECT * FROM fn_com_equipe(p_company_id)),
  sub(no, cod) AS (SELECT codigo, codigo FROM eq UNION SELECT s.no, e.codigo FROM sub s JOIN eq e ON e.superior = s.cod),
  v AS (SELECT * FROM fn_com_venda_item(p_company_id, v_de, v_ate)),
  nv AS (SELECT 'empresa'::text AS no, vendedor AS ven FROM (SELECT DISTINCT vendedor FROM v) x UNION SELECT no, cod FROM sub),
  -- nós que esta pessoa pode abrir: a raiz e tudo abaixo dela
  perm AS (SELECT 'empresa'::text AS no WHERE v_raiz = 'empresa'
           UNION SELECT e.codigo FROM eq e WHERE v_raiz = 'empresa'
           UNION SELECT s.cod FROM sub s WHERE s.no = v_raiz),
  alvo AS (SELECT CASE WHEN p_no IS NOT NULL AND p_no IN (SELECT no FROM perm) THEN p_no ELSE v_raiz END AS no),
  va AS (SELECT v.* FROM v JOIN nv ON nv.ven = v.vendedor WHERE nv.no = (SELECT no FROM alvo)),
  tot AS (SELECT sum(valor) AS val, sum(valor_tabela) AS lista, count(*) AS itens, sum(abaixo_tabela::int) AS ab,
                 sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco FROM v),
  porven AS (SELECT vendedor, sum(valor) AS val FROM v WHERE vendedor <> 's/v' GROUP BY vendedor),
  cli AS (SELECT cliente_cod, max(cliente) AS cliente, max(cidade) AS cidade, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT nota) AS notas,
                 sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco FROM va GROUP BY cliente_cod)
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'escopo', jsonb_build_object('raiz', v_raiz, 'no', (SELECT no FROM alvo), 'restrito', v_vinculo IS NOT NULL),
    'nos', (SELECT coalesce(jsonb_agg(jsonb_build_object('no', x.no, 'nome', x.nome, 'cargo', x.cargo, 'pai', x.pai, 'ordem', x.ordem) ORDER BY x.ordem), '[]'::jsonb) FROM (
              SELECT 'empresa' AS no, 'Toda a empresa' AS nome, 'Empresa' AS cargo, NULL AS pai, '0' AS ordem WHERE v_raiz = 'empresa'
              UNION ALL SELECT e.codigo, e.nome, e.cargo, coalesce(e.superior, 'empresa'), e.ordem FROM eq e WHERE e.codigo IN (SELECT no FROM perm)) x),
    'resumo', (SELECT jsonb_build_object(
        'val', round(coalesce(sum(valor), 0), 2), 'kg', round(coalesce(sum(kg), 0), 1),
        'preco_kg', round(sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0), 2),
        'desc_pct', round(100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0), 2),
        'desconto', round(coalesce(sum(valor_tabela) - sum(valor), 0), 2),
        'pct_abaixo', round(100.0 * sum(abaixo_tabela::int) / nullif(count(*), 0), 1),
        'clientes', count(DISTINCT cliente_cod), 'notas', count(DISTINCT nota),
        'ticket', round(sum(valor) / nullif(count(DISTINCT nota), 0), 0), 'produtos', count(DISTINCT produto_cod)) FROM va),
    'referencia', (SELECT jsonb_build_object('desc_pct', round(100 * (lista - val) / nullif(lista, 0), 2),
        'pct_abaixo', round(100.0 * ab / nullif(itens, 0), 1), 'preco_kg', round(preco, 2)) FROM tot),
    'posicao', (SELECT CASE WHEN (SELECT no FROM alvo) IN (SELECT vendedor FROM porven)
        THEN jsonb_build_object('lugar', (SELECT count(*) + 1 FROM porven p2 WHERE p2.val > (SELECT val FROM porven p1 WHERE p1.vendedor = (SELECT no FROM alvo))),
                                'de', (SELECT count(*) FROM porven)) END),
    'dia', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'val', round(val, 2), 'kg', round(kg, 1), 'notas', notas) ORDER BY dia), '[]'::jsonb)
            FROM (SELECT dia, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT nota) AS notas FROM va GROUP BY dia) d),
    'clientes', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', cliente_cod, 'cliente', cliente, 'cidade', cidade, 'val', round(val, 2),
                 'kg', round(kg, 1), 'notas', notas, 'preco_kg', round(preco, 2)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT * FROM cli ORDER BY val DESC LIMIT 10) c),
    'produtos', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', produto_cod, 'produto', produto, 'val', round(val, 2), 'kg', round(kg, 1),
                 'preco_kg', round(preco, 2), 'pct_abaixo', round(pa, 1)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT produto_cod, max(produto) AS produto, sum(valor) AS val, sum(kg) AS kg,
                         sum(valor) FILTER (WHERE kg > 0) / nullif(sum(kg), 0) AS preco, 100.0 * sum(abaixo_tabela::int) / count(*) AS pa
                  FROM va GROUP BY produto_cod ORDER BY sum(valor) DESC LIMIT 10) p),
    'cede_mais', (SELECT coalesce(jsonb_agg(produto ORDER BY n DESC), '[]'::jsonb) FROM (
            SELECT max(produto) AS produto, count(*) AS n FROM va GROUP BY produto_cod
            HAVING count(*) >= 3 AND sum(abaixo_tabela::int) = count(*) ORDER BY count(*) DESC LIMIT 4) c),
    'equipe', (SELECT coalesce(jsonb_agg(jsonb_build_object('ven', ven, 'nome', nome, 'val', round(val, 2), 'kg', round(kg, 1),
                 'desc_pct', round(dp, 2), 'pct_abaixo', round(pa, 1), 'clientes', cl) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT va.vendedor AS ven, coalesce(max(e.nome), 'Vendedor ' || va.vendedor) AS nome, sum(valor) AS val, sum(kg) AS kg,
                         100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0) AS dp,
                         100.0 * sum(abaixo_tabela::int) / count(*) AS pa, count(DISTINCT cliente_cod) AS cl
                  FROM va LEFT JOIN eq e ON e.codigo = va.vendedor
                  WHERE (SELECT no FROM alvo) NOT IN (SELECT vendedor FROM porven) OR va.vendedor = (SELECT no FROM alvo)
                  GROUP BY va.vendedor) q)
  ) INTO v_out;
  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_painel(uuid, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_painel(uuid, text, date, date) TO authenticated;

-- 5) Administração › Vendedores: quem administra a empresa liga cada usuário ao código dele no ERP de origem.
CREATE OR REPLACE FUNCTION public.fn_com_vendedor_acesso_pode(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (public.is_admin() OR public.fn_owner_pode_gerir_escopo(p_company_id)
    OR EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid()
               AND uc.role IN ('owner','socio','adm','admin','acesso_total')));
$fn$;
REVOKE ALL ON FUNCTION public.fn_com_vendedor_acesso_pode(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_vendedor_acesso_pode(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_com_vendedor_acesso_listar(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.fn_com_vendedor_acesso_pode(p_company_id) THEN RAISE EXCEPTION 'Só quem administra a empresa' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'equipe', (SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', e.codigo, 'nome', e.nome, 'cargo', e.cargo, 'superior', e.superior,
                 'user_id', a.user_id, 'ativo', a.ativo, 'usuario', coalesce(u.full_name, u.email), 'email', u.email) ORDER BY e.ordem), '[]'::jsonb)
               FROM public.fn_com_equipe(p_company_id) e
               LEFT JOIN public.com_vendedor_acesso a ON a.company_id = p_company_id AND a.codigo = e.codigo
               LEFT JOIN public.users u ON u.id = a.user_id),
    'usuarios', (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', u.id, 'nome', coalesce(u.full_name, u.email), 'email', u.email, 'papel', uc.role)
                 ORDER BY coalesce(u.full_name, u.email)), '[]'::jsonb)
               FROM public.user_companies uc JOIN public.users u ON u.id = uc.user_id WHERE uc.company_id = p_company_id));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_com_vendedor_acesso_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_vendedor_acesso_listar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_com_vendedor_acesso_salvar(p_company_id uuid, p_codigo text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.fn_com_vendedor_acesso_pode(p_company_id) THEN RAISE EXCEPTION 'Só quem administra a empresa' USING ERRCODE = '42501'; END IF;
  IF p_codigo IS NULL OR NOT EXISTS (SELECT 1 FROM public.fn_com_equipe(p_company_id) e WHERE e.codigo = p_codigo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'codigo_inexistente');
  END IF;
  -- desliga quem estava neste código (o código passa a ter um único usuário)
  UPDATE public.com_vendedor_acesso SET ativo = false, atualizado_em = now(), atualizado_por = v_uid
   WHERE company_id = p_company_id AND codigo = p_codigo AND ativo AND user_id IS DISTINCT FROM p_user_id;
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'acao', 'desvinculado'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'usuario_fora_da_empresa');
  END IF;
  INSERT INTO public.com_vendedor_acesso (company_id, user_id, codigo, ativo, criado_por, atualizado_por)
  VALUES (p_company_id, p_user_id, p_codigo, true, v_uid, v_uid)
  ON CONFLICT (company_id, user_id) DO UPDATE SET codigo = EXCLUDED.codigo, ativo = true, atualizado_em = now(), atualizado_por = v_uid;
  RETURN jsonb_build_object('ok', true, 'acao', 'vinculado');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_com_vendedor_acesso_salvar(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_vendedor_acesso_salvar(uuid, text, uuid) TO authenticated;

-- Menu (todas as empresas que vendem produto; a trava de dados é a RPC) e telas (RD-50).
-- Pai da FK module_catalog_subgrupo_fkey (deploy-migrations vermelho 29/10: 23503, subgrupo 'comercial' inexistente).
INSERT INTO public.module_subgrupos (id, label, ativo, ordem)
VALUES ('comercial', 'Comercial', true, 99)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, is_shared, subgrupo, rbac_isento, rbac_isento_motivo, so_ps)
VALUES ('comercial_meu_painel', 'Meu painel de vendas', 'industrial', 'BarChart3', '/dashboard/comercial/meu-painel', 190, true,
        'BI comercial em cascata: cada vendedor vê só a própria venda; supervisor a equipe; diretoria tudo.', true, 'comercial', true,
        'Dados travados pela fn_bi_comercial_painel (vínculo do usuário com o código de vendedor).', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES
 ('comercial_meu_painel', '/dashboard/comercial/meu-painel', 'industria', 'comercial_meu_painel', 'Meu painel de vendas',
  'BI comercial em cascata (empresa → gerente → supervisor → vendedor), genérico por ERP de origem; cada vendedor vê só os próprios dados.',
  'parcial', 'alta', ARRAY['fn_bi_comercial_painel']::text[], ARRAY['MeuPainelVendas']::text[], ARRAY[]::text[]),
 ('admin_vendedores', '/dashboard/admin/vendedores', 'admin', 'admin_vendedores', 'Vendedores (acesso ao painel)',
  'Liga cada usuário ao código de vendedor/supervisor/gerente do ERP de origem, definindo o que ele vê no Meu painel de vendas.',
  'parcial', 'alta', ARRAY['fn_com_vendedor_acesso_listar','fn_com_vendedor_acesso_salvar']::text[], ARRAY[]::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

-- "?" (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Meu painel de vendas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'comercial', 'publicado'
FROM (VALUES
 ('com.painel.visao', 'Visão', 'Escolha de quem ver os números: você mesmo ou alguém da sua equipe.', 'Vendedor vê só a própria venda; supervisor desce para cada vendedor da equipe; diretoria vê a empresa toda.', 'Supervisor escolhe "Vendedor 80006".', 'Procurar outro vendedor sendo vendedor: cada um vê só o seu.', 1, '/dashboard/comercial/meu-painel'),
 ('com.painel.periodo', 'Período', 'Escolha o intervalo de datas das notas de venda.', 'Todos os números da tela usam esse período.', '"30 dias" = do dia de hoje até 29 dias antes.', 'Comparar períodos de tamanhos diferentes.', 2, '/dashboard/comercial/meu-painel'),
 ('com.painel.faturado', 'Faturado', 'Indicador calculado.', 'Soma do valor líquido das notas fiscais de venda no período (sem canceladas).', 'R$ 437 mil em 112 notas.', 'Confundir com pedido: aqui só entra nota emitida.', 3, '/dashboard/comercial/meu-painel'),
 ('com.painel.volume', 'Volume', 'Indicador calculado.', 'Peso vendido em kg (toneladas) no período.', '14,8 t.', 'Produto vendido por peça ou saco não entra no peso.', 4, '/dashboard/comercial/meu-painel'),
 ('com.painel.preco', 'Preço médio da carne', 'Indicador calculado.', 'Valor vendido de carne e miúdos dividido pelos kg vendidos. Couro e despojos ficam fora para não distorcer.', 'R$ 29,60 por kg.', 'Comparar com a tabela de outro mês.', 5, '/dashboard/comercial/meu-painel'),
 ('com.painel.desconto', 'Desconto sobre a tabela', 'Indicador calculado.', 'Quanto o preço praticado ficou abaixo do preço de tabela, em % do valor de tabela, e quantos itens saíram abaixo dela.', '1,92% = R$ 8,6 mil concedidos; 85,7% dos itens abaixo da tabela.', 'Achar que desconto pequeno é bom: se for em quase todo item, soma muito no mês.', 6, '/dashboard/comercial/meu-painel'),
 ('com.painel.posicao', 'Posição na equipe', 'Indicador calculado.', 'Sua colocação em faturamento entre os vendedores da empresa, sem mostrar os números dos colegas.', '2º entre 9.', 'Comparar só o ranking: olhe também preço e desconto.', 7, '/dashboard/comercial/meu-painel'),
 ('com.painel.meta', 'Meta', 'Cadastrada no ERP de origem por vendedor e produto.', 'Mostra realizado contra meta e quanto falta por dia útil.', 'Meta de 20 t no mês.', 'Sem meta no ERP de origem, o quadro fica vazio.', 8, '/dashboard/comercial/meu-painel'),
 ('com.vendedores.vinculo', 'Usuário do vendedor', 'Escolha o usuário do PS Gestão de cada vendedor, supervisor ou gerente.', 'Define o que cada pessoa vê no Meu painel de vendas: o próprio código e tudo abaixo dele na equipe.', 'Usuário joao@empresa.com → Vendedor 80006.', 'Ligar o usuário ao código errado: ele passa a ver a venda de outro vendedor.', 1, '/dashboard/admin/vendedores')
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
ON CONFLICT (chave) DO NOTHING;
