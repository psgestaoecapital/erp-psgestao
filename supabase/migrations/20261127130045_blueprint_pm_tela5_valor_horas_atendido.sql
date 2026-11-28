-- Reconciliação de baseline (RD-38: PROMETIDO vs REAL) — P&M tela 5 "Catálogo de Serviços".
-- Requisito ESSENCIAL "Valor base + horas estimadas" estava 'parcial', mas JÁ está 100% entregue
-- na main em src/app/dashboard/pm/servicos/page.tsx (CRUD por fn_agency_servico_salvar/listar):
--   • tipo Servico tem valor_base e horas_estimadas (linha ~24);
--   • o payload de gravação envia os dois campos (linha ~78-79);
--   • a lista exibe "R$ valor_base/unidade" e "· Nh" (linha ~126-127);
--   • o formulário tem os campos "Valor base (R$)" (ajuda pm.servico.valor_base) e
--     "Horas estimadas" (ajuda pm.servico.horas) — linha ~175 e ~180, com "?" (RD-95).
-- Portanto o requisito está ATENDIDO; a baseline mentia (RD-38). Esta migration só corrige o
-- registro de verdade do blueprint — NÃO toca código, dado de cliente, RLS, grants nem funções.
-- blueprint_tela_requisito é catálogo interno de requisitos (sem dado pessoal). Aditiva e idempotente
-- (guarda WHERE status_baseline='parcial' e id fixo; re-rodar não muda nada).

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido',
       evidencia_baseline = 'main · /dashboard/pm/servicos · fn_agency_servico_salvar grava valor_base + horas_estimadas; lista e form exibem os dois (com "?" RD-95). Reconciliação RD-38.'
 WHERE id = 'f4427bda-d6fb-477d-ac0d-d2c960da9bb5'
   AND status_baseline = 'parcial';
