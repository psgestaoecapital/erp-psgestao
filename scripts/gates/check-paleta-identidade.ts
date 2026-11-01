// Gate — paleta de identidade PS como tokens checáveis (Auditor de Tela, dimensão visual). #2434 + #2436.
import { PALETA_IDENTIDADE, auditarCoresFonte, classificarCor, violacoesDeCor } from '../../src/lib/auditores/paletaIdentidade'

const falhas: string[] = []
const ok = (c: boolean, m: string) => { if (!c) falhas.push(m) }

ok(PALETA_IDENTIDADE.espresso === '#3D2314' && PALETA_IDENTIDADE.offWhite === '#FAF7F2' && PALETA_IDENTIDADE.dourado === '#C8941A', 'paleta de identidade alterada')
const v = auditarCoresFonte('a{color:#3D2314;background:#faf7f2;border:#C8941A;x:#fff;y:#888}\nb{color:#16a34a}\n.semaforo{color:#16a34a}\nc{color:#7c3aed}')
ok(v.length === 2 && v[0].tipo === 'semaforo_decorativo' && v[0].linha === 2 && v[1].tipo === 'fora_da_paleta', 'auditarCoresFonte: ' + JSON.stringify(v))
ok(classificarCor('#3d2314') === 'identidade' && classificarCor('#FFF') === 'neutra' && classificarCor('#7C3AED') === 'fora' && classificarCor('#16A34A') === 'semaforo', 'classificação identidade/neutra/semáforo/fora')
ok(violacoesDeCor('background: #7C3AED').some((x) => x.tipo === 'cor_fora_da_paleta'), 'roxo fora da paleta é violação')
ok(violacoesDeCor('<div className="bg-green-500">enfeite</div>').some((x) => x.tipo === 'semaforo_decorativo'), 'verde decorativo é violação')
ok(violacoesDeCor('<span className="text-red-600">{status}</span>').length === 0, 'vermelho como status (semáforo) é permitido')
ok(violacoesDeCor('color: #C8941A; background: #FAF7F2').length === 0, 'identidade não gera violação')

if (falhas.length) { console.error('check-paleta-identidade:\n' + falhas.join('\n')); process.exit(1) }
console.log('check-paleta-identidade OK')
