-- Hub · PDCA auditor_pdca_1 (27/11) · tela 5W2H (/dashboard/hub/plano-acao) — SÓ-DEMO.
-- A fatia #6376 (elo ação 5W2H → obra) está correta no código vivo, mas na Construtora Modelo - DEMO
-- (b0700000-0000-4000-a000-000000000006) as 8 ações 5W2H estavam com obra_id NULL → nenhum cartão mostrava
-- "Obra: nº nome" e o filtro "por obra" não tinha o que filtrar: o recurso ficava invisível na vitrine e o
-- aud8/auditor não conseguia verificar o elo salvando/carregando (critério c).
--
-- Conserto (SÓ-DEMO): semear o elo em 3 das 8 ações existentes, apontando para obras EXISTENTES da MESMA
-- empresa DEMO 006. Aditivo e IDEMPOTENTE (só preenche quando obra_id IS NULL; re-rodar não muda nada).
-- Toda escrita é guardada por company_id = DEMO 006 e por obra da própria 006 (EXISTS). NÃO altera estrutura,
-- RLS nem dado de cliente. RD-52: arquivo+PR, acima da main, faixa de segundos :45-:54 (desenvolvedor_4_g).
-- RD-38 provado (BEGIN...ROLLBACK): acoes_com_obra 0 -> 3 (de 8).

UPDATE public.erp_plano_acao a
   SET obra_id = v.obra_id
  FROM (VALUES
    -- "Renegociar o prazo de entrega das esquadrias de alumínio" -> Forro e divisórias – Vista Verde
    ('ac111111-0006-4a00-b000-0000000a0002'::uuid, '11a80fcc-0c9c-492b-b993-08df3a74fd77'::uuid),
    -- "Checklist único de vistoria na entrega de cada obra"       -> Piso e pintura – Clínica Bem Viver
    ('ac111111-0006-4a00-b000-0000000a0001'::uuid, 'ecef61b7-77d1-45d1-ba9c-49f35e25b932'::uuid),
    -- "Painel com os marcos de cada obra e o status"              -> Piso industrial · Frigorífico Oeste
    ('ac111111-0006-4a00-b000-0000000a0008'::uuid, '5a016907-af97-4736-bea4-8057380f3966'::uuid)
  ) AS v(acao_id, obra_id)
 WHERE a.id = v.acao_id
   AND a.company_id = 'b0700000-0000-4000-a000-000000000006'
   AND a.obra_id IS NULL
   AND EXISTS (
     SELECT 1 FROM public.projetos_obras o
      WHERE o.id = v.obra_id
        AND o.company_id = 'b0700000-0000-4000-a000-000000000006'
        AND o.deleted_at IS NULL
   );
