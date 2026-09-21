-- Revenda R4-fix (prova) · mapeia a jornada 'vendas' aos 2 requisitos da T10 que o juiz apontou como
-- não-provados na tela: "Disparo para erp_receber da GE" (títulos visíveis por recebimento) e "Acerto de
-- contas previsto × realizado ao fechar". A jornada 'vendas' já cobre ambos:
--   • o teste "títulos na GE aparecem" prova o disparo/ligação recebimento ↔ erp_receber na tela;
--   • o teste 'acerto_previsto_realizado' abre o acerto e confere previsto × realizado.
-- Quando a jornada 'vendas' roda verde, fn_blueprint_cobertura marca esses requisitos como 'atendido'
-- (jornada verde prevalece sobre a foto). Aditivo/idempotente; casado por tela_num + texto (robusto a id).
-- Nada de regra fixa, nada de dado novo — só o vínculo prova↔requisito. RD-38/65/70.

INSERT INTO public.jornada_requisito (vertical, jornada, requisito_id)
SELECT 'revenda_veiculos', m.jornada, r.id
FROM (VALUES
  ('vendas', 10, 'Disparo para erp_receber da GE%'),
  ('vendas', 10, 'Acerto de contas previsto × realizado%')
) AS m(jornada, tela_num, req_like)
JOIN public.blueprint_tela_requisito r
  ON r.vertical = 'revenda_veiculos' AND r.tela_num = m.tela_num AND r.requisito LIKE m.req_like
ON CONFLICT (jornada, requisito_id) DO NOTHING;
