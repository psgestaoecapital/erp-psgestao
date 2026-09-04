-- Produtividade · sugerir cadastro A PARTIR DO PONTO (SPEC de ontem, nunca aplicado).
-- O CEO está travado: 1 setor, 0 cargos, 0 unidades cadastrados — enquanto o ponto (ind_ponto_*) tem
-- 26 departamentos e 59 funções reais, com contagem de gente. Em vez de digitar "oper" à mão, o botão
-- puxa "Operador de Câmara Fria II" que já está lá.
--
-- Três cuidados do SPEC (RD):
--  1) NÃO filtra RH/TI/Comercial — mostra tudo com a contagem; quem decide é o Cleverton.
--  2) "EXPEDIÇÃO" e "EXPEDIÇÃO/ENTREGAS" são o mesmo setor com grafia diferente → marca como POSSÍVEL
--     duplicata (prefixo de palavra), NUNCA funde sozinho. (Não confunde "Monitoria de Processo" com
--     "Monitoria Geral" — só prefixo no limite de palavra conta.)
--  3) Turno do ponto é JORNADA INDIVIDUAL (134 shifts distintos), não turno de planta. Os horários são
--     INFORMAÇÃO (entrada mais comum · ocorrências), nunca uma sugestão de turno pronta.
-- Unidades NÃO vêm do ponto — vêm de um conjunto padrão (fn_prod_unidades_semear_padrao).
--
-- Tudo SECURITY DEFINER + guarda de empresa, no padrão de fn_prod_sugerir_fator_cabeca_kg. Leitura pura
-- (as 3 sugestoras); só a semente de unidades escreve.

-- Normalização estável (sem depender de unaccent): tira acento, baixa, colapsa não-alfanumérico em espaço.
CREATE OR REPLACE FUNCTION public.fn_prod_norm(p text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT btrim(regexp_replace(regexp_replace(
    lower(translate(COALESCE(p,''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '[^a-z0-9]+',' ','g'), '\s+',' ','g'));
$function$;

-- 1 · SETORES sugeridos do departamento do ponto.
CREATE OR REPLACE FUNCTION public.fn_prod_sugerir_setores(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH base AS (
    SELECT g.nome, g.pessoas, fn_prod_norm(g.nome) AS k FROM (
      SELECT btrim(departamento) AS nome, count(*)::int AS pessoas
      FROM ind_ponto_colaborador
      WHERE company_id = p_company_id AND plant_id = p_plant_id
        AND COALESCE(btrim(departamento),'') <> ''
      GROUP BY btrim(departamento)
    ) g
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome', b.nome, 'pessoas', b.pessoas,
           'ja_cadastrado', EXISTS (SELECT 1 FROM prod_setor s
                WHERE s.company_id = p_company_id AND s.plant_id = p_plant_id AND fn_prod_norm(s.nome) = b.k),
           'possivel_duplicata_de', (SELECT b2.nome FROM base b2
                WHERE b2.k <> b.k AND b.k LIKE b2.k || ' %' ORDER BY length(b2.k) ASC LIMIT 1)
         ) ORDER BY b.pessoas DESC, b.nome), '[]'::jsonb)
    INTO v FROM base b;
  RETURN jsonb_build_object('ok', true, 'itens', v);
END $function$;

-- 2 · CARGOS sugeridos da função do ponto.
CREATE OR REPLACE FUNCTION public.fn_prod_sugerir_cargos(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH base AS (
    SELECT g.nome, g.pessoas, fn_prod_norm(g.nome) AS k FROM (
      SELECT btrim(funcao) AS nome, count(*)::int AS pessoas
      FROM ind_ponto_colaborador
      WHERE company_id = p_company_id AND plant_id = p_plant_id
        AND COALESCE(btrim(funcao),'') <> ''
      GROUP BY btrim(funcao)
    ) g
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome', b.nome, 'pessoas', b.pessoas,
           'ja_cadastrado', EXISTS (SELECT 1 FROM prod_cargo c
                WHERE c.company_id = p_company_id AND c.plant_id = p_plant_id AND fn_prod_norm(c.nome) = b.k)
         ) ORDER BY b.pessoas DESC, b.nome), '[]'::jsonb)
    INTO v FROM base b;
  RETURN jsonb_build_object('ok', true, 'itens', v);
END $function$;

-- 3 · HORÁRIOS frequentes (INFORMAÇÃO). Entrada = 1ª marcação do dia por colaborador, em balde de 5 min.
--     NÃO é sugestão de turno de planta — é o retrato de quando a gente bate o ponto.
CREATE OR REPLACE FUNCTION public.fn_prod_horarios_frequentes_ponto(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH entradas AS (
    SELECT cpf, data, min(hora) AS entrada
    FROM ind_ponto_marcacao
    WHERE company_id = p_company_id AND plant_id = p_plant_id AND hora IS NOT NULL
    GROUP BY cpf, data
  ), baldes AS (
    SELECT to_char(entrada - make_interval(mins => (extract(minute from entrada)::int % 5)), 'HH24:MI') AS horario,
           count(*)::int AS ocorrencias
    FROM entradas GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('horario', horario, 'ocorrencias', ocorrencias)
                  ORDER BY ocorrencias DESC, horario) , '[]'::jsonb)
    INTO v FROM (SELECT * FROM baldes ORDER BY ocorrencias DESC LIMIT 20) t;
  RETURN jsonb_build_object('ok', true, 'tipo', 'jornada_individual', 'itens', v);
END $function$;

-- 4 · Unidades: conjunto padrão (NÃO vem do ponto). Idempotente; kg é o padrão da planta.
CREATE OR REPLACE FUNCTION public.fn_prod_unidades_semear_padrao(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ins int := 0; r record;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  FOR r IN SELECT * FROM (VALUES
      ('KG','kg',true),('CAB','cabeça',false),('PC','PC',false),('GC','GC',false),('CX','caixa',false),
      ('TON','tonelada',false),('M3','m³',false),('L','litro',false),('M','metro',false)
    ) AS x(codigo, nome, padrao)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM prod_unidade_medida u
        WHERE u.company_id = p_company_id AND u.plant_id = p_plant_id
          AND (upper(u.codigo) = r.codigo OR fn_prod_norm(u.nome) = fn_prod_norm(r.nome))) THEN
      INSERT INTO prod_unidade_medida (company_id, plant_id, codigo, nome, e_padrao_planta, ativo)
      VALUES (p_company_id, p_plant_id, r.codigo, r.nome, r.padrao, true);
      v_ins := v_ins + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'inseridas', v_ins);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_prod_norm(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_sugerir_setores(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_sugerir_cargos(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_horarios_frequentes_ponto(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_unidades_semear_padrao(uuid, uuid) TO authenticated;
