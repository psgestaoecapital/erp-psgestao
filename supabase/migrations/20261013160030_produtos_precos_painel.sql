-- GE · Precificação / Markup na tela de Produtos — ENTREGA 1 (CEO 13/10, Opção A · rodrigo-code · faixa 30).
--
-- "Destrava a venda": a tela Compras › Precificação passa a mostrar, por produto ativo, Custo médio · Estoque ·
-- Preço de venda · Margem real (semáforo), com filtro "Sem preço de venda", banner de preço 0 e o botão
-- "Formar preços" (margem % OU markup, com arredondamento e PRÉVIA obrigatória antes de gravar).
--
-- RD-26: REAPROVEITA o motor que já existe — fn_produto_margem_real (margem líquida depois de imposto+comissão+custo
-- fixo), fn_produto_preco_por_margem (preço que atinge a margem alvo) e, na gravação, fn_produto_preco_aplicar
-- (que já grava em erp_preco_historico). Esta migration NÃO reescreve nenhuma dessas; só adiciona UM leitor de painel.
--
-- Pilar 2 (defesa de custo/valor no BACKEND): RLS é por LINHA, não por COLUNA — ler erp_produtos direto mostraria o
-- custo a quem não pode ver. Esta RPC SECURITY DEFINER confere a empresa por auth.uid() × tenant_user_roles e só devolve
-- custo/margem para quem pode ver custo (encarregado/mecânico = NÃO). É SÓ LEITURA (STABLE, sem INSERT/UPDATE/DELETE):
-- a gravação continua pela fn_produto_preco_aplicar (um histórico por produto), chamada pela tela na confirmação.
--
-- Aditiva: função NOVA + chaves de ajuda (RD-95). Não altera função de guarda. Sem DROP/DELETE/TRUNCATE.

CREATE OR REPLACE FUNCTION public.fn_produtos_precos_painel(
  p_company_id uuid,
  p_filtro     text DEFAULT 'todos',     -- 'todos' | 'sem_preco' | 'margem_negativa' | 'com_custo'
  p_busca      text DEFAULT NULL,         -- nome / código
  p_modo       text DEFAULT NULL,         -- NULL = só listar | 'margem' | 'markup' (liga a PRÉVIA de "Formar preços")
  p_valor      numeric DEFAULT NULL,      -- margem alvo % (modo 'margem') ou markup % (modo 'markup')
  p_arredondar text DEFAULT 'nenhum')     -- 'nenhum' | 'real' | 'noventa' (,90) | 'noventa_nove' (,99)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_papel    text;
  v_custo    boolean;
  v_busca    text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_modo     text := NULLIF(lower(COALESCE(p_modo, '')), '');
  v_total    int;
  v_sem      int;
  v_abaixo   int;
  v_rows     jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;

  -- multi-tenant: só a empresa de que o usuário é membro ativo
  SELECT role INTO v_papel
    FROM tenant_user_roles WHERE user_id = v_uid AND company_id = p_company_id AND is_active LIMIT 1;
  IF v_papel IS NULL AND NOT is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- custo/valor só para quem pode ver (equipe de campo / mecânico não vê valores)
  v_custo := COALESCE(v_papel, '') NOT IN ('CLIENT_OPERATOR', 'OFICINA_MECANICO');
  IF v_modo IS NOT NULL AND v_modo NOT IN ('margem', 'markup') THEN v_modo := NULL; END IF;

  -- base: produtos ativos da empresa, com o custo efetivo (médio, cai p/ preco_custo quando médio = 0)
  WITH base AS (
    SELECT p.id, p.codigo, p.nome, p.unidade, p.grupo,
           COALESCE(p.estoque_atual, 0)                                AS estoque,
           COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0)  AS custo,
           COALESCE(p.preco_venda, 0)                                  AS preco_hoje
      FROM erp_produtos p
     WHERE p.company_id = p_company_id AND COALESCE(p.ativo, true) = true
  ),
  -- totais para os banners/indicadores — sempre sobre TODOS os ativos, independem do filtro da tabela
  tot AS (
    SELECT count(*)::int                                                        AS total_ativos,
           count(*) FILTER (WHERE preco_hoje <= 0)::int                         AS sem_preco,
           count(*) FILTER (WHERE preco_hoje > 0 AND custo > 0 AND preco_hoje < custo)::int AS abaixo_custo
      FROM base
  ),
  -- linhas visíveis (filtro + busca) com margem de hoje e, quando em PRÉVIA, o preço novo e a margem nova
  filtrada AS (
    SELECT b.*,
      CASE WHEN b.custo > 0 AND b.preco_hoje > 0
           THEN (fn_produto_margem_real(p_company_id, b.custo, b.preco_hoje, b.id) ->> 'margem_liquida_pct')::numeric
      END AS margem_hoje_pct,
      -- preço cru da PRÉVIA (antes do arredondamento): markup = custo×(1+m/100); margem = motor por_margem
      CASE WHEN v_modo = 'markup' AND b.custo > 0 THEN b.custo * (1 + COALESCE(p_valor, 0) / 100)
           WHEN v_modo = 'margem' AND b.custo > 0 THEN (fn_produto_preco_por_margem(p_company_id, b.custo, p_valor, b.id) ->> 'preco_sugerido')::numeric
      END AS preco_cru
      FROM base b
     WHERE (p_filtro <> 'sem_preco'       OR b.preco_hoje <= 0)
       AND (p_filtro <> 'margem_negativa' OR (b.preco_hoje > 0 AND b.custo > 0 AND b.preco_hoje < b.custo))
       AND (p_filtro <> 'com_custo'       OR b.custo > 0)
       AND (v_busca IS NULL OR b.nome ILIKE '%' || v_busca || '%' OR b.codigo ILIKE '%' || v_busca || '%')
  ),
  -- aplica o arredondamento escolhido (sempre p/ CIMA quando ,90/,99 p/ não comer a margem) e calcula a margem nova
  calc AS (
    SELECT f.*,
      CASE
        WHEN f.preco_cru IS NULL OR f.preco_cru <= 0 THEN NULL
        WHEN p_arredondar = 'real'         THEN ceil(f.preco_cru)
        WHEN p_arredondar = 'noventa'      THEN floor(f.preco_cru) + CASE WHEN f.preco_cru - floor(f.preco_cru) > 0.90 THEN 1.90 ELSE 0.90 END
        WHEN p_arredondar = 'noventa_nove' THEN floor(f.preco_cru) + CASE WHEN f.preco_cru - floor(f.preco_cru) > 0.99 THEN 1.99 ELSE 0.99 END
        ELSE round(f.preco_cru, 2)
      END AS preco_novo
      FROM filtrada f
  )
  SELECT (SELECT total_ativos FROM tot), (SELECT sem_preco FROM tot), (SELECT abaixo_custo FROM tot),
         COALESCE(jsonb_agg(jsonb_build_object(
           'produto_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'unidade', c.unidade,
           'estoque', c.estoque,
           'custo',            CASE WHEN v_custo THEN c.custo END,
           'preco_hoje',       c.preco_hoje,
           'margem_hoje_pct',  CASE WHEN v_custo THEN c.margem_hoje_pct END,
           'preco_novo',       CASE WHEN v_custo THEN c.preco_novo END,
           'margem_nova_pct',  CASE WHEN v_custo AND c.preco_novo > 0
                                     THEN (fn_produto_margem_real(p_company_id, c.custo, c.preco_novo, c.id) ->> 'margem_liquida_pct')::numeric END
         ) ORDER BY (c.preco_hoje <= 0) DESC, c.margem_hoje_pct ASC NULLS LAST, c.nome), '[]'::jsonb)
    INTO v_total, v_sem, v_abaixo, v_rows
    FROM calc c;

  RETURN jsonb_build_object('ok', true,
    'pode_ver_custo', v_custo,
    'total_ativos', v_total, 'sem_preco', v_sem, 'abaixo_custo', v_abaixo,
    'modo', v_modo, 'valor', p_valor, 'arredondar', p_arredondar,
    'produtos', v_rows);
END $function$;
REVOKE ALL ON FUNCTION public.fn_produtos_precos_painel(uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_precos_painel(uuid, text, text, text, numeric, text) TO authenticated, service_role;

-- RD-95: "?" dos campos/colunas/ações da tela de precificação. Textos em linguagem do usuário, editáveis sem deploy.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('compras.precificacao.custo_medio', '/dashboard/compras/precificacao', 'Precificação', 'Custo médio',
  'Não preenche — é o custo médio de compra do produto, calculado pelas entradas de estoque (notas de compra).',
  'É a base de todo o cálculo: a margem e o preço sugerido saem dele. Produto sem custo não entra no cálculo (processe as notas de compra).',
  'Comprou 10 a R$ 8 e 10 a R$ 10 → custo médio R$ 9.', 'Custo zerado por nota ainda não processada: a margem aparece em branco até a entrada ser lançada.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.estoque', '/dashboard/compras/precificacao', 'Precificação', 'Estoque',
  'Não preenche — é o saldo atual em estoque do produto.', 'Ajuda a priorizar: forme preço primeiro no que você tem para vender agora.',
  '12 unidades.', 'Saldo diferente do físico: faça o inventário (contagem) para acertar.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.preco_venda', '/dashboard/compras/precificacao', 'Precificação', 'Preço de venda',
  'Não preenche aqui — é o preço de venda atual do produto. Para mudar, use "Formar preços" ou aplique o sugerido.',
  'É o preço que o cliente paga hoje. Preço zero trava a venda — por isso o aviso no topo.', 'R$ 19,90.',
  'Preço abaixo do custo (fica vermelho): você está vendendo com prejuízo.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.margem_real', '/dashboard/compras/precificacao', 'Precificação', 'Margem real',
  'Não preenche — é a margem líquida real de hoje, já descontando imposto da venda, comissão e custo fixo rateado.',
  'Mostra quanto SOBRA de verdade, não o markup. Verde = saudável, amarelo = apertada, vermelho = no prejuízo.',
  'Preço R$ 100, custo R$ 60, deduções R$ 25 → margem real R$ 15 (15%).',
  'Confundir com markup: markup é sobre o custo; a margem real é sobre o preço, depois de tudo.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.modo', '/dashboard/compras/precificacao', 'Precificação', 'Como formar o preço',
  'Escolha "Por margem" (quero sobrar X% no final) ou "Por markup" (quero multiplicar o custo por um fator).',
  'Define a conta do preço novo. Por margem o sistema desconta imposto/comissão/custo fixo para a margem fechar; por markup é só custo × fator.',
  'Margem 25% ou markup 60%.', 'Esperar que markup 25% dê 25% de margem: não dá — o imposto e a comissão comem parte.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.valor', '/dashboard/compras/precificacao', 'Precificação', 'Percentual',
  'O número do percentual: a margem líquida que você quer (modo margem) ou o quanto somar sobre o custo (modo markup).',
  'É o alvo do cálculo. A prévia mostra o preço novo e a margem real que ele dá antes de você gravar.', '25 (margem) ou 60 (markup).',
  'Pedir margem maior do que as deduções permitem: o sistema avisa que é impossível.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.arredondar', '/dashboard/compras/precificacao', 'Precificação', 'Arredondamento',
  'Como terminar o preço: exato, inteiro (R$ 20), terminando em ,90 (R$ 19,90) ou em ,99 (R$ 19,99).',
  'Deixa o preço comercial. O arredondamento é sempre para cima, para não comer a margem calculada.', 'R$ 19,47 → ,90 vira R$ 19,90.',
  'Arredondar para baixo à mão depois: você perde a margem que pediu.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.formar_precos', '/dashboard/compras/precificacao', 'Precificação', 'Formar preços',
  'Botão: calcula o preço novo dos produtos do filtro pela margem/markup e mostra a PRÉVIA. Nada é gravado antes de você confirmar.',
  'Precificar em lote com segurança: você vê o de→para e a margem nova, confere e só então grava (cada produto vira uma linha no histórico de preços).',
  'Filtrar "Sem preço de venda", margem 30%, ver a prévia e gravar.', 'Achar que já gravou ao calcular: só grava no "Gravar preços" da prévia.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.busca', '/dashboard/compras/precificacao', 'Precificação', 'Buscar',
  'Digite parte do nome ou do código do produto e tecle Enter para filtrar a lista.',
  'Achar rápido um produto específico para ver a margem ou formar o preço.', 'Tinta, ou o código 7898...',
  'Buscar não limpa o filtro de cima: se não achar, confira se o filtro não está escondendo o produto.', 'gestao_empresarial', 'publicado'),
 ('compras.precificacao.conta_preco', '/dashboard/compras/precificacao', 'Precificação', 'Conta do preço',
  'Não preenche — abre a conta do preço: custo, imposto da venda, comissão, custo fixo e a margem que sobra.',
  'Mostra de onde vem a margem real, para você entender e explicar o preço.', 'Preço R$ 100 = custo 60 + imposto 10 + comissão 5 + custo fixo 10 + margem 15.',
  'Deduções em 0: falta cadastrar imposto/comissão nos parâmetros (o cartão avisa).', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
