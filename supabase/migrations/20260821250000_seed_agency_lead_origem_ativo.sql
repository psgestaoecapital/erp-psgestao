-- CRM/P&M · Demanda Luzardo: semear agency_lead_origem no deploy (não-lazy) pra a tela Origens não
-- abrir vazia. O #1092 fez seed LAZY (só na 1ª leitura da RPC); a PDois/agência abriram vazias (0).
--
-- Semeia as MESMAS 9 origens do fn_agency_origens_listar (7 do SPEC + 2 slugs legados que casam os leads
-- existentes) pra TODA empresa que já tem lead (agency_leads) — cobre PDois e a agência. Idempotente.
-- NÃO migra canal_contato → origem (decisão do CEO: adiar até o Luzardo confirmar — RD-54, não borrar
-- os 2 conceitos "como contatou" × "de onde veio").

INSERT INTO public.agency_lead_origem (company_id, chave, nome, ordem)
SELECT c.company_id, d.chave, d.nome, d.ordem
FROM (SELECT DISTINCT company_id FROM public.agency_leads) c
CROSS JOIN (VALUES
  ('whatsapp','WhatsApp',10),
  ('site','Site',20),
  ('indicacao','Indicação',30),
  ('trafego_pago','Tráfego Pago',40),
  ('ligacao','Ligação',50),
  ('email','E-mail',60),
  ('evento','Evento',70),
  ('relacionamento','Relacionamento',80),
  ('prospeccao_ia_fria','Prospecção IA (fria)',90)
) AS d(chave,nome,ordem)
ON CONFLICT (company_id, chave) DO NOTHING;
