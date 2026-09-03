-- sugestoes.status: UMA língua só (RD-52) — a pendência que registrei mais cedo, agora mordendo.
--
-- Achado do CEO: "Adicionar botão de IA" (implementado, abril) aparecia na fila de "abertas" há 149
-- dias, porque implementado é TERMINAL mas o filtro não sabia — o CHECK (NOT VALID) aceitava 14 valores
-- com SINÔNIMOS convivendo: concluida×concluido, resolvida×implementado, nova×aberta×pendente,
-- em_desenvolvimento×em_andamento, +aberta. Mesma família do capture_status unificado hoje.
--
-- No dado, só 'implementado' (1 linha) é sinônimo EM USO; os demais sinônimos não têm linha. Canônico =
-- o vocabulário do fluxo (fn_sugestao_status) + arquivada:
--   nova, em_analise, aceita, em_desenvolvimento, concluida, recusada, duplicada, arquivada.

-- (1) coluna paralela: preserva o status pré-migração (reconstituível, como capture_status_original).
ALTER TABLE public.sugestoes ADD COLUMN IF NOT EXISTS status_original text;
UPDATE public.sugestoes SET status_original = status WHERE status_original IS NULL;

-- (2) migra os sinônimos para o canônico. Só 'implementado' tem linha hoje; os outros são no-op
--     defensivo (se um legado aparecer). 'implementado' é entrega concluída → concluida (com data).
UPDATE public.sugestoes SET status = 'nova'              WHERE status IN ('aberta','pendente');
UPDATE public.sugestoes SET status = 'em_desenvolvimento' WHERE status = 'em_andamento';
UPDATE public.sugestoes SET
    status = 'concluida',
    concluido_em = COALESCE(concluido_em, updated_at, created_at, now())
  WHERE status IN ('concluido','resolvida','implementado');

-- (3) aperta o CHECK: só o canônico, e VALID (não mais NOT VALID). Após (2) nenhuma linha viola —
--     por isso valida de fato: o ledger não pode mais aceitar os dois vocabulários.
ALTER TABLE public.sugestoes DROP CONSTRAINT IF EXISTS sugestoes_status_fluxo_chk;
ALTER TABLE public.sugestoes ADD CONSTRAINT sugestoes_status_fluxo_chk
  CHECK (status IS NULL OR status = ANY (ARRAY[
    'nova','em_analise','aceita','em_desenvolvimento','concluida','recusada','duplicada','arquivada'
  ]::text[]));
