-- Hub · Orçamento em 3 blocos: Serviço/M.O. (servico) · Material (produto) · Despesas/Omissos (despesa, NOVO) + frente.
-- Demanda Diego (FC Pisos, 24/11), GENÉRICA p/ todo o Hub (despesa indireta/omisso e divisão por frente servem qualquer prestador/obra).
-- Orçamento VIVO: erp_orcamentos_itens (conferido RD-38: 333 itens = 270 produto + 63 servico; 1103 orçamentos).
-- tipo_item é text + 2 CHECKs. ADITIVO + reescrita IDEMPOTENTE dos 2 CHECKs. Colunas de item que o omisso precisa
-- (unidade/quantidade/preco_unitario/subtotal) JÁ existem; faltava o tipo 'despesa', 3 colunas aditivas e o render.
--
-- Prova RD-38 (no corpo da PR + validada em cópia local): ADD COLUMN IF NOT EXISTS e DROP CONSTRAINT IF EXISTS + ADD são
-- idempotentes; as 333 linhas produto/servico continuam válidas no CHECK novo (ramos preservados); contagem antes=depois.

-- ── 3 colunas aditivas (todas nullable → não tocam as 333 linhas) ──
ALTER TABLE public.erp_orcamentos_itens ADD COLUMN IF NOT EXISTS categoria_despesa text;  -- só p/ tipo_item='despesa'
ALTER TABLE public.erp_orcamentos_itens ADD COLUMN IF NOT EXISTS frente text;             -- divisão livre por área/parte (N partes)
ALTER TABLE public.erp_orcamentos_itens ADD COLUMN IF NOT EXISTS reembolsavel boolean;    -- despesa/omisso: é reembolsável?

-- ── tipo_item: acrescenta 'despesa' preservando produto|servico ──
ALTER TABLE public.erp_orcamentos_itens DROP CONSTRAINT IF EXISTS chk_orc_item_tipo;
ALTER TABLE public.erp_orcamentos_itens ADD CONSTRAINT chk_orc_item_tipo
  CHECK (tipo_item = ANY (ARRAY['produto'::text, 'servico'::text, 'despesa'::text]));

-- ── ref compatível: preserva os 3 ramos atuais + ramo despesa (linha livre: descrição em produto_nome, sem produto/serviço) ──
ALTER TABLE public.erp_orcamentos_itens DROP CONSTRAINT IF EXISTS chk_orc_item_ref_compativel;
ALTER TABLE public.erp_orcamentos_itens ADD CONSTRAINT chk_orc_item_ref_compativel
  CHECK (
       ((tipo_item = 'produto'::text) AND (produto_id IS NOT NULL))
    OR ((tipo_item = 'servico'::text) AND (servico_id IS NOT NULL))
    OR ((tipo_item = 'produto'::text) AND (produto_id IS NULL) AND (produto_nome IS NOT NULL))
    OR ((tipo_item = 'despesa'::text) AND (produto_nome IS NOT NULL) AND (produto_id IS NULL) AND (servico_id IS NULL))
  );

-- ── categoria_despesa: lista fixa quando preenchida (nullable) ──
ALTER TABLE public.erp_orcamentos_itens DROP CONSTRAINT IF EXISTS chk_orc_item_categoria_despesa;
ALTER TABLE public.erp_orcamentos_itens ADD CONSTRAINT chk_orc_item_categoria_despesa
  CHECK (categoria_despesa IS NULL OR categoria_despesa = ANY (ARRAY[
    'hospedagem'::text,'alimentacao'::text,'deslocamento'::text,'equipamento'::text,'diarias'::text,'outros'::text]));

-- ── RD-95: ajuda dos campos novos (agrupada, aditiva, idempotente por chave) ──
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
 ('projetos.orcamento.frente', '/dashboard/projetos/propostas', 'Orçamento', 'Frente / parte',
  'Nome da área ou parte do serviço a que este item pertence (deixe em branco se o orçamento é único).',
  'Permite dividir o orçamento em partes (áreas, pavimentos, zonas) e ver o subtotal de cada uma.',
  'Área 1 — Pavimento térreo', 'Escrever o mesmo nome de formas diferentes ("Area1" e "Área 1") — vira duas frentes.', 'projetos', 10),
 ('projetos.orcamento.frente_agrupar', '/dashboard/projetos/propostas', 'Orçamento', 'Agrupar por frente',
  'Ligue para agrupar os itens por frente e ver o subtotal de cada parte.',
  'Mostra quanto custa cada área/parte do serviço separadamente, além do total geral.',
  'Ligado', 'Achar que some itens — só reorganiza a exibição; nada é apagado.', 'projetos', 11),
 ('projetos.orcamento.despesa.adicionar', '/dashboard/projetos/propostas', 'Despesas/Omissos', 'Adicionar despesa/omisso',
  'Inclui uma linha de custo indireto que não é material nem mão de obra (hospedagem, alimentação, mobilização...).',
  'Fecha o orçamento com os custos que todo prestador de campo esquece e que corroem a margem.',
  'Hospedagem da equipe — 5 diárias', 'Jogar esses custos no preço do serviço e perder a visibilidade deles.', 'projetos', 20),
 ('projetos.orcamento.despesa.descricao', '/dashboard/projetos/propostas', 'Despesas/Omissos', 'Descrição da despesa',
  'Descreva o custo indireto/omisso desta linha.',
  'Identifica a despesa na proposta e no total do bloco de omissos.',
  'Hospedagem da equipe em Guarujá', 'Deixar vago ("outros") — descreva para o cliente entender o que paga.', 'projetos', 21),
 ('projetos.orcamento.despesa.categoria', '/dashboard/projetos/propostas', 'Despesas/Omissos', 'Categoria',
  'Escolha o tipo da despesa: Hospedagem, Alimentação, Deslocamento/Mobilização, Equipamento, Diárias ou Outros.',
  'Agrupa e compara os custos indiretos entre orçamentos e obras.',
  'Hospedagem', 'Usar "Outros" para tudo — perde a análise por categoria.', 'projetos', 22),
 ('projetos.orcamento.despesa.unidade', '/dashboard/projetos/propostas', 'Despesas/Omissos', 'Unidade',
  'A unidade de cobrança da despesa (diária, verba, km, unidade...).',
  'Deixa claro como a despesa foi calculada.',
  'diária', 'Misturar unidade e quantidade (ex.: "5 diárias" no campo unidade).', 'projetos', 23),
 ('projetos.orcamento.despesa.quantidade', '/dashboard/projetos/propostas', 'Despesas/Omissos', 'Quantidade',
  'Quantas unidades desta despesa.',
  'Multiplica pelo preço unitário para dar o total da linha.',
  '5', 'Deixar 0 — a linha fica sem valor e não soma no bloco.', 'projetos', 24),
 ('projetos.orcamento.despesa.preco_unitario', '/dashboard/projetos/propostas', 'Despesas/Omissos', 'Preço unitário',
  'Valor de uma unidade da despesa.',
  'Base do total da linha (quantidade × preço unitário) e do subtotal de omissos.',
  'R$ 180,00', 'Digitar o total no lugar do unitário — infla a despesa pela quantidade.', 'projetos', 25),
 ('projetos.orcamento.despesa.reembolsavel', '/dashboard/projetos/propostas', 'Despesas/Omissos', 'Reembolsável',
  'Marque se esta despesa será reembolsada pelo cliente (repassada) em vez de embutida no preço.',
  'Separa o que é custo seu do que o cliente devolve — ajuda a negociar e a prestar contas.',
  'Sim, para hospedagem', 'Marcar reembolsável e também embutir no preço — cobra duas vezes.', 'projetos', 26),
 ('projetos.orcamento.bloco.subtotal', '/dashboard/projetos/propostas', 'Orçamento', 'Subtotal do bloco',
  'Indicador (só leitura): a soma dos itens de um bloco (Serviços, Materiais ou Despesas).',
  'Mostra o peso de cada parte do orçamento; os três somados dão o total geral.',
  'Serviços R$ 12.000', 'Comparar subtotal de blocos com o total geral — são coisas diferentes.', 'projetos', 30),
 ('projetos.orcamento.total_geral', '/dashboard/projetos/propostas', 'Orçamento', 'Total geral',
  'Indicador (só leitura): Serviços + Materiais + Despesas/Omissos.',
  'É o valor cheio do orçamento, já com os custos indiretos que costumam ficar de fora.',
  'R$ 27.500', 'Esquecer os omissos e fechar preço só com serviço + material.', 'projetos', 31)
ON CONFLICT (chave) DO NOTHING;
