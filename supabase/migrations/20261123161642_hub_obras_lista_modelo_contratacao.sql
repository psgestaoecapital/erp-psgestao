-- PDCA Hub · /dashboard/projetos/obras (aud8 94/95, matriz #3876) · §314 (blueprint tela_num 314)
-- code-desenvolvedor-3 · RD-38 (provado no dado) · RD-95 ("?") · RD-98 (não altera o CRUD da lista) · aditivo.
--
-- GAP (critério h): a LISTA/cards de obras não expunha o MODELO DE CONTRATAÇÃO nem distinguia
-- obra PRÓPRIA × GERENCIADA (proprietário × contratante). Os dados JÁ existem em projetos_obras
-- (colunas modelo_contratacao e tipo_execucao — ficha da obra, migrations 20261123013145 /155045);
-- só faltava a função de leitura da lista (fn_obras_listar) devolvê-los para o card.
--
-- fn_obras_listar é função de LEITURA (SQL STABLE SECURITY DEFINER). Acrescentar colunas ao RETURNS TABLE
-- exige DROP + CREATE (não dá CREATE OR REPLACE mudando o tipo de retorno). Corpo idêntico ao vivo + 2 colunas.
-- Guarda preservada: filtra por empresa do usuário (company_id IN get_user_company_ids()) e deleted_at IS NULL;
-- grants preservados (authenticated + service_role EXECUTE); REVOKE anon. É SENSÍVEL (CREATE de função existente)
-- → PR leva revisao-eng-chefe e espera MERGE AUTORIZADO.

DROP FUNCTION IF EXISTS public.fn_obras_listar(uuid[], text);

CREATE FUNCTION public.fn_obras_listar(p_company_ids uuid[], p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, numero text, nome text, cliente_nome text, status text, valor_previsto numeric,
   pct_conclusao integer, cidade text, uf text, responsavel_nome text, data_inicio date,
   data_prevista_fim date, data_conclusao date, modelo_contratacao text, tipo_execucao text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id, o.numero, o.nome, o.cliente_nome, o.status, o.valor_previsto, o.pct_conclusao,
         o.cidade, o.uf, o.responsavel_nome, o.data_inicio, o.data_prevista_fim, o.data_conclusao,
         o.modelo_contratacao, o.tipo_execucao
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids) AND o.company_id IN (SELECT get_user_company_ids())
     AND o.deleted_at IS NULL
     AND (p_status IS NULL OR o.status = p_status)
   ORDER BY CASE o.status WHEN 'em_andamento' THEN 0 WHEN 'pausada' THEN 1 WHEN 'concluida' THEN 2 ELSE 3 END,
     o.data_inicio DESC NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.fn_obras_listar(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_listar(uuid[], text) TO authenticated, service_role;

-- ── RD-95: "?" do selo de contratação e do filtro novo na lista de obras ──
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.obras.selo_contratacao','/dashboard/projetos/obras','Obras','Modelo de contratação',
  'Etiqueta no card que mostra se a obra é PRÓPRIA (sua empresa é a dona) ou GERENCIADA para um contratante, e o modelo do contrato (administração, empreitada global ou por preço unitário).',
  'Identifica de relance o papel da sua empresa na obra e como o financeiro dela é tratado — sem abrir a ficha.',
  'Gerenciada · Empreitada global · p/ contratante',
  'Confundir obra própria (sua empresa é a proprietária) com obra gerenciada (você executa/gerencia para um contratante).',
  'projetos',310,'publicado'),
 ('projetos.obras.filtro_execucao','/dashboard/projetos/obras','Obras','Filtrar por tipo de obra',
  'Filtra a lista por tipo de obra: Próprias (da sua empresa) ou Gerenciadas (para terceiros).',
  'Separa rapidamente as obras que são patrimônio da empresa das que você só executa/gerencia para um contratante.',
  'Gerenciadas',
  'Esperar ver todas: com o filtro ativo só aparecem as do tipo escolhido — limpe o filtro para ver tudo.',
  'projetos',315,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- ── Blueprint §314: a lista passa a cobrir (parcial) os requisitos de modelo de contratação / própria × gerenciada.
-- Captura/edição completa segue na ficha e em /obras/nova; aqui é a EXIBIÇÃO na lista. Idempotente (NOT EXISTS). ──
INSERT INTO public.blueprint_tela_cobertura (requisito_id, status, evidencia, avaliado_em)
SELECT v.rid::uuid, 'parcial', v.ev, now()
FROM (VALUES
  ('0bbdfa1f-c804-4f70-b0be-e9227576cc39',
   'Lista /dashboard/projetos/obras passa a exibir o selo do MODELO DE CONTRATACAO (administracao/empreitada global/empreitada por preco unitario) em cada card (code-desenvolvedor-3). Captura/edicao segue na ficha e em /obras/nova.'),
  ('1dd6b44a-a1c0-4b76-99a9-5f34a14bf5e5',
   'Lista /dashboard/projetos/obras distingue PROPRIA x GERENCIADA (tipo_execucao) por selo no card e permite FILTRAR por esse tipo.'),
  ('44e993ba-4a43-4da3-9e56-837b963cef5d',
   'Card da lista exibe o PAPEL inferido: proprietario quando a obra e propria; para contratante (cliente) quando gerenciada. Separacao completa dos 4 papeis segue na ficha/nova.')
) AS v(rid, ev)
WHERE NOT EXISTS (
  SELECT 1 FROM public.blueprint_tela_cobertura c
  WHERE c.requisito_id = v.rid::uuid AND c.evidencia = v.ev
);
