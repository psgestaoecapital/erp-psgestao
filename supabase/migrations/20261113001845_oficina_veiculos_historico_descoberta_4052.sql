-- Chamado #4052 — "Histórico do veículo": o cliente (Gean/Oficina) não encontra
-- onde consultar o que já foi registrado de um veículo atendido.
--
-- A tela JÁ EXISTE e está acessível (/dashboard/oficina/veiculos, em system_screens,
-- módulo oficina_veiculos_fipe ativo no plano da empresa). O gap é de DESCOBERTA:
-- o atalho/menu se chama apenas "Veículos" e não tem ícone, então quem procura o
-- HISTÓRICO do veículo não reconhece que é ali. Esta migration só renomeia o rótulo
-- do módulo para "Histórico de Veículos" e dá o ícone Car (mesmo da própria tela),
-- deixando o item óbvio no menu lateral e nos atalhos da home da Oficina.
--
-- Aditiva/idempotente: UPDATE pontual por id, não toca rota, status, plano nem dado
-- de cliente. module_catalog é catálogo global (sem company_id/RLS por empresa).
-- RD-38 (prova no PR): antes nome='Veículos', icone=null; depois 'Histórico de
-- Veículos'/'Car'; mesma 1 linha, rota inalterada.

UPDATE public.module_catalog
   SET nome  = 'Histórico de Veículos',
       icone = 'Car'
 WHERE id = 'oficina_veiculos_fipe'
   AND rota = '/dashboard/oficina/veiculos';
