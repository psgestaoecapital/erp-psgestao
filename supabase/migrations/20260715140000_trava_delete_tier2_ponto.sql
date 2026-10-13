-- RD-54 TIER 2 · trava de DELETE físico no PONTO (ind_ponto_*) — base da folha
-- ============================================================================
-- RD-54 aplicada à trava (mapeado nos DOIS lados antes deste ALTER):
--  • CÓDIGO (api/industrial/ponto/sync + sync-diario): os 4 writers são UPSERT (ON CONFLICT),
--    NENHUM .delete() — ind_ponto_dia (company_id,cpf,data), ind_ponto_marcacao (company_id,point_id),
--    ind_ponto_colaborador (company_id,provider,cpf), ind_ponto_horas (company_id,provider,cpf,periodo_inicio,periodo_fim).
--  • BANCO: pg_proc = 0 funções com "DELETE FROM ind_ponto*".
--  → O re-sync NUNCA deleta → a trava NÃO quebra o sync. Escape (set_config) fica só p/ manutenção admin.
-- Só cria triggers — não toca dado (RD-54).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON ind_ponto_dia;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON ind_ponto_dia
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON ind_ponto_marcacao;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON ind_ponto_marcacao
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON ind_ponto_colaborador;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON ind_ponto_colaborador
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON ind_ponto_horas;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON ind_ponto_horas
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();
