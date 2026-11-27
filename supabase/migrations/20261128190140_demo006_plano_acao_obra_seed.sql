-- SÓ-DEMO · Hub · /dashboard/hub/plano-acao — tornar o elo ação→obra DEMONSTRÁVEL na DEMO 006.
-- PDCA auditor_pdca_1 (27/11, aud8 88/95): o código do vínculo ação↔obra está 100% vivo
-- (fn_plano_acao_salvar persiste obra_id; fn_plano_acao_listar devolve obra; cockpit lê
-- fn_obra_plano_acao_abertas), mas na DEMO Construtora Modelo (006) NENHUMA das 8 ações tinha
-- obra_id, então o seletor "Obra" e o bloco "Ações abertas desta obra" do cockpit apareciam
-- vazios — a feature parecia morta. A tarefa anterior foi concluída sem semear.
--
-- Conserto: ligar 3 ações ABERTAS/EM ANDAMENTO a obras distintas da própria DEMO 006.
-- SÓ-DEMO (guarda companies.is_demo = true + o id da DEMO 006), ADITIVO, IDEMPOTENTE
-- (obra_id IS NULL), sem apagar/alterar nada fora disso, sem tocar empresa real.
-- obra_id vem por SUBSELECT pelo número da obra (resiliente a mudança de id).
-- Prova RD-38 (read-only, antes/depois): acoes_com_obra 0 → 3; total de linhas inalterado.
-- Faixa de segundos :40 (code-desenvolvedor-3).
-- Code: code-desenvolvedor-3

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo = true
  ) THEN
    UPDATE public.erp_plano_acao a
       SET obra_id = o.id
      FROM public.projetos_obras o
     WHERE a.company_id = 'b0700000-0000-4000-a000-000000000006'
       AND o.company_id = 'b0700000-0000-4000-a000-000000000006'
       AND a.obra_id IS NULL
       AND a.status IN ('aberta','em_andamento')
       AND (a.codigo, o.numero) IN (
         ('PA-2026-901','DEMO-OB-001'),
         ('PA-2026-903','DEMO-FC-001'),
         ('PA-2026-908','DEMO-OB-002')
       );
  END IF;
END $$;
