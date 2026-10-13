-- Carga do backfill RH · cria os funcionários faltantes da Frioeste a partir do ponto.
--
-- Contexto: a migration 20260820160000 criou a FUNÇÃO fn_rh_backfill_funcionarios (gated,
-- pra rodar autenticado), mas NÃO insere no deploy — então os 30 nunca entraram (a função
-- não foi chamada) e compliance_funcionarios da Frioeste seguiu em 161. Sem os 30, o import
-- Frioeste fica em 97/65 (os 'cpf_sem_funcionario').
--
-- Esta migration faz a INSERÇÃO direta no deploy (roda como postgres) — mesma lógica da função,
-- sem a planilha (cargo←funcao, setor←departamento do ponto). É a carga que o CEO esperava "via PR".
--
-- Premissas auditadas (premissa-primeiro, RD-38 — dado real Frioeste 975365cc...):
--  • Alvo = ponto c/ CPF de 11 dígitos SEM funcionário (match por CPF normalizado): 30 exatos,
--    30 CPFs distintos, zero duplicado. Projeção 161 → 191.
--  • UNIQUE(company_id,cpf) coberto pelo NOT EXISTS normalizado + DISTINCT ON (idempotente).
--  • NOT NULL só company_id + nome_completo (ponto.nome é NOT NULL). CHECK vinculo_tipo='direto' ok.
--  • Trigger trg_sync_setor_text normaliza o texto do setor a partir do setor_id (benigno).

DO $carga$
DECLARE
  v_company uuid := '975365cc-9e5a-4251-9022-68c6bfde10d8';
  v_antes int; v_depois int; v_criados int;
BEGIN
  SELECT count(*) INTO v_antes FROM public.compliance_funcionarios WHERE company_id = v_company;

  WITH alvo AS (
    SELECT DISTINCT ON (regexp_replace(p.cpf, '\D', '', 'g'))
      p.company_id,
      btrim(p.nome)                          AS nome,
      regexp_replace(p.cpf, '\D', '', 'g')   AS cpf,
      NULLIF(btrim(p.matricula), '')         AS matricula,
      NULLIF(btrim(p.funcao), '')            AS funcao,
      NULLIF(btrim(p.departamento), '')      AS departamento
    FROM public.ind_ponto_colaborador p
    WHERE p.company_id = v_company
      AND length(regexp_replace(COALESCE(p.cpf, ''), '\D', '', 'g')) = 11
      AND NOT EXISTS (
        SELECT 1 FROM public.compliance_funcionarios f
         WHERE f.company_id = p.company_id
           AND regexp_replace(COALESCE(f.cpf, ''), '\D', '', 'g') = regexp_replace(p.cpf, '\D', '', 'g'))
    ORDER BY regexp_replace(p.cpf, '\D', '', 'g'), (p.matricula IS NOT NULL) DESC
  )
  INSERT INTO public.compliance_funcionarios
    (company_id, nome_completo, cpf, matricula, funcao, cargo, setor, setor_id, ativo, vinculo_tipo)
  SELECT
    a.company_id, a.nome, a.cpf, a.matricula, a.funcao,
    a.funcao,                                   -- cargo ← funcao (sem planilha nesta carga)
    a.departamento,                             -- setor ← departamento
    (SELECT s.id FROM public.compliance_setores s
       WHERE (s.company_id = a.company_id OR s.is_global = true)
         AND a.departamento IS NOT NULL
         AND (lower(s.nome) = lower(a.departamento) OR lower(s.slug) = lower(a.departamento))
       ORDER BY (s.company_id = a.company_id) DESC LIMIT 1),
    true, 'direto'
  FROM alvo a;

  GET DIAGNOSTICS v_criados = ROW_COUNT;
  SELECT count(*) INTO v_depois FROM public.compliance_funcionarios WHERE company_id = v_company;
  RAISE NOTICE 'backfill funcionarios Frioeste: antes=% criados=% depois=%', v_antes, v_criados, v_depois;
END
$carga$;
