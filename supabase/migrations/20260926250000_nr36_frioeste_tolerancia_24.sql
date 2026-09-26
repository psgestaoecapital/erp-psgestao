-- Chamado #76 (Frioeste) · Régua de tolerância das pausas térmicas.
-- Resposta da cliente (sugestao_mensagem, 15/09 e 22/09): "Pausas até 23 devem contar como normais e a partir
-- de 24 como excedidas" → tolerancia_excesso_min passa de 23 para 24 (parâmetro POR EMPRESA em
-- nr36_pausa_regra.parametros; nada chumbado no código). Decisão do CEO (ctx 23d808b4): por migration idempotente.
--
-- Efeito provado em rollback (26/09, dado de produção, só Frioeste):
--   pausas com duracao_seg em [23,24) min: 61 → excesso ANTES, normal DEPOIS (a base cresceu: eram 44 em 15/09)
--   distribuição: normal 321→382 · excesso 157→96 · insuficiente 111 · não fechada 486 · aberta 187 (inalteradas)
--   status dos dias apurados (nr36_pausa_apurada): IGUAIS com régua 23 ou 24 — a régua não muda nenhum dia.
-- NÃO reapura aqui: reapurar ago–set mudaria 67 dias de "conforme" para "pendente_confirmacao" MESMO com a
-- régua 23 (controle em rollback) — efeito alheio ao #76, reportado ao CEO à parte.
-- Documentos já emitidos (relatório de 15/09, ciências mensais com hash) não são tocados (RD-55).
-- classe_evento é DERIVADO (inicio/fim/duracao_seg/raw intactos) — mesma regra de fn_nr36_classificar_eventos.

-- 1) Parâmetro (idempotente: rodar de novo mantém 24)
UPDATE public.nr36_pausa_regra
   SET parametros = parametros || '{"tolerancia_excesso_min":24}'::jsonb
 WHERE company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
   AND tipo = 'termica_253'
   AND (parametros->>'tolerancia_excesso_min') IS DISTINCT FROM '24';

-- 2) Reclassifica os eventos da empresa pela régua dela (plain UPDATE, sem assert — roda no db push)
UPDATE public.ind_ponto_pausa p
   SET classe_evento = CASE
     WHEN p.fim IS NULL OR p.em_aberto IS TRUE THEN 'pausa_aberta'
     WHEN p.duracao_seg/60.0 < v.pmin          THEN 'pausa_insuficiente'
     WHEN p.duracao_seg/60.0 < v.tol           THEN 'pausa_normal'
     WHEN p.duracao_seg/60.0 <= v.esq          THEN 'pausa_excesso'
     ELSE 'pausa_nao_fechada' END
  FROM (
    SELECT COALESCE((r.parametros->>'pausa_min')::numeric, 20)               AS pmin,
           COALESCE((r.parametros->>'tolerancia_excesso_min')::numeric, 23)  AS tol,
           COALESCE((r.parametros->>'limite_esquecimento_min')::numeric, 45) AS esq
      FROM public.nr36_pausa_regra r
     WHERE r.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8' AND r.tipo = 'termica_253' AND r.ativo
     LIMIT 1
  ) v
 WHERE p.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8';
