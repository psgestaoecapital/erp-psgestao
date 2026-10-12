// Gate — card "Fluxograma da Infra" na aba Codes (Eng. Chefe 12/10): lê fn_infra_fluxograma(), semáforo só de performance. Sem rede.
import { readFileSync } from 'node:fs'
import { corCode, corPortao, corPublicacao, corVigilancia, type FluxogramaInfra } from '../../src/lib/dev/fluxogramaInfra'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const base: FluxogramaInfra = { codes: [], papeis: {}, em_teste: 1, esperando: 2, ult_publicada_min: 10, relogio_ativo: true, auditores_ativos: 4,
  esteira: { portao_verde: true, portao_spec_falha: null, merges_24h: 10, intervalo_mediano_merge_min: 20, fila_parada: 0, fila_esperando: 2 } }
ok(corPortao(base) === 'verde' && corPortao({ ...base, esteira: { ...base.esteira, portao_verde: false } }) === 'vermelho', 'portão verde/vermelho')
ok(corPublicacao(10) === 'verde' && corPublicacao(60) === 'amarelo' && corPublicacao(120) === 'vermelho' && corPublicacao(null) === 'vermelho', 'publicação: 30/90 min')
const c = (status: string, lease_ativa: boolean) => corCode({ code: 'x', status, lease_ativa, backlog_antigo: 0, tarefas_recentes: 0 })
ok(c('trabalhando', true) === 'verde' && c('ocioso', false) === 'amarelo' && c('travado', true) === 'vermelho', 'Code: verde/amarelo/vermelho')
ok(corVigilancia(base) === 'verde' && corVigilancia({ ...base, auditores_ativos: 0 }) === 'amarelo' && corVigilancia({ ...base, relogio_ativo: false, auditores_ativos: 0 }) === 'vermelho', 'autovigilância')
const card = readFileSync('src/components/dev/FluxogramaInfra.tsx', 'utf8')
ok(card.includes("rpc('fn_infra_fluxograma')") && card.includes('25_000'), 'card lê a RPC com poll de 25 s')
ok(readFileSync('src/components/dev/PainelCodes.tsx', 'utf8').includes('<FluxogramaInfra />'), 'card montado na aba Codes')
ok(card.includes('aria-label="O que significa o fluxograma"'), 'tem "?"')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
