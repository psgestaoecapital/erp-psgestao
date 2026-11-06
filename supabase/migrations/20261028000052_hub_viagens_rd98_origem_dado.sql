-- Hub · /dashboard/projetos/viagens — fecha o quad RD-98 (aud8/Max 27/10, caixa b6e42e4e · Code: desenvolvedor_4_g)
-- Foto DEMO 0006 13:41Z: visual já 95 (custo real x mobilização, alerta de margem, Exportar CSV, "?" nos tiles,
-- cadeia com Resultado da obra). Falta só o pilar 3 da RD-98 (ORIGEM DO DADO): a rota estava com
-- system_screens.views_consumidas e rpcs_chamadas VAZIOS.
--
-- RD-98 pilar 3 (ORIGEM): preenche com as views/tabelas e os RPCs que src/app/dashboard/projetos/viagens/*
-- realmente consome (grep dos arquivos, RD-38 provado no código — não suposto).
-- RD-98 pilar 4 (EXCLUSÃO RASTREÁVEL): já atendido no dado e NÃO precisa de código novo —
--   fn_viagem_excluir faz soft-delete (UPDATE excluido_em = now(), excluido_por = auth.uid()); nunca DELETE físico;
--   fn_viagem_restaurar oferece desfazer de 15 min só a quem excluiu; a listagem (page.tsx:87) e os lançamentos
--   (page.tsx:92/132) filtram .is('excluido_em', null). excluido_por/excluido_em são o rastro de quem/quando.
--
-- Migration ADITIVA (RD-94.1 c): só metadados de system_screens; nenhuma função/RLS/view/tabela tocada.

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'v_viagem_custo_obra',      -- custo/rateio da viagem por obra (cadeia com o Resultado da obra)
        'erp_viagem',               -- cabeçalho/listagem de viagens (filtra excluido_em IS NULL)
        'erp_viagem_lancamento',    -- despesas/abastecimentos da viagem (filtra excluido_em IS NULL)
        'erp_viagem_ge_titulo',     -- títulos lançados no GE ("Lançadas no GE N de M")
        'projetos_obras',           -- obra vinculada (nome destacado no card)
        'erp_plano_contas'          -- centro de custo/conta para o lançamento
       ]::text[],
       rpcs_chamadas = ARRAY[
        'fn_viagem_pode_gravar',        -- perfil pode alterar viagens (viewer é só leitura)
        'fn_viagem_salvar',             -- criar/editar viagem aberta
        'fn_viagem_resumo',             -- resumo total/adiantamento/saldo/km/custo-km/litros/consumo
        'fn_viagem_lancamento_salvar',  -- lançar despesa/abastecimento
        'fn_viagem_lancamento_excluir', -- soft-delete de lançamento
        'fn_viagem_lancamento_restaurar',-- desfazer exclusão de lançamento (15 min)
        'fn_viagem_fechar',             -- fechar viagem (com prévia)
        'fn_viagem_lancar_ge',          -- lançar a viagem fechada no GE (rateio por obra)
        'fn_viagem_excluir',            -- soft-delete de viagem aberta fora do GE
        'fn_viagem_restaurar',          -- desfazer exclusão de viagem (15 min, só autor)
        'fn_viagem_relatorio',          -- relatório de custo por viagem/obra (+ Exportar CSV)
        'fn_viagem_indicadores',        -- indicadores (custo por km/dia/m², alerta de margem)
        'fn_viagem_consumo',            -- consumo médio do veículo (km/l) e custo por km
        'fn_viagem_assinar',            -- assinatura do acerto de deslocamento
        'fn_viagem_assinaturas'         -- assinaturas registradas do acerto
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/viagens';
