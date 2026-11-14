-- DEMO 005 (Indústria Modelo — DEMO, b0700000-0000-4000-a000-000000000005): abastecer Centro de custo e
-- Supervisor dos 11 postos do quadro, para que os filtros da Visão Quadro (slice 2b) tenham o que provar.
-- RD-69: dado DEMO fictício (nomes inventados), nunca dado real de cliente. RD-38: hoje 11 postos com
-- centro_custo=0 e supervisor=0 (provado). ADITIVO e idempotente: só preenche onde está vazio, escopo = DEMO 005.
-- Não toca nenhuma outra empresa. Mapeia por setor (Abate / Desossa); qualquer outro setor recebe genérico.
UPDATE public.prod_posto p
SET centro_custo = CASE s.nome
      WHEN 'Abate'   THEN 'CC-ABATE'
      WHEN 'Desossa' THEN 'CC-DESOSSA'
      ELSE 'CC-PRODUCAO'
    END,
    supervisor_nome = CASE s.nome
      WHEN 'Abate'   THEN 'Carlos Meneghel'
      WHEN 'Desossa' THEN 'Rita Boaventura'
      ELSE 'Marcos Lindner'
    END,
    updated_at = now()
FROM public.prod_setor s
WHERE p.setor_id = s.id
  AND p.company_id = 'b0700000-0000-4000-a000-000000000005'
  AND (p.centro_custo IS NULL OR btrim(p.centro_custo) = '')
  AND (p.supervisor_nome IS NULL OR btrim(p.supervisor_nome) = '');
