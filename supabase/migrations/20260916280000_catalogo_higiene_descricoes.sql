-- PR1 · HIGIENE DO CATÁLOGO (RD-51 aplicado a nós mesmos).
--
-- Achado: a descrição do module_catalog (texto VOLTADO AO CLIENTE) virou um tracker de build
-- ("Estado: placeholder/desconhecida/parcial/PRONTO") que envelhece e passa a MENTIR. Provado no dado:
--   /projetos/visitas       → dizia "Estado: placeholder"   · realidade: 260 linhas + 3 visitas reais (MENTIRA)
--   /projetos/oportunidades → sem estado / genérica          · realidade: Kanban com 15 oportunidades (em uso)
--   /projetos/engenharia    → dizia "Estado: placeholder"    · realidade: 442 linhas, tela real (MENTIRA)
--   /projetos/obras         → dizia "Estado: desconhecida"   · realidade: 430 linhas, tela real (MENTIRA)
--   /projetos/acompanhamento→ dizia "Estado: desconhecida"   · realidade: 21 linhas, esqueleto (é stub de verdade)
--
-- Correção: a descrição passa a DESCREVER A FUNÇÃO, sem carimbar estado de build (esse é papel de um
-- campo de status, não do texto que o cliente lê). Onde era mentira, some o rabo "Estado: ...".
-- Onde é stub de verdade (acompanhamento), o estado fica HONESTO ("em construção"), não "desconhecida".
-- (Auditoria completa: 10 rotas carregavam esse padrão; as demais — insumos/mão-obra "PRONTO",
--  catalogo "parcial" — batem com o dado e ficam como estão.)

UPDATE public.module_catalog SET descricao =
  'Registro e agendamento de visitas técnicas pré-proposta — GPS, fotos, responsável e anotações, ligados à oportunidade.'
 WHERE rota = '/dashboard/projetos/visitas';

UPDATE public.module_catalog SET descricao =
  'Funil de vendas em Kanban — oportunidades por etapa, com valor, cliente e obra. Origem das propostas.'
 WHERE rota = '/dashboard/projetos/oportunidades';

UPDATE public.module_catalog SET descricao =
  'Parâmetros de engenharia da proposta — BDI, margem alvo, validade e prazos de pagamento.'
 WHERE rota = '/dashboard/projetos/engenharia';

UPDATE public.module_catalog SET descricao =
  'Obras ativas com isolamento multi-empresa — acompanhamento e linha do tempo.'
 WHERE rota = '/dashboard/projetos/obras';

UPDATE public.module_catalog SET descricao =
  'Acompanhamento físico-financeiro de obras em execução. Em construção (esqueleto).'
 WHERE rota = '/dashboard/projetos/acompanhamento';
