-- Reforma · badge honesto (decisão CEO 30/08): deixa "Parcial" (verdade) e registra o Simulador como
-- BACKLOG CONSCIENTE. O feature_catalog dizia simulador='pronto' 100% — mas o simulador NÃO existe (o que
-- foi entregue é o PAINEL "o que já chegou", que não simula carga futura). Era selo mentiroso ao contrário.
--
-- 1) simulador vira 'previsto' (backlog) com o motivo: alíquotas em definição -> simular hoje seria inventar
--    número (RD-51). 2) registra o que REALMENTE foi entregue (o painel) como 'pronto', pra o registro não
--    mentir nos dois sentidos. Badge do módulo continua 'Parcial' (tem parte pronta e parte em backlog).

UPDATE public.feature_catalog
   SET status='previsto', percentual_pronto=0,
       descricao_executiva='Backlog consciente: as alíquotas da Reforma ainda estão em definição — simular carga futura hoje seria inventar número (RD-51). Reavaliar quando as alíquotas forem publicadas.'
 WHERE id='F.reforma.simulador_ibs_cbs';

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES ('F.reforma.painel_chegando','reforma_tributaria_2026','fiscal','Painel: Reforma que já chegou',
        'Mostra o IBS/CBS já destacado nas compras (o que chegou), com evolução mês a mês. Informativo — não simula carga futura.',
        'pronto', 100, 'alta')
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100;
