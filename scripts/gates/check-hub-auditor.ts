// Gate do auditor do Hub (eng-chefe-auto, guardião da RD-97). Trava as invariantes de SEGURANÇA da ferramenta de
// auditoria para que ninguém as afrouxe sem querer:
//   1. a lista de ações PROIBIDAS de clicar cobre os verbos perigosos (emitir/pagar/aprovar/conciliar/enviar/excluir…);
//   2. uma ação proibida NUNCA é tratada como "segura de abrir" (a proibição vence);
//   3. as rotas auditadas são SÓ do Hub (/dashboard/projetos) e a empresa é a DEMO;
//   4. o mapeador PR→rotas acerta Hub vs não-Hub.
// Estático e sem rede (roda no build e no workflow de gates).

import {
  ACOES_PROIBIDAS, carregarRotas, ehAcaoProibida, ehAcaoSeguraDeAbrir,
} from '../auditoria/hub-seguranca'
import { mapearRotas } from '../auditoria/pr-rotas-tocadas'

const falhas: string[] = []
const exigir = (cond: boolean, msg: string) => { if (!cond) falhas.push(msg) }

// 1. verbos perigosos obrigatórios na lista de proibidos
const OBRIGATORIOS = ['emitir', 'transmitir', 'pagar', 'aprovar', 'conciliar', 'enviar', 'excluir', 'nfe', 'nfse', 'integrar', 'cofre', 'assinar']
for (const v of OBRIGATORIOS) {
  exigir(ACOES_PROIBIDAS.some((p) => p.includes(v)), `ACOES_PROIBIDAS não cobre "${v}"`)
}

// 2. exemplos reais de rótulo — proibida vence
exigir(ehAcaoProibida('Emitir NF-e'), 'ehAcaoProibida("Emitir NF-e") deveria ser true')
exigir(ehAcaoProibida('Pagar conta'), 'ehAcaoProibida("Pagar conta") deveria ser true')
exigir(ehAcaoProibida('Enviar por WhatsApp'), 'ehAcaoProibida("Enviar por WhatsApp") deveria ser true')
exigir(!ehAcaoSeguraDeAbrir('Emitir NF-e'), 'ação proibida "Emitir NF-e" NUNCA pode ser "segura de abrir"')
exigir(!ehAcaoSeguraDeAbrir('Excluir obra'), 'ação proibida "Excluir obra" NUNCA pode ser "segura de abrir"')
exigir(ehAcaoSeguraDeAbrir('Incluir insumo'), 'ehAcaoSeguraDeAbrir("Incluir insumo") deveria ser true')
exigir(ehAcaoSeguraDeAbrir('Nova obra'), 'ehAcaoSeguraDeAbrir("Nova obra") deveria ser true')
exigir(!ehAcaoProibida('Incluir insumo'), 'ehAcaoProibida("Incluir insumo") deveria ser false')

// 3. rotas só do Hub + empresa DEMO (carregarRotas já valida e lança; aqui confirmamos o conteúdo)
try {
  const { empresa_demo, rotas } = carregarRotas()
  exigir(empresa_demo === 'b0700000-0000-4000-a000-000000000006', `empresa_demo deveria ser a Construtora Modelo DEMO (veio "${empresa_demo}")`)
  exigir(rotas.length > 0, 'hub-rotas.json não tem rotas')
  exigir(rotas.every((r) => r.rota.startsWith('/dashboard/projetos')), 'toda rota tem de começar em /dashboard/projetos')
} catch (e) {
  falhas.push('carregarRotas() lançou: ' + (e instanceof Error ? e.message : String(e)))
}

// 4. mapeador PR→rotas
const hub = mapearRotas(['src/app/dashboard/projetos/insumos/page.tsx', 'src/lib/foo.ts'])
exigir(hub.tocou_hub && hub.rotas_hub.includes('/dashboard/projetos/insumos') && hub.veredito === 'auditoria-completa',
  'mapearRotas deveria marcar auditoria-completa para page.tsx do Hub')
const naoHub = mapearRotas(['src/app/dashboard/financeiro/pagar/page.tsx', 'README.md'])
exigir(!naoHub.tocou_hub && naoHub.veredito === 'checagem-barata',
  'mapearRotas deveria marcar checagem-barata para PR fora do Hub')

if (falhas.length) {
  console.error('✗ check-hub-auditor: ' + falhas.length + ' falha(s):')
  for (const f of falhas) console.error('  - ' + f)
  process.exit(1)
}
console.log('✓ check-hub-auditor: invariantes de segurança do auditor do Hub OK')
