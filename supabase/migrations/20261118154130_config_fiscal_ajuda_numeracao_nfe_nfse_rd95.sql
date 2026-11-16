-- RD-95 · Config Fiscal (/dashboard/configuracoes/fiscal) — chamado #9428.
-- A tela misturava, no mesmo grid, a numeração da NF-e (Série NFe / Próximo nº NFe) com a da NFS-e
-- (Série NFSe / Próximo nº NFSe). A PR separa visualmente os campos (numeração da NF-e junto dos demais
-- campos de NF-e, modelo 55; numeração da NFS-e em seção própria) e passa a mostrar o "?" (AjudaCampo)
-- em cada um dos 4 campos. Esta migration cadastra a ajuda dessas 4 chaves, na rota exata da tela
-- (fn_ajuda_campo_listar casa por rota).
--
-- ADITIVO e idempotente (ON CONFLICT (chave) DO NOTHING). Tabela de referência global (erp_ajuda_campo);
-- nenhum dado de cliente tocado. Sem RLS/grants novos.
-- RD-52: arquivo em supabase/migrations + PR (faixa rodrigo-code :30, acima da main).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('fiscal.serie_nfe','/dashboard/configuracoes/fiscal','NF-e (modelo 55)','Série NFe','Número da série usada ao emitir a NF-e (modelo 55). Normalmente começa em 1; só mude se a sua contabilidade orientar outra série.','Compõe a identificação da nota (série + número). A Receita controla a sequência por série, então trocar a série sem orientação pode gerar duplicidade ou salto de numeração.','1','Mudar a série no meio do mês sem combinar com a contabilidade, deixando notas com séries misturadas.','gestao_empresarial',10,'publicado'),
 ('fiscal.prox_num_nfe','/dashboard/configuracoes/fiscal','NF-e (modelo 55)','Próximo nº NFe','O número que a PRÓXIMA NF-e emitida vai receber. O sistema avança sozinho a cada emissão; ajuste manualmente só para alinhar com a numeração já usada no sistema anterior.','Evita pular ou repetir número ao começar a emitir no PS. A Receita rejeita número já usado ou fora de ordem na mesma série.','1058 (se a última NF-e emitida foi a 1057).','Deixar um número menor que o da última nota já emitida — a Receita recusa a nota por numeração duplicada.','gestao_empresarial',20,'publicado'),
 ('fiscal.serie_nfse','/dashboard/configuracoes/fiscal','NFS-e','Série NFSe','Número da série usada ao emitir a NFS-e (nota de serviço). Em muitos municípios é 1; confira a orientação da prefeitura.','Compõe a identificação da NFS-e (série + número) junto ao município emissor. Séries diferentes mantêm sequências separadas.','1','Usar uma série diferente da aceita pela prefeitura, o que faz a NFS-e ser recusada na emissão.','gestao_empresarial',30,'publicado'),
 ('fiscal.prox_num_nfse','/dashboard/configuracoes/fiscal','NFS-e','Próximo nº NFSe','O número que a PRÓXIMA NFS-e emitida vai receber. O sistema avança sozinho; ajuste manualmente só para continuar a numeração do sistema anterior.','Evita pular ou repetir número na emissão de serviço. O município controla a sequência por série.','312 (se a última NFS-e emitida foi a 311).','Reiniciar a numeração em 1 quando a prefeitura já tem notas suas numeradas, gerando conflito na emissão.','gestao_empresarial',40,'publicado')
ON CONFLICT (chave) DO NOTHING;
