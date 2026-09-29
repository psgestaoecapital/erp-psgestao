/**
 * Gate de build: tela de vínculos gerencial × contábil (CEO 29/09 · FC). Vínculo PROPOSTO (editável) → CONFIRMADO
 * (imutável); várias contábeis podem ir para a mesma gerencial (unicidade pela CONTÁBIL); filtro padrão = pendências;
 * ações em massa só no que a regra permite.
 *   tsx scripts/check-vinculos-contabil.ts
 */
import { readFileSync } from 'node:fs'
import { FILTRO_PADRAO, alvosDaSelecao, contarVinculos, editavel, filtrarVinculos, statusDaLinha, type LinhaVinculoTela } from '../src/lib/contabil/vinculosTela'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const L = (cod: string, status: 'proposto' | 'confirmado' | null, ger: string | null = null): LinhaVinculoTela => ({
  conta_contabil_id: `c-${cod}`, cont_codigo: cod, cont_descricao: `Conta ${cod}`, cont_codigo_antigo: null,
  vinculo_id: status ? `v-${cod}` : null, status, plano_conta_id: ger ? `g-${ger}` : null, ger_codigo: ger, ger_descricao: ger ? `Ger ${ger}` : null,
  confirmado_em: status === 'confirmado' ? '2026-09-29' : null, origem: null,
})
const linhas = [L('5.01', null), L('5.02', 'proposto', '2.02'), L('5.03', 'confirmado', '2.02'), L('5.04', 'proposto', '2.03')]

// 1) estados e regra
ok(statusDaLinha(linhas[0]) === 'sem_vinculo' && statusDaLinha(linhas[1]) === 'proposto' && statusDaLinha(linhas[2]) === 'confirmado', 'estados: sem vínculo, proposto, confirmado')
ok(editavel(linhas[0]) && editavel(linhas[1]) && !editavel(linhas[2]), 'confirmado não é editável')

// 2) filtro padrão = pendências (sem vínculo + propostos)
ok(FILTRO_PADRAO === 'pendencias', 'o filtro padrão é "pendências"')
ok(filtrarVinculos(linhas, 'pendencias').map((l) => l.cont_codigo).join(' ') === '5.01 5.02 5.04', 'pendências = sem vínculo + propostos')
ok(filtrarVinculos(linhas, 'confirmado').length === 1 && filtrarVinculos(linhas, 'todas').length === 4, 'filtros confirmados e todas')
ok(filtrarVinculos(linhas, 'todas', '2.03').map((l) => l.cont_codigo).join() === '5.04', 'busca pelo código gerencial')
const c = contarVinculos(linhas)
ok(c.sem_vinculo === 1 && c.proposto === 2 && c.confirmado === 1 && c.pendencias === 3, 'contagens')

// 3) ações em massa só no permitido
const a = alvosDaSelecao(linhas, new Set(linhas.map((l) => l.conta_contabil_id)))
ok(a.confirmarVinculoIds.join() === 'v-5.02,v-5.04', 'confirmar em massa: só propostos')
ok(a.proporContabilIds.join() === 'c-5.01,c-5.02,c-5.04', 'propor em massa: nunca um confirmado')
ok(a.descartarVinculoIds.join() === 'v-5.02,v-5.04', 'descartar: só propostos')

// 4) banco: unicidade pela contábil, trava do confirmado, nada se apaga, relatório com status
const mig = readFileSync('supabase/migrations/20260929060000_contabil_vinculo_proposto.sql', 'utf8')
ok(/DROP INDEX IF EXISTS public\.uq_vinculo_gerencial_ativo/.test(mig) && /uq_vinculo_contabil_ativo[\s\S]*\(company_id, conta_contabil_id\) WHERE ativo/.test(mig),
  'unicidade passa para a conta contábil (várias contábeis por gerencial)')
ok(/OLD\.status = 'confirmado'[\s\S]*vinculo_imutavel/.test(mig), 'trava no banco: confirmado não muda')
ok(/TG_OP = 'DELETE'[\s\S]*vinculo_nao_se_apaga/.test(mig), 'vínculo não se apaga (RD-30), exceto limpeza na demo')
ok(/confirmado_por = auth\.uid\(\)/.test(mig) && !/confirmado_por = p_/.test(mig), 'autoria da confirmação vem do auth.uid()')
ok(/vinculo_status text/.test(mig), 'relatório devolve o status do vínculo')

// 5) tela
const pg = readFileSync('src/app/dashboard/cadastros/plano-contas/vinculos/page.tsx', 'utf8')
ok(pg.includes('useState<FiltroVinculo>(FILTRO_PADRAO)'), 'a tela abre no filtro de pendências')
ok(pg.includes('window.confirm(`Confirmar') && pg.includes('MSG_IMUTAVEL'), 'confirmar pede confirmação e explica a imutabilidade')
ok(pg.includes('PlanoContasForm') && pg.includes('vinc-nova-gerencial'), 'criar e editar conta gerencial na própria tela')
ok(!/laranjaAlerta/.test(pg), 'sem laranja')

if (falhas > 0) { console.error(`\n[check-vinculos-contabil] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-vinculos-contabil] vínculos gerencial × contábil conferidos.')
