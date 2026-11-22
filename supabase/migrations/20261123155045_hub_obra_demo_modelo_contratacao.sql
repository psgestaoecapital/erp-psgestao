-- Hub · Gestão de Obras · Ficha da obra (blueprint vivo tela 314 "obra como cadastro central") — SEED DEMO.
-- Requisito §314 "parcial": "Modelo de contratação da obra (administração, empreitada global, empreitada
-- por preço unitário, outro), que define como medir e faturar" + "própria × gerenciada para o contratante"
-- (tipo_execucao). A ficha JÁ lê/grava esses campos (fn_obra_ficha_ler/_identidade_salvar, com "?"), mas
-- nas obras da DEMO eles estavam NULL — a tela mostrava "Não informado/Não classificada" e o aud8 não
-- conseguia pontuar o requisito (gap 21/11 em /dashboard/projetos/obras, nota 94).
--
-- Esta migration é ADITIVA e só preenche dados de DEMONSTRAÇÃO, exclusivamente na Construtora Modelo - DEMO
-- (empresa b0700000-0000-4000-a000-000000000006) e só onde o campo está NULL (não sobrescreve nada que o
-- usuário tenha classificado). Valores conforme os selects da própria ficha (EXECUCAO/MODELOS). Não cria
-- tabela, não mexe em RLS/grants, núcleo, RPC nem dado de cliente real. Idempotente (o filtro IS NULL faz
-- a 2ª passada não mudar nada).

DO $seed$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000006';
  v_row record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projetos_obras WHERE company_id = v_company LIMIT 1) THEN
    RAISE NOTICE 'Empresa DEMO % sem obras; seed de classificação ignorado.', v_company;
    RETURN;
  END IF;

  FOR v_row IN
    SELECT * FROM (VALUES
      ('11a80fcc-0c9c-492b-b993-08df3a74fd77'::uuid, 'terceiros', 'empreitada_preco_unitario'),
      ('ecef61b7-77d1-45d1-ba9c-49f35e25b932'::uuid, 'terceiros', 'empreitada_global'),
      ('0e995085-560d-4f30-be11-99a4cfdb9608'::uuid, 'terceiros', 'administracao'),
      ('51db2096-e659-4bf4-84fb-3dab98746ba6'::uuid, 'propria',   'empreitada_global'),
      ('5a016907-af97-4736-bea4-8057380f3966'::uuid, 'terceiros', 'empreitada_preco_unitario')
    ) AS t(obra_id, tipo_execucao, modelo_contratacao)
  LOOP
    -- só classifica onde ainda está em branco (idempotente; preserva o que o usuário tiver definido)
    UPDATE public.projetos_obras
       SET tipo_execucao     = COALESCE(tipo_execucao, v_row.tipo_execucao),
           modelo_contratacao = COALESCE(modelo_contratacao, v_row.modelo_contratacao),
           updated_at = now()
     WHERE id = v_row.obra_id
       AND company_id = v_company
       AND deleted_at IS NULL
       AND (tipo_execucao IS NULL OR modelo_contratacao IS NULL);
  END LOOP;

  RAISE NOTICE 'Seed de classificação (tipo_execucao/modelo_contratacao) das obras DEMO aplicado.';
END $seed$;
