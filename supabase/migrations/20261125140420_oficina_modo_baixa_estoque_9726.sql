-- Chamado #9726 (Mecânica Pesada e Borracharia 163) · item 1: CONFIGURAÇÃO POR EMPRESA
-- Na configuração da oficina (tempário), além de "modelo de atendimento" (tablet x centralizado),
-- a empresa escolhe COMO a baixa de estoque acontece:
--   'faturamento'    = comportamento atual (baixa na emissão da NF) — PADRÃO, preserva o que existe hoje
--   'baixar_estoque' = baixa ao clicar "Baixar estoque" na OS (item 3, implementado em PR própria)
-- Esta migration é ADITIVA (só adiciona coluna + texto de ajuda); não altera dado de cliente nem RLS.
-- A tela de tempário lê/grava erp_oficina_parametros diretamente (RLS por company já vigente na tabela).

-- 1) coluna de configuração (default preserva o comportamento atual)
ALTER TABLE public.erp_oficina_parametros
  ADD COLUMN IF NOT EXISTS modo_baixa_estoque text NOT NULL DEFAULT 'faturamento';

-- 2) domínio válido (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'erp_oficina_parametros_modo_baixa_estoque_chk'
      AND conrelid = 'public.erp_oficina_parametros'::regclass
  ) THEN
    ALTER TABLE public.erp_oficina_parametros
      ADD CONSTRAINT erp_oficina_parametros_modo_baixa_estoque_chk
      CHECK (modo_baixa_estoque IN ('faturamento', 'baixar_estoque'));
  END IF;
END $$;

-- 3) RD-95: "?" do campo novo na tela de tempário
INSERT INTO public.erp_ajuda_campo
  (rota, chave, grupo, ordem, rotulo, status, versao, vertical,
   o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('/dashboard/oficina/tempario', 'oficina.param.modo_baixa_estoque', 'Oficina', 60,
   'Baixa de estoque do item', 'publicado', 1, 'oficina',
   'Escolha quando o estoque das peças é baixado: no faturamento (ao emitir a nota, como é hoje) ou ao clicar em "Baixar estoque" na ordem de serviço.',
   'Define o momento da baixa física das peças. "Ao baixar na OS" permite controlar o estoque pelo que foi realmente usado no serviço, mesmo quando a peça não sai em nota (estoque sem nota).',
   'Oficina que trabalha de forma centralizada e usa peças sem nota escolhe "Ao clicar em Baixar estoque na OS".',
   'Trocar o modo com ordens em andamento: as baixas já feitas não mudam; o novo modo vale para as próximas.')
ON CONFLICT (chave) DO NOTHING;
