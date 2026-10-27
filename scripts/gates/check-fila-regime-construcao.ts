// Gate (CEO 19/10, presente) — REGIME DE CONSTRUÇÃO na fila de merge (temporário, revisão semanal, até REGIME_FIM).
// PR ELEGÍVEL = sem migration E sem núcleo (REGIME_NUCLEO_RE, fonte única em scripts/merge/regime-nucleo.sh). Para
// elegível, com a última aceitacao-main (vaga 1) VERDE, a suíte completa é informativa: a aceitação não bloqueia e a
// fila não espera o job. Continuam obrigatórios: gates, guarda de funções, réguas, compilação, preview; spec da PRÓPRIA
// PR bloqueia; PR sensível exige MERGE AUTORIZADO. Núcleo/migration/janela vencida/main não-verde → volta a bloquear.
// Roda a fila-merge.sh DE VERDADE contra o gh simulado (scripts/merge/fila-simulada.ts).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCRIPT_FILA, comFilaSimulada, merges, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const raiz = join(SCRIPT_FILA, '..')
const modulo = readFileSync(join(raiz, 'regime-nucleo.sh'), 'utf8')
const sh = readFileSync(SCRIPT_FILA, 'utf8')

// Fonte única do núcleo: lista os padrões no começo da saída (RD-38) e confere que a fila usa o MESMO regex do módulo.
const reLinha = modulo.match(/^REGIME_NUCLEO_RE='([^']*)'/m)
console.log('Núcleo do regime de construção (REGIME_NUCLEO_RE, fonte única scripts/merge/regime-nucleo.sh):')
console.log('  ' + (reLinha?.[1] ?? '(não encontrado)'))
console.log('  padrões:', (reLinha?.[1] ?? '').split('|').join(' · '), '\n')

ok(!!reLinha, 'regime-nucleo.sh define REGIME_NUCLEO_RE (regex único do núcleo)')
ok(/^REGIME_FIM='2026-11-19T09:30:00Z'/m.test(modulo), 'regime-nucleo.sh fixa REGIME_FIM = 19/11 (revisão semanal)')
ok(/nf-\?e\|nfs-\?e\|fiscal\|tribut\|imposto\|financ\|concilia\|pagament\|recebiment\|pagar\|receber\|boleto\|pix\|cnab/.test(reLinha?.[1] ?? ''),
  'núcleo cobre TODO fiscal/financeiro (nf-e, nfs-e, fiscal, tribut, imposto, financ, concilia, pagament, recebiment, pagar, receber, boleto, pix, cnab)')
ok(/lib\/auth|lib\/supabase|rbac|permiss|supabase\/functions\/|scripts\/merge\/|scripts\/banco-testes\/|\.github\/workflows\/|e2e\/quarentena/.test(reLinha?.[1] ?? ''),
  'núcleo cobre segurança/infra da esteira (middleware, lib/auth, lib/supabase, rbac, permiss, functions, merge, banco-testes, workflows, quarentena)')
// fila e (futuramente) triagem usam a MESMA fonte: a fila FAZ source do módulo e usa o regex e a rede de segurança.
ok(/source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/regime-nucleo\.sh"/.test(sh), 'a fila faz source de regime-nucleo.sh (fonte única — a triagem usará o MESMO arquivo)')
ok(/grep -qiE "\$REGIME_NUCLEO_RE"/.test(sh) && /regime_janela/.test(sh), 'a fila decide a elegibilidade com REGIME_NUCLEO_RE + regime_janela do módulo')
ok(/regime_main_ok/.test(sh) && /aceitacao-main\.yml/.test(sh), 'rede de segurança: a fila só dispensa se a última aceitacao-main (vaga 1) estiver verde')
// REGIME_NUCLEO_RE existe em UM lugar só (fonte única): o módulo. A fila referencia a variável, nunca uma cópia do literal.
ok(!/REGIME_NUCLEO_RE=/.test(sh), 'a fila NÃO redefine o regex (usa a variável da fonte única, sem cópia que possa divergir)')

const S1 = 'e2e/jornadas/aceitacao/xml-compra-lote.spec.ts'
const S2 = 'e2e/jornadas/aceitacao/caminho-oficina-diagnostico.spec.ts'
// Nov/2026: depois de TODAS as outras janelas (aceitação-revisada 17/10, falha-comum 21/10, celular/pos/baseline) e
// ANTES de REGIME_FIM (19/11) → só o regime está ativo.
const dentro = String(Math.floor(Date.UTC(2026, 10, 1) / 1000))
const vencida = String(Math.floor(Date.UTC(2026, 10, 20) / 1000))   // > REGIME_FIM
const NUCLEO: Record<string, string> = {
  'NF-e': 'src/components/EmitirNfe.tsx',
  'NFS-e': 'src/app/dashboard/nfse/page.tsx',
  conciliação: 'src/app/dashboard/conciliacao/page.tsx',
  pagamentos: 'src/app/dashboard/contas-a-pagar/page.tsx',
  boleto: 'src/lib/boleto.ts',
  PIX: 'src/components/PixChave.tsx',
  auth: 'src/lib/auth/guarda.ts',
}

if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'regime-'))
  const vazia = join(dir, 'q.txt'); writeFileSync(vazia, '# vazia\n')
  const env = { FILA_QUARENTENA_JORNADAS: vazia, FILA_AGORA_EPOCH: dentro, FILA_REGIME_MAIN: 'sim', FILA_ACEITACAO_BLOQUEIA: '1' }
  // PR revisada + autorizada: o que separa publicar/bloquear é SÓ o regime (a autorização do revisor confere).
  const rev = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure' as const }
  comFilaSimulada((rodar) => {
    // (a) elegível (sem migration, sem núcleo) + aceitação vermelha + main verde → publica
    let x = rodar([{ ...rev, aceitacaoSpecs: [S1] }], false, 5000, env)
    ok(merges(x.escritas).join() === '1', '(a) elegível + aceitação vermelha + main verde → publica (suíte informativa)')
    ok(/REGIME DE CONSTRUÇÃO/.test(x.log) && /fila:regime-/.test(x.escritas.join('\n')), '(a) comenta as falhas como informativas do regime')

    // (b) com migration → bloqueia (regime não dispensa migration)
    x = rodar([{ ...rev, migration: true, aceitacaoSpecs: [S1] }], false, 5000, env)
    ok(merges(x.escritas).length === 0, '(b) com migration → bloqueia (fora do regime)')

    // (c) núcleo (fiscal/financeiro e auth) → bloqueia
    for (const [nome, arq] of Object.entries(NUCLEO)) {
      x = rodar([{ ...rev, arquivos: [arq], aceitacaoSpecs: [S1] }], false, 5000, env)
      ok(merges(x.escritas).length === 0, `(c) núcleo ${nome} (${arq}) → bloqueia (fora do regime)`)
    }

    // (d) main vermelha → regime desliga, bloqueia e avisa
    x = rodar([{ ...rev, aceitacaoSpecs: [S1] }], false, 5000, { ...env, FILA_REGIME_MAIN: 'nao' })
    ok(merges(x.escritas).length === 0 && /REGIME DE CONSTRUÇÃO DESLIGADO/.test(x.log), '(d) aceitacao-main não verde → regime desligado, bloqueia e avisa no log')

    // (e) janela vencida (> REGIME_FIM) → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: [S1] }], false, 5000, { ...env, FILA_AGORA_EPOCH: vencida })
    ok(merges(x.escritas).length === 0, '(e) regime vencido (depois de 19/11) → bloqueia como antes')

    // (f) spec da PRÓPRIA PR falhando → bloqueia (mesmo elegível e main verde)
    x = rodar([{ ...rev, aceitacaoSpecs: [S1], specsProprios: [S1] }], false, 5000, env)
    ok(merges(x.escritas).length === 0 && /spec da própria PR falhando/.test(x.log), '(f) spec da própria PR → bloqueia')

    // (g) sensível (revisao-eng-chefe) SEM autorização do revisor → bloqueia (independe do regime)
    x = rodar([{ n: 1, labels: ['revisao-eng-chefe'], autorizada: false, aceitacao: 'failure', aceitacaoSpecs: [S2] }], false, 5000, env)
    ok(merges(x.escritas).length === 0, '(g) sensível sem MERGE AUTORIZADO → bloqueia')
  })
}

if (falhas) { console.error(`\ncheck-fila-regime-construcao: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — regime de construção: ok')
