-- OFICINA · ACENDER A CADEIA (decisão do CEO). Liga os 6 módulos operacionais no menu (ativo=true).
-- A cadeia foi construída em dark-launch (ativo=false); agora surge p/ a mecânica testar na tela.
-- system_screens seguem 'parcial' até a validação real na tela (RD-51: não mente estado).
-- REVERSÍVEL com 1 comando: UPDATE module_catalog SET ativo=false WHERE id IN (...os 6...).
-- 🔒 nada de financeiro muda aqui — é só surfacing de menu.

UPDATE public.module_catalog SET ativo = true
WHERE id IN (
  'oficina_recepcao',            -- L1 Recepção
  'oficina_diagnostico',         -- L2 Diagnóstico
  'oficina_aprovacao_cliente',   -- L3/L3.1 Orçamento & Aprovação
  'oficina_apontamento_mecanico',-- L4 Apontamento
  'oficina_veiculos_fipe',       -- L5 Veículos (rota já ajustada p/ /dashboard/oficina/veiculos)
  'oficina_comissao'             -- L7 Comissão
);
