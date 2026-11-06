-- Carteira Gean (caixa jordana-code 3352399e, item 3 — Eng. Chefe 09/10): UNIFICAR cadastros de cliente com o mesmo
-- CNPJ/CPF na empresa. Escolhe-se o principal; tudo o que aponta para o duplicado (títulos, OS, orçamentos, pedidos,
-- contratos, CRM, agenda…) passa a apontar para o principal; o duplicado fica INATIVO com "unificado_para" = principal.
-- Com prévia (o que vai ser movido, tabela a tabela) e registro de auditoria (erp_cliente_unificacao).
--
-- Prova no dado (RD-38, 09/10): cadastros com o mesmo documento (só dígitos) na mesma empresa —
--   Gean 56 grupos (115 cadastros, quase todos vindos do Omie, cuja sincronização parou em 03/08), Pdois 14, ProPlay 10,
--   Tryo Gesso 2, R.R. 1. Na Gean, FC Pisos: dc836ebf (inativo, 10 títulos e 5 OS) × d0e668bc (ativo, 12 títulos e 14 OS)
--   → as OS e títulos antigos seguem presos ao cadastro inativo e a emissão da OS-2026-0198 achou o tomador errado.
--
-- Regras:
--   * principal e duplicado: mesma empresa, ids diferentes, MESMO documento (só dígitos, 11 ou 14); o usuário precisa ter
--     acesso à empresa (get_user_company_ids); o duplicado não pode já estar unificado nem ser o principal de alguém
--     que aponte para ele em cadeia;
--   * só troca a REFERÊNCIA ao cliente (cliente_id e afins), sempre filtrando pela mesma empresa: não mexe em valor,
--     vencimento, status nem baixa de título (os gatilhos de status/Omie só olham esses campos); nota fiscal emitida guarda
--     o tomador por cópia (CNPJ/razão) e não é tocada;
--   * duplicado vindo do Omie em empresa que ainda sincroniza com o Omie (sincronização nos últimos 30 dias) → recusa: a
--     próxima sincronização devolveria os títulos ao cadastro do Omie; unifique primeiro no Omie;
--   * tabela inexistente no banco (vertical não instalada) é pulada; colisão de índice único → recusa inteira (nada muda).
-- Aditivo: tabela nova, 2 colunas novas em erp_clientes, funções novas. SECURITY DEFINER com guarda de empresa,
-- search_path fixo, REVOKE de anon. Sensível (altera referência de dado de cliente) → revisao-eng-chefe.

ALTER TABLE public.erp_clientes
  ADD COLUMN IF NOT EXISTS unificado_para uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unificado_em   timestamptz;

COMMENT ON COLUMN public.erp_clientes.unificado_para IS
  'Cadastro principal para o qual este duplicado (mesmo CNPJ/CPF) foi unificado (fn_cliente_unificar). NULL = não unificado.';

CREATE TABLE IF NOT EXISTS public.erp_cliente_unificacao (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  principal_id    uuid        NOT NULL,
  duplicado_id    uuid        NOT NULL,
  documento       text        NOT NULL,
  motivo          text,
  movidos         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  duplicado_antes jsonb       NOT NULL,
  feito_por       uuid        DEFAULT auth.uid(),
  feito_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cliente_unificacao_company ON public.erp_cliente_unificacao (company_id, feito_em DESC);

ALTER TABLE public.erp_cliente_unificacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cliente_unificacao_ler_empresa ON public.erp_cliente_unificacao;
CREATE POLICY cliente_unificacao_ler_empresa ON public.erp_cliente_unificacao
  FOR SELECT TO authenticated USING (company_id IN (SELECT public.get_user_company_ids()));
-- gravação só pela fn_cliente_unificar (SECURITY DEFINER): nenhuma policy de INSERT/UPDATE/DELETE
REVOKE ALL ON public.erp_cliente_unificacao FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_cliente_unificacao FROM authenticated;
GRANT SELECT ON public.erp_cliente_unificacao TO authenticated;
GRANT ALL ON public.erp_cliente_unificacao TO service_role;

COMMENT ON TABLE public.erp_cliente_unificacao IS
  'Auditoria da unificação de cadastros de cliente com o mesmo CNPJ/CPF: quem, quando, o que foi movido (tabela, coluna, qtd e ids das linhas, para desfazer) e a foto do duplicado antes.';

-- Mesmo corpo da #2300 (guarda de CNPJ duplicado): repetido aqui para esta migration não depender da ordem de publicação.
CREATE OR REPLACE FUNCTION public.fn_clientes_documento_digitos(p_cpf_cnpj text, p_cnpj_cpf text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT nullif(regexp_replace(coalesce(nullif(btrim(p_cpf_cnpj), ''), nullif(btrim(p_cnpj_cpf), ''), ''), '\D', '', 'g'), '')
$$;
REVOKE ALL ON FUNCTION public.fn_clientes_documento_digitos(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clientes_documento_digitos(text, text) TO authenticated, service_role;

-- Onde o cliente é referenciado (FK para erp_clientes + colunas cliente_id sem FK conferidas no dado em 09/10).
CREATE OR REPLACE FUNCTION public.fn__cliente_referencias()
RETURNS TABLE (tabela text, coluna text, rotulo text)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (VALUES
    ('erp_receber',              'cliente_id',     'Títulos a receber'),
    ('erp_lancamentos',          'cliente_id',     'Lançamentos'),
    ('erp_os',                   'cliente_id',     'Ordens de serviço'),
    ('erp_orcamentos',           'cliente_id',     'Orçamentos'),
    ('erp_pedidos',              'cliente_id',     'Pedidos'),
    ('erp_contratos',            'cliente_id',     'Contratos'),
    ('erp_renegociacao',         'cliente_id',     'Renegociações'),
    ('erp_agendamento',          'cliente_id',     'Agendamentos'),
    ('erp_cliente_arquivos',     'cliente_id',     'Arquivos do cliente'),
    ('erp_crm_lead',             'cliente_id',     'Leads (CRM)'),
    ('erp_crm_oportunidade',     'cliente_id',     'Oportunidades (CRM)'),
    ('erp_frota',                'cliente_id',     'Veículos da frota do cliente'),
    ('erp_movimentacoes',        'cliente_id',     'Movimentações de estoque'),
    ('erp_obra_planta',          'cliente_id',     'Plantas de obra'),
    ('erp_odonto_paciente',      'cliente_id',     'Pacientes'),
    ('erp_oficina_contato',      'cliente_id',     'Contatos da oficina'),
    ('erp_pec_movimentacao',     'contraparte_id', 'Movimentações da pecuária'),
    ('erp_tabela_preco_cliente', 'cliente_id',     'Tabela de preço do cliente'),
    ('projetos_obras',           'cliente_id',     'Obras'),
    ('veic_proposta',            'cliente_id',     'Propostas de veículo'),
    ('veic_reserva',             'cliente_id',     'Reservas de veículo'),
    ('veic_venda',               'cliente_id',     'Vendas de veículo'),
    ('veic_veiculo',             'fornecedor_id',  'Veículos (fornecedor)'),
    ('veic_custo',               'fornecedor_id',  'Custos de veículo (fornecedor)'),
    ('agency_clientes',          'erp_cliente_id', 'Clientes da agência'),
    ('agency_contratos',         'erp_cliente_id', 'Contratos da agência'),
    ('agency_leads',             'erp_cliente_id', 'Leads da agência'),
    ('agency_propostas',         'erp_cliente_id', 'Propostas da agência'),
    ('agency_planejamentos',     'cliente_id',     'Planejamentos da agência'),
    ('agency_posts',             'cliente_id',     'Posts da agência')
  ) AS r(tabela, coluna, rotulo)
$$;
REVOKE ALL ON FUNCTION public.fn__cliente_referencias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__cliente_referencias() TO service_role;

-- Validação comum da prévia e da unificação. Devolve a empresa e o documento; recusa com mensagem que ensina (RD-74).
CREATE OR REPLACE FUNCTION public.fn__cliente_unificar_validar(p_principal uuid, p_duplicado uuid,
                                                              OUT o_company uuid, OUT o_doc text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p record;
  d record;
  v_sync timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre no sistema para unificar cadastros.' USING ERRCODE = '42501';
  END IF;
  IF p_principal IS NULL OR p_duplicado IS NULL OR p_principal = p_duplicado THEN
    RAISE EXCEPTION 'Escolha dois cadastros diferentes: o principal (que fica) e o duplicado (que será inativado).';
  END IF;

  SELECT * INTO p FROM public.erp_clientes WHERE id = p_principal;
  SELECT * INTO d FROM public.erp_clientes WHERE id = p_duplicado;
  IF p.id IS NULL OR d.id IS NULL THEN
    RAISE EXCEPTION 'Cadastro não encontrado. Atualize a tela e escolha de novo.';
  END IF;
  IF p.company_id IS DISTINCT FROM d.company_id
     OR NOT (p.company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Os dois cadastros precisam ser da mesma empresa, e você precisa ter acesso a ela.' USING ERRCODE = '42501';
  END IF;

  o_company := p.company_id;
  o_doc := public.fn_clientes_documento_digitos(p.cpf_cnpj, p.cnpj_cpf);
  IF o_doc IS NULL OR length(o_doc) NOT IN (11, 14)
     OR o_doc IS DISTINCT FROM public.fn_clientes_documento_digitos(d.cpf_cnpj, d.cnpj_cpf) THEN
    RAISE EXCEPTION 'Só dá para unificar cadastros com o MESMO CNPJ/CPF. Confira o documento dos dois cadastros.';
  END IF;

  IF d.unificado_para IS NOT NULL THEN
    RAISE EXCEPTION 'Este duplicado já foi unificado em outro cadastro.';
  END IF;
  IF p.unificado_para IS NOT NULL THEN
    RAISE EXCEPTION 'O cadastro escolhido como principal já foi unificado em outro. Escolha como principal o cadastro que ficou.';
  END IF;

  IF d.ref_externa_sistema = 'OMIE' THEN
    SELECT max(c.ultima_sync) INTO v_sync
      FROM public.erp_clientes c
     WHERE c.company_id = o_company AND c.ref_externa_sistema = 'OMIE';
    IF v_sync > now() - interval '30 days' THEN
      RAISE EXCEPTION 'O duplicado vem do Omie e esta empresa ainda sincroniza com o Omie: a próxima sincronização devolveria os títulos para ele.'
        USING HINT = 'Unifique (ou inative) o cliente primeiro no Omie; depois unifique aqui.';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn__cliente_unificar_validar(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__cliente_unificar_validar(uuid, uuid) TO service_role;

-- Grupos de cadastros com o mesmo CNPJ/CPF na empresa (ativos e inativos ainda não unificados).
CREATE OR REPLACE FUNCTION public.fn_clientes_duplicados_listar(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    WITH c AS (
      SELECT x.*, public.fn_clientes_documento_digitos(x.cpf_cnpj, x.cnpj_cpf) AS doc
        FROM public.erp_clientes x
       WHERE x.company_id = p_company_id AND x.unificado_para IS NULL
    ), g AS (
      SELECT doc FROM c WHERE length(doc) IN (11, 14) AND doc !~ '^(\d)\1*$' GROUP BY doc HAVING count(*) > 1
    )
    SELECT jsonb_agg(jsonb_build_object(
             'documento', g.doc,
             'cadastros', (SELECT jsonb_agg(jsonb_build_object(
                                    'id', c.id,
                                    'nome', coalesce(nullif(btrim(c.nome_fantasia), ''), nullif(btrim(c.razao_social), ''), 'sem nome'),
                                    'razao_social', c.razao_social,
                                    'codigo', c.codigo,
                                    'ativo', coalesce(c.ativo, true),
                                    'origem', coalesce(c.ref_externa_sistema, 'manual'),
                                    'tem_endereco', (nullif(btrim(c.cep), '') IS NOT NULL AND nullif(btrim(c.cidade), '') IS NOT NULL),
                                    'tem_ibge', nullif(btrim(c.codigo_ibge_municipio), '') IS NOT NULL,
                                    'criado_em', c.created_at)
                                  ORDER BY coalesce(c.ativo, true) DESC, c.created_at)
                             FROM c WHERE c.doc = g.doc))
           ORDER BY g.doc)
      FROM g
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fn_clientes_duplicados_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clientes_duplicados_listar(uuid) TO authenticated, service_role;

-- Prévia: quanto vai ser movido, tabela a tabela. Não grava nada.
CREATE OR REPLACE FUNCTION public.fn_cliente_unificar_previa(p_principal uuid, p_duplicado uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v   record;
  r   record;
  n   bigint;
  mov jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM public.fn__cliente_unificar_validar(p_principal, p_duplicado);
  FOR r IN SELECT * FROM public.fn__cliente_referencias() LOOP
    IF to_regclass('public.' || r.tabela) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1 AND company_id = $2', r.tabela, r.coluna)
      INTO n USING p_duplicado, v.o_company;
    IF n > 0 THEN
      mov := mov || jsonb_build_object('tabela', r.tabela, 'rotulo', r.rotulo, 'qtd', n);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('documento', v.o_doc, 'principal_id', p_principal, 'duplicado_id', p_duplicado, 'mover', mov);
END $$;
REVOKE ALL ON FUNCTION public.fn_cliente_unificar_previa(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cliente_unificar_previa(uuid, uuid) TO authenticated, service_role;

-- Unificação: move as referências, inativa o duplicado e registra a auditoria. Tudo ou nada.
CREATE OR REPLACE FUNCTION public.fn_cliente_unificar(p_principal uuid, p_duplicado uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v      record;
  r      record;
  n      bigint;
  mov    jsonb := '[]'::jsonb;
  antes  jsonb;
  v_id   uuid;
  ids    jsonb;
BEGIN
  SELECT * INTO v FROM public.fn__cliente_unificar_validar(p_principal, p_duplicado);
  -- trava os dois cadastros e confere de novo (duas unificações simultâneas do mesmo par esperam uma a outra)
  PERFORM 1 FROM public.erp_clientes WHERE id IN (p_principal, p_duplicado) ORDER BY id FOR UPDATE;
  SELECT * INTO v FROM public.fn__cliente_unificar_validar(p_principal, p_duplicado);
  PERFORM public.fn__guarda_empresa(v.o_company);  -- guarda padrão da empresa do registro (check:fn-guards)
  SELECT to_jsonb(c) INTO antes FROM public.erp_clientes c WHERE c.id = p_duplicado;

  BEGIN
    FOR r IN SELECT * FROM public.fn__cliente_referencias() LOOP
      IF to_regclass('public.' || r.tabela) IS NULL THEN CONTINUE; END IF;
      -- guarda os ids das linhas movidas (backup para desfazer: basta voltar a coluna ao duplicado nesses ids)
      EXECUTE format('WITH u AS (UPDATE public.%I SET %I = $1 WHERE %I = $2 AND company_id = $3 RETURNING id) '
                     'SELECT count(*), coalesce(jsonb_agg(id), ''[]''::jsonb) FROM u', r.tabela, r.coluna, r.coluna)
        INTO n, ids USING p_principal, p_duplicado, v.o_company;
      IF n > 0 THEN
        mov := mov || jsonb_build_object('tabela', r.tabela, 'coluna', r.coluna, 'rotulo', r.rotulo, 'qtd', n, 'ids', ids);
      END IF;
    END LOOP;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Não unifiquei: em "%" o principal já tem um registro igual ao do duplicado. Ajuste um dos dois e tente de novo.',
      coalesce(r.rotulo, r.tabela) USING ERRCODE = '23505';
  END;

  UPDATE public.erp_clientes
     SET ativo = false, unificado_para = p_principal, unificado_em = now()
   WHERE id = p_duplicado;

  INSERT INTO public.erp_cliente_unificacao (company_id, principal_id, duplicado_id, documento, motivo, movidos, duplicado_antes)
  VALUES (v.o_company, p_principal, p_duplicado, v.o_doc, nullif(btrim(p_motivo), ''), mov, antes)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'unificacao_id', v_id, 'principal_id', p_principal,
                            'duplicado_id', p_duplicado, 'movidos', mov);
END $$;
REVOKE ALL ON FUNCTION public.fn_cliente_unificar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cliente_unificar(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_cliente_unificar(uuid, uuid, text) IS
  'Unifica dois cadastros de cliente com o mesmo CNPJ/CPF: move as referências (títulos, OS, orçamentos…) do duplicado para o principal, inativa o duplicado (unificado_para) e registra em erp_cliente_unificacao. Prévia: fn_cliente_unificar_previa.';
