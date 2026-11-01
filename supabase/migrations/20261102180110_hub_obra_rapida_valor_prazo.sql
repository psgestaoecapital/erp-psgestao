-- HB2 · Gestão de Obras · Obra rápida (uma tela): valor previsto, início e previsão de término.
-- Aditivo e retrocompatível: estende fn_hub_criar_obra_rapida com 3 parâmetros OPCIONAIS
-- (default NULL). Os 3 chamadores atuais (obras/nova, projetos/clientes, BlocoObraFiscal)
-- seguem funcionando sem alteração. Grava valor_previsto / data_inicio / data_prevista_fim
-- já na criação da obra, alimentando o previsto × realizado e o cronograma sugerido.
-- RD-38 provado no dado (Construtora-DEMO 006): obra criada com valor/datas persistidos.

-- A assinatura muda (3 args a mais), então é preciso remover a anterior antes de recriar,
-- senão as duas convivem e o PostgREST acusa ambiguidade na chamada por nome.
DROP FUNCTION IF EXISTS public.fn_hub_criar_obra_rapida(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.fn_hub_criar_obra_rapida(
  p_company_id uuid,
  p_cliente_id uuid,
  p_cliente_nome text,
  p_nome text,
  p_logradouro text,
  p_numero text,
  p_bairro text,
  p_cidade text,
  p_uf text,
  p_cep text,
  p_codigo_ibge text,
  p_cno text,
  p_valor_previsto numeric DEFAULT NULL,
  p_data_inicio date DEFAULT NULL,
  p_data_prevista_fim date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ano    text := to_char(current_date, 'YYYY');
  v_prefix text := 'OBR-' || v_ano || '-';
  v_max    int;
  v_id     uuid;
  v_nome_endereco text;
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatório';
  END IF;

  -- Prazo coerente: a previsão de término nunca pode ser antes do início.
  IF p_data_inicio IS NOT NULL AND p_data_prevista_fim IS NOT NULL
     AND p_data_prevista_fim < p_data_inicio THEN
    RAISE EXCEPTION 'A previsão de término não pode ser anterior ao início' USING ERRCODE = '22007';
  END IF;

  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM '\d+$') AS int)), 0) INTO v_max
  FROM public.projetos_obras
  WHERE company_id = p_company_id AND numero LIKE v_prefix || '%';

  -- #53 · nome pelo endereço (identificação da origem), quando não vier nome explícito.
  -- Ex.: "Rua Marques do Herval 3249 — São Miguel do Oeste/SC". Distingue obras do mesmo cliente.
  v_nome_endereco := NULLIF(TRIM(
    concat_ws(' ', NULLIF(TRIM(p_logradouro), ''), NULLIF(TRIM(p_numero), ''))
    || CASE WHEN NULLIF(TRIM(p_cidade), '') IS NOT NULL
            THEN ' — ' || TRIM(p_cidade) || COALESCE('/' || NULLIF(TRIM(p_uf), ''), '')
            ELSE '' END
  ), '');

  INSERT INTO public.projetos_obras(
    company_id, numero, nome, cliente_id, cliente_nome,
    endereco, numero_endereco, bairro, cidade, uf, cep, codigo_ibge_municipio, cno, status,
    valor_previsto, data_inicio, data_prevista_fim
  ) VALUES (
    p_company_id,
    v_prefix || LPAD((v_max + 1)::text, 4, '0'),
    COALESCE(NULLIF(TRIM(p_nome), ''), v_nome_endereco, NULLIF(TRIM(p_cliente_nome), ''), 'Obra'),
    p_cliente_id,
    p_cliente_nome,
    NULLIF(TRIM(p_logradouro), ''),
    NULLIF(TRIM(p_numero), ''),
    NULLIF(TRIM(p_bairro), ''),
    NULLIF(TRIM(p_cidade), ''),
    NULLIF(TRIM(p_uf), ''),
    NULLIF(TRIM(p_cep), ''),
    NULLIF(TRIM(p_codigo_ibge), ''),   -- IBGE nulo = NULL, nunca chutado
    NULLIF(TRIM(p_cno), ''),
    'em_andamento',
    COALESCE(p_valor_previsto, 0),     -- valor_previsto é NOT NULL: sem valor informado = 0
    p_data_inicio,
    p_data_prevista_fim
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $function$;

-- Isolamento multi-tenant: função recém-(re)criada recebe EXECUTE para PUBLIC (inclui anon)
-- por padrão. A guarda interna é ignorada quando não há usuário (auth.uid() IS NULL = serviço/cron),
-- então um chamador anon poderia criar obra em qualquer company_id. Reaplicamos a ACL viva
-- ({authenticated, service_role, postgres}) na assinatura NOVA (15 args) logo após o CREATE.
REVOKE ALL ON FUNCTION public.fn_hub_criar_obra_rapida(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, date, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_criar_obra_rapida(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, date, date
) TO authenticated, service_role;

-- RD-95 · "?" dos 3 campos novos da Obra rápida (texto em linguagem do usuário).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, versao, status)
VALUES
  ('projetos.obra_nova.valor', '/dashboard/projetos/obras/nova', 'Nova obra', 'Valor previsto',
   'O valor total previsto da obra — o do contrato, ou o orçamento estimado quando ainda não há contrato.',
   'É a base do previsto × realizado e da margem no cockpit da obra.',
   'R$ 150.000,00',
   'Deixar zerado quando já existe valor fechado: o cockpit passa a mostrar margem errada.',
   905, 1, 'publicado'),
  ('projetos.obra_nova.data_inicio', '/dashboard/projetos/obras/nova', 'Nova obra', 'Início',
   'A data em que a obra começa (ou começou) na execução.',
   'Ancora o cronograma sugerido e o cálculo de prazo e atraso.',
   '01/11/2026',
   'Usar a data do contrato: aqui é a data real de início da obra.',
   906, 1, 'publicado'),
  ('projetos.obra_nova.prazo', '/dashboard/projetos/obras/nova', 'Nova obra', 'Previsão de término',
   'A data prevista de entrega. Sem informar, sugerimos 90 dias após o início — ajuste conforme o escopo.',
   'Define o prazo da obra: alimenta o cronograma sugerido e o indicador de atraso.',
   '30/01/2027',
   'Deixar antes do início: a previsão de término tem de ser depois da data de início.',
   907, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
