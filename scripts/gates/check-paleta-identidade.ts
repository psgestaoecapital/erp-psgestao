// Gate — paleta de identidade PS como tokens checáveis (Auditor de Tela, dimensão visual).
import { PALETA_IDENTIDADE, classificarCor, violacoesDeCor } from '../../src/lib/auditores/paletaIdentidade'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

ok(PALETA_IDENTIDADE.espresso === '#3D2314' && PALETA_IDENTIDADE.offwhite === '#FAF7F2' && PALETA_IDENTIDADE.dourado === '#C8941A', 'tokens da identidade = Espresso/Off-white/Dourado')
ok(classificarCor('#3d2314') === 'identidade' && classificarCor('#FFF') === 'neutra' && classificarCor('#7C3AED') === 'fora', 'classificação identidade/neutra/fora')
ok(violacoesDeCor('background: #7C3AED').some((v) => v.tipo === 'cor_fora_da_paleta'), 'roxo fora da paleta é violação')
ok(violacoesDeCor('<div className="bg-green-500">enfeite</div>').some((v) => v.tipo === 'semaforo_decorativo'), 'verde decorativo é violação')
ok(violacoesDeCor('<span className="text-red-600">{status}</span>').length === 0, 'vermelho como status (semáforo) é permitido')
ok(violacoesDeCor('color: #C8941A; background: #FAF7F2').length === 0, 'identidade não gera violação')
if (falhas) process.exit(1)
