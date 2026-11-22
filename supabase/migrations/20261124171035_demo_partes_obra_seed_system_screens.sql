-- PDCA auditor_pdca_1 (tela /dashboard/projetos/obras/[id]/partes · blueprint): fecha 2 gaps RD-98 (94 -> >=95).
-- 1) RD-98 p1 SEM DADO: projetos_obra_parte estava com 0 linhas em toda a base. Semeia partes fictícias realistas
--    SÓ na DEMO Construtora (company_id = b0700000-0000-4000-a000-000000000006, RD-69/LGPD), para a tela exibir
--    lista populada e provar o CRUD. Idempotente: NOT EXISTS por (obra_id, papel) ativo; reaplicar não duplica.
-- 2) RD-98 p3 ORIGEM DO DADO: system_screens da rota estava com rpcs_chamadas/views_consumidas vazios embora a
--    page.tsx chame as 3 RPCs guardadas. Preenche a proveniência (espelha o que a #5856 fez em /orcamento/relatorios).
-- Aditiva. Nunca apaga nem altera dado de cliente. A fonte da verdade (papéis permitidos) é o CHECK da tabela.

DO $$
DECLARE v_company uuid := 'b0700000-0000-4000-a000-000000000006';
BEGIN
  INSERT INTO public.projetos_obra_parte (company_id, obra_id, papel, nome, documento, contato, observacao)
  SELECT v_company, o.id, d.papel, d.nome, d.documento, d.contato, d.observacao
  FROM public.projetos_obras o
  CROSS JOIN (VALUES
    ('proprietario',          'Incorporadora Vista Verde Ltda (fictícia · DEMO)', '11.222.333/0001-81', 'contato@vistaverde.demo',  'Proprietário do empreendimento'),
    ('contratante',           'Administradora Horizonte S/A (fictícia · DEMO)',   '44.555.666/0001-72', 'obras@horizonte.demo',     'Contratou a execução da obra'),
    ('construtora_executora', 'Construtora Modelo Ltda (fictícia · DEMO)',        '77.888.999/0001-63', 'engenharia@modelo.demo',   'Executa o escopo contratado'),
    ('escritorio_gestor',     'Gestão de Obras PS (fictícia · DEMO)',             '12.345.678/0001-90', 'gestao@ps.demo',           'Gerencia prazo, custo e qualidade')
  ) AS d(papel, nome, documento, contato, observacao)
  WHERE o.company_id = v_company
    AND NOT EXISTS (
      SELECT 1 FROM public.projetos_obra_parte p
      WHERE p.obra_id = o.id AND p.papel = d.papel AND p.excluido_em IS NULL
    );
END $$;

UPDATE public.system_screens
SET rpcs_chamadas   = ARRAY['fn_obra_parte_listar','fn_obra_parte_salvar','fn_obra_parte_excluir'],
    views_consumidas = ARRAY['projetos_obra_parte','projetos_obras']
WHERE rota = '/dashboard/projetos/obras/[id]/partes';
