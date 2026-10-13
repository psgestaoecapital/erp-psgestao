-- ============================================================
-- Onda 7 · selos que mentem (RD-58) — 4 telas em produção pesada marcadas como 'parcial'
-- ============================================================
-- O selo alimenta menu, catálogo de módulos e a percepção de quem compra a vertical. Estas quatro têm
-- uso pesado comprovado no dado (RD-38) e estão 'parcial' — corrigir para 'pronto':
--   recepcao   → 183 OS (recepções)      diagnostico → 724 itens
--   aprovacao  → 668 itens aprovados     veiculos    → 139 placas
-- NÃO tocadas de propósito (fora de escopo):
--   comissao (0 regras → 'parcial' correto), apontamento (Onda 1 acabou de mudar → reavaliar após teste),
--   solicitacoes (é adoção, não selo), agenda (é tela REAL com 60 agendamentos — decisão do CEO se vira 'pronto').
-- Guarda WHERE estado_real='parcial' pra ser idempotente e não pisar em mudança futura.

UPDATE public.system_screens
   SET estado_real = 'pronto', atualizado_em = now()
 WHERE area = 'oficina'
   AND estado_real = 'parcial'
   AND rota IN (
     '/dashboard/oficina/recepcao',
     '/dashboard/oficina/diagnostico',
     '/dashboard/oficina/aprovacao',
     '/dashboard/oficina/veiculos'
   );
