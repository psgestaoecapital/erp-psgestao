-- RD-98 p2: a tela de Apontamento (/dashboard/industrial/apontamento) tinha só "Corrigir"
-- (upsert) e não oferecia EXCLUIR rastreável. Esta migration adiciona o soft-delete no turno
-- (parente de ind_apontamentos_bovinos / ind_qualidade_sif / ind_custos_turno, todos por turno_id),
-- preservando o registro e deixando o rastro (quem/quando). A exclusão de fato é feita pela rota
-- com guarda de empresa (supabaseAdmin), que grava audit_log_global.
-- Aditiva e idempotente: só adiciona colunas; não altera RLS nem dado existente.
-- Faixa desenvolvedor_4_g (segundos :45).

ALTER TABLE public.ind_turnos ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ind_turnos ADD COLUMN IF NOT EXISTS excluido_por uuid;

COMMENT ON COLUMN public.ind_turnos.excluido_em  IS 'Soft-delete do turno (RD-98): quando foi excluído; NULL = ativo.';
COMMENT ON COLUMN public.ind_turnos.excluido_por IS 'Soft-delete do turno (RD-98): usuário que excluiu.';

-- Índice parcial pro filtro "ativos" (excluido_em IS NULL) por empresa/data, que a lista usa.
CREATE INDEX IF NOT EXISTS ix_ind_turnos_ativos
  ON public.ind_turnos (company_id, data)
  WHERE excluido_em IS NULL;

-- RD-95: "?" da coluna de ações (Corrigir / Excluir) da lista de turnos.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  ('industria.apontamento.acoes', '/dashboard/industrial/apontamento', 'Últimos turnos', 'Ações do turno',
   'Use "Corrigir" para carregar o turno no formulário e regravar os números; use "Excluir" para tirar o turno das listas e dos indicadores do dia.',
   'Corrigir substitui os valores do turno (mesma unidade, data e turno). Excluir é rastreável: preserva o registro, guarda quem excluiu e quando, e sai dos indicadores. Para reabrir, basta registrar o mesmo turno de novo.',
   'Ex.: lançou o turno A com peso errado → Corrigir e regravar. Lançou um turno duplicado por engano → Excluir.',
   'Excluir não apaga o histórico — é um arquivamento rastreável. Se precisar o valor certo, prefira Corrigir.',
   90, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, status = EXCLUDED.status;
