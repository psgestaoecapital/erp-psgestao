-- Plano de contas GLOBAL (psgc_contas) — correção na origem, para todas as empresas.
-- Decisão do CEO: a 6.2 misturava pró-labore (despesa operacional, correto) com distribuição de
-- lucro (movimento de patrimônio, não é DRE). Separar na origem. Momento seguro: psgc_dre tem
-- ZERO linhas em 6.2 (de 3.153 no total) — nenhum resultado histórico é reescrito.
-- Idempotente: pode reaplicar sem efeito colateral (por isso o db push, se rodar, é no-op).

-- (1) 6.2 vira só "Pró-Labore"; keywords ficam só as de pró-labore. Mantém DESP_FIXA/afeta_ebitda/imutavel.
UPDATE public.psgc_contas
   SET nome = 'Pró-Labore',
       keywords = ARRAY['pro labore','prolabore','pro-labore'],
       versao = versao + 1, updated_at = now()
 WHERE codigo = '6.2'
   AND (nome <> 'Pró-Labore' OR keywords IS DISTINCT FROM ARRAY['pro labore','prolabore','pro-labore']);

-- (2) 0.3 nova: distribuição de resultado aos sócios. Padrão NEUTRO das 0.1/0.2 (não é linha de DRE),
--     porém imutavel=false (decisão do CEO — pode ser ajustada depois).
INSERT INTO public.psgc_contas
  (codigo, nome, nivel, pai_codigo, natureza, dre_grupo, dre_ordem, tipo,
   afeta_margem_bruta, afeta_margem_contribuicao, afeta_ebitda, descricao, keywords, ativo, imutavel, versao)
VALUES
  ('0.3', 'Distribuição de Resultado aos Sócios', 2, NULL, 'nao_operacional', 'NEUTRO', 0, 'estrutural',
   false, false, false,
   'Distribuição de lucro/resultado aos sócios — movimento de patrimônio, não é despesa nem afeta o resultado',
   ARRAY['distribuicao de lucros','retirada socios','retirada de socios','participacao societaria','participações societárias','dividendos'],
   true, false, 1)
ON CONFLICT (codigo) DO NOTHING;

-- (3) Participação societária → 0.3 (distribuição), não mais despesa.
UPDATE public.psgc_depara
   SET psgc_codigo = '0.3', updated_at = now()
 WHERE ativo = true AND psgc_codigo = '6.2' AND origem_descricao = 'Participações Societárias';

-- (4) Empréstimo de sócio (dev. e recebimento) → 8.3 (Parcelas de Empréstimos/Financiamentos, RESULT_FIN).
--     A 8.3 já era o destino correto de parte das empresas; estes eram os desalinhados. Corrige o caso
--     grave: "Receb Empr Sócios" era dinheiro ENTRANDO numa conta de despesa (piorava o resultado ao receber).
UPDATE public.psgc_depara
   SET psgc_codigo = '8.3', updated_at = now()
 WHERE ativo = true AND psgc_codigo = '6.2'
   AND origem_descricao IN ('Dev. Empréstimos Sócios','Receb Empr Sócios/Funcion.');

-- (5) Tira a keyword órfã "participacoes societarias" da 0.2 (Adiantamentos e Estornos). Participação
--     societária não é adiantamento nem estorno; deixá-la lá deixaria 0.2 e 0.3 disputando a mesma
--     origem no matcher desde o primeiro dia (RD-52). Nenhum dos 15 de-paras da 0.2 usa essa palavra.
UPDATE public.psgc_contas
   SET keywords = array_remove(keywords, 'participacoes societarias'),
       versao = versao + 1, updated_at = now()
 WHERE codigo = '0.2' AND 'participacoes societarias' = ANY (keywords);
