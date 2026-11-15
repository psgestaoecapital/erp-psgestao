-- Order-to-Cash (/dashboard/commerce/otc) · assistente "Novo orçamento" — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): no assistente de novo orçamento da tela OTC, os campos "Buscar
--   cliente" (passo 1) e "Observações ao cliente" (passo 2) não tinham "?".
-- CORREÇÃO (aditiva, idempotente): 2 chaves NOVAS no grupo "Comércio · OTC".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('otc.novo.buscar_cliente', '/dashboard/commerce/otc', 'Comércio · OTC', 'Buscar cliente',
   'Digite o nome, a razão social ou o CNPJ do cliente que vai receber o orçamento. Se ainda não existe, cadastre na hora pelo botão de novo cliente.',
   'Amarra o orçamento ao cliente certo: é dele que vêm os dados fiscais e para quem o pedido e o faturamento serão gerados mais à frente.',
   'Digitar "12.345" já filtra os clientes cujo CNPJ começa assim; "Maria" filtra pelo nome.',
   'Criar um orçamento sem selecionar o cliente deixa o pedido órfão e trava o faturamento depois — escolha ou cadastre antes de avançar.',
   'geral', 9243),
  ('otc.novo.observacoes', '/dashboard/commerce/otc', 'Comércio · OTC', 'Observações ao cliente',
   'Texto livre e opcional que sai impresso no orçamento para o cliente ler (condições, prazos, avisos).',
   'Comunica combinados que não cabem nos itens — prazo de entrega, condição de pagamento, validade — direto no documento que o cliente recebe.',
   'Validade da proposta: 15 dias · Entrega em até 10 dias úteis após o pedido.',
   'Escrever aqui uma informação interna (custo, margem) é um erro: este texto é visível ao cliente no orçamento.',
   'geral', 9244)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
