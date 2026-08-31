-- SIC-F1 §4 · gate CONSCIENTE da escada de teste em PRODUÇÃO.
-- A recusa de produção deixa de ser absoluta, mas continua existindo. Só passa quando:
--   (1) a chamada traz opt-in explícito (confirmo_boleto_real=true) — nunca default, nunca env;
--   (2) o provider homologa em produção (flag do MANIFESTO abaixo) — 🧊 Sicoob/Bradesco = false = BARRADOS;
--   (3) valor do teste ≤ R$ 1,00 (teto na rota);
--   (4) o título vive em erp_banco_teste_titulo, NUNCA em erp_receber (já era assim);
--   (5) fica registrado quem autorizou e quando (colunas abaixo).
-- Gate lido do manifesto, JAMAIS `if provider === 'sicredi'` (RD-57: trava por dado, não por hardcode).

ALTER TABLE public.erp_banco_manifesto
  ADD COLUMN IF NOT EXISTS homologa_em_producao boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.erp_banco_manifesto.homologa_em_producao IS
  'true = o provedor permite testar/homologar em produção (ex.: Sicredi, cuja Cartilha recomenda criar direto em produção). Gate da escada real. NUNCA substituir por if provider===x.';

-- Sicredi homologa em produção; Sicoob e Bradesco NÃO (seguem barrados pela regra antiga).
UPDATE public.erp_banco_manifesto SET homologa_em_producao = true  WHERE provider = 'sicredi';
UPDATE public.erp_banco_manifesto SET homologa_em_producao = false WHERE provider IN ('sicoob','bradesco');

-- Quem autorizou o teste REAL e quando. O Sicredi diz: pagar e baixar o título de teste é responsabilidade nossa.
ALTER TABLE public.erp_banco_teste_titulo
  ADD COLUMN IF NOT EXISTS autorizado_por uuid,
  ADD COLUMN IF NOT EXISTS autorizado_em  timestamptz;
