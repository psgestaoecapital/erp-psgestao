class Component extends DCLogic {
  constructor(p) {
    super(p);
    this.B = __BASE__;
    const B = this.B;
    this.PG = B.prod.map((p) => { const l = p[1].toLowerCase(); return l.indexOf('s/osso') >= 0 ? 0 : l.indexOf('osso') >= 0 ? 1 : l.indexOf('miudo') === 0 ? 2 : 3; });
    this.MAXD = B.items.reduce((m, x) => Math.max(m, x[0]), 0);
    const excl = {}; B.prod.forEach((p, i) => { if (!p[2]) excl[i] = true; });
    this.state = { tab: 'geral', med: 'val', de: 0, ate: this.MAXD, per: 'desde', ven: 'todos', lin: 'todas', cod: true, det: null, busca: '', ord: 3, dir: -1, sorts: {}, excl: excl, escopo: 'preco', cfg: false, cfgBusca: '', tip: null, gran: 'sem' };
    this._k = null; this._m = null;
  }

  model() {
    const st = this.state, B = this.B, PG = this.PG;
    const key = [st.de, st.ate, st.ven, st.lin, st.escopo, Object.keys(st.excl).sort().join(',')].join('|');
    if (this._k === key) return this._m;
    const inc = (pi) => !st.excl[pi];
    const its = B.items.filter((x) => x[0] >= st.de && x[0] <= st.ate && (st.ven === 'todos' || x[2] === +st.ven) && (st.lin === 'todas' || PG[x[4]] === +st.lin) && (st.escopo !== 'tudo' || inc(x[4])));
    const devs = B.dev.filter((x) => x[0] >= st.de && x[0] <= st.ate && (st.ven === 'todos' || x[1] === +st.ven) && (st.lin === 'todas' || (x[3] >= 0 && PG[x[3]] === +st.lin)) && (st.escopo !== 'tudo' || x[3] < 0 || inc(x[3])));
    const mid = st.de + Math.floor((st.ate - st.de + 1) / 2);
    const novo = () => ({ val: 0, kg: 0, valP: 0, kgP: 0, tab: 0, desc: 0, acima: 0, n: 0, ab: 0, notas: new Set(), clis: new Set(), dias: new Set(), v1: 0, v2: 0, vP1: 0, kP1: 0, vP2: 0, kP2: 0, exp: 0 });
    const add = (a, x) => {
      a.val += x[6]; a.kg += x[5]; a.tab += x[7]; a.n++; a.notas.add(x[1]); a.clis.add(x[3]); a.dias.add(x[0]);
      if (x[7] > x[6] + 0.005) { a.desc += x[7] - x[6]; a.ab++; } else if (x[6] > x[7] + 0.005) a.acima += x[6] - x[7];
      const h2 = x[0] >= mid; if (h2) a.v2 += x[6]; else a.v1 += x[6];
      if (inc(x[4]) && x[5] > 0) { a.valP += x[6]; a.kgP += x[5]; if (h2) { a.vP2 += x[6]; a.kP2 += x[5]; } else { a.vP1 += x[6]; a.kP1 += x[5]; } }
    };
    const by = (f) => { const m = new Map(); its.forEach((x) => { const k = f(x); if (k === null || k === undefined) return; let a = m.get(k); if (!a) { a = novo(); m.set(k, a); } add(a, x); }); return m; };
    const tot = novo(); its.forEach((x) => add(tot, x));
    const prodM = by((x) => x[4]);
    const pPrice = new Map(); prodM.forEach((a, k) => { if (a.kgP > 0) pPrice.set(k, a.valP / a.kgP); });
    const venM = by((x) => x[2]);
    its.forEach((x) => { if (inc(x[4]) && x[5] > 0 && pPrice.has(x[4])) venM.get(x[2]).exp += x[5] * pPrice.get(x[4]); });
    const cliM = by((x) => x[3]), cidM = by((x) => B.cli[x[3]][1]), grpM = by((x) => PG[x[4]]), linM = by((x) => B.prod[x[4]][1]);
    const gEcoM = by((x) => B.cli[x[3]][2] >= 0 ? B.cli[x[3]][2] : null), diaM = by((x) => x[0]);
    const cargaM = by((x) => x[8] >= 0 ? x[8] : null), trM = by((x) => x[8] >= 0 ? x[9] : null);
    const cliVen = new Map(); its.forEach((x) => { let m = cliVen.get(x[3]); if (!m) { m = new Map(); cliVen.set(x[3], m); } m.set(x[2], (m.get(x[2]) || 0) + x[6]); });
    const cliPG = new Map(); its.forEach((x) => { if (PG[x[4]] < 3) { let s = cliPG.get(x[3]); if (!s) { s = new Set(); cliPG.set(x[3], s); } s.add(PG[x[4]]); } });
    const cidVen = new Map(); its.forEach((x) => { const c = B.cli[x[3]][1]; let s = cidVen.get(c); if (!s) { s = new Set(); cidVen.set(c, s); } s.add(x[2]); });
    const prodItens = new Map(); its.forEach((x) => { if (x[5] > 0) { let a = prodItens.get(x[4]); if (!a) { a = []; prodItens.set(x[4], a); } a.push(x[6] / x[5]); } });
    const devVen = new Map(), devCli = new Map(), devProd = new Map(); let devTot = 0;
    devs.forEach((x) => { devTot += x[4]; devVen.set(x[1], (devVen.get(x[1]) || 0) + x[4]); devCli.set(x[2], (devCli.get(x[2]) || 0) + x[4]); devProd.set(x[7], (devProd.get(x[7]) || 0) + x[4]); });
    const notaVal = new Map(); its.forEach((x) => notaVal.set(x[1], (notaVal.get(x[1]) || 0) + x[6]));
    let pzNum = 0, pzDen = 0; notaVal.forEach((v, n) => { const pz = B.notas[n][0]; if (pz !== null && pz !== undefined) { pzNum += pz * v; pzDen += v; } });
    const venPz = new Map(); its.forEach((x) => { const pz = B.notas[x[1]][0]; if (pz !== null && pz !== undefined) { let a = venPz.get(x[2]); if (!a) { a = [0, 0]; venPz.set(x[2], a); } a[0] += pz * x[6]; a[1] += x[6]; } });
    const clis = [];
    cliM.forEach((a, ci) => {
      let ult = -1, pri = 1e9; a.dias.forEach((d) => { if (d > ult) ult = d; if (d < pri) pri = d; });
      let vmax = -1, vv = -1; (cliVen.get(ci) || new Map()).forEach((v, k) => { if (v > vmax) { vmax = v; vv = k; } });
      clis.push({ ci: ci, nome: B.cli[ci][0], cid: B.cid[B.cli[ci][1]], cidI: B.cli[ci][1], grp: B.cli[ci][2], ven: vv, val: a.val, kgP: a.kgP, valP: a.valP, tab: a.tab, desc: a.desc, notas: a.notas.size, f: a.dias.size, r: st.ate - ult, pri: pri, nl: (cliPG.get(ci) || new Set()).size, dev: devCli.get(ci) || 0 });
    });
    clis.sort((a, b) => b.val - a.val);
    let acc = 0; clis.forEach((c) => { const antes = acc; acc += c.val; c.cur = antes < 0.8 * tot.val ? 0 : antes < 0.95 * tot.val ? 1 : 2; c.acum = acc / (tot.val || 1); });
    const novoLim = st.ate - 17, temNovo = st.de < novoLim;
    clis.forEach((c) => { c.seg = c.r <= 7 && c.f >= 8 ? 0 : c.r <= 14 && c.f >= 4 ? 1 : temNovo && c.pri >= novoLim ? 2 : c.r <= 14 ? 3 : c.r <= 30 && c.f >= 3 ? 4 : 5; });
    this._m = { its: its, devs: devs, mid: mid, tot: tot, prodM: prodM, pPrice: pPrice, venM: venM, cliM: cliM, cidM: cidM, grpM: grpM, linM: linM, gEcoM: gEcoM, diaM: diaM, cargaM: cargaM, trM: trM, cidVen: cidVen, prodItens: prodItens, devVen: devVen, devProd: devProd, devTot: devTot, pz: pzDen ? pzNum / pzDen : 0, venPz: venPz, clis: clis, inc: inc };
    this._k = key;
    return this._m;
  }

  renderVals() {
    const st = this.state, B = this.B, PG = this.PG, M = this.model();
    const set = (o) => this.setState(o);
    const brl = (v) => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e6 ? s + 'R$ ' + (a / 1e6).toFixed(2).replace('.', ',') + ' mi' : a >= 1e3 ? s + 'R$ ' + (a / 1e3).toFixed(1).replace('.', ',') + ' mil' : s + 'R$ ' + Math.round(a); };
    const pct = (v, d) => (isFinite(v) ? v : 0).toFixed(d === undefined ? 1 : d).replace('.', ',') + '%';
    const num = (v) => Math.round(v).toLocaleString('pt-BR');
    const rk = (v) => isFinite(v) && v > 0 ? 'R$ ' + v.toFixed(2).replace('.', ',') : '—';
    const sinal = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d === undefined ? 1 : d).replace('.', ',');
    const VERDE = ['#E3F1E6', '#1F6B34'], LARANJA = ['#FBEBD3', '#8A4B06'], VERM = ['#F8DDD6', '#A33A1F'], NEUTRO = ['#F1E9DC', '#5E5247'];
    const DS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], DSF = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const dt = (d) => new Date(Date.UTC(2026, 9, 1 + d));
    const ddmm = (d) => { const x = dt(d); return String(x.getUTCDate()).padStart(2, '0') + '/' + String(x.getUTCMonth() + 1).padStart(2, '0'); };
    const ddmmaa = (d) => ddmm(d) + '/' + dt(d).getUTCFullYear();
    const iso = (d) => dt(d).toISOString().slice(0, 10);
    const dow = (d) => dt(d).getUTCDay();
    const FER = { 11: 1, 32: 1, 45: 1, 50: 1 };
    const util = (d) => { const w = dow(d); return w >= 1 && w <= 5 && !FER[d]; };
    const vNome = (vi) => vi >= 0 && B.ven[vi] ? B.ven[vi][1] + (st.cod && B.ven[vi][0] !== 's/v' ? ' · ' + B.ven[vi][0] : '') : 'Sem vendedor';
    const vCurto = (vi) => vi >= 0 && B.ven[vi] ? B.ven[vi][1] : 'Sem vendedor';
    const GNOME = ['Desossados', 'Com osso', 'Miúdos', 'Subprodutos e outros'], GCOR = ['#3D2314', '#C8941A', '#2F6B73', '#E3C98F'];
    const tot = M.tot, TOT = tot.val || 1;
    const precoTot = tot.kgP ? tot.valP / tot.kgP : 0;
    const descPct = tot.tab ? (1 - tot.val / tot.tab) * 100 : 0;
    const sair = () => { if (st.tip) set({ tip: null }); };
    const tipFn = (id, l, t, linhas) => () => set({ tip: { id: id, l: l, t: t, linhas: linhas.filter((x) => x) } });
    const T = {}; ['grp', 'mes', 'linha', 'dia', 'sem', 'vend', 'quad', 'mix', 'pareto', 'cid', 'hist', 'idx', 'ckg', 'cdia'].forEach((id) => { const on = !!(st.tip && st.tip.id === id); T[id] = { on: on, l: on ? st.tip.l : '0', t: on ? st.tip.t : '0', linhas: on ? st.tip.linhas : [] }; });
    const abrir = (tipo, v) => set({ det: { tipo: tipo, v: v }, busca: '', ord: 3, dir: -1, tip: null });
    const fx3 = (v, a, b) => v <= a ? VERDE : v <= b ? LARANJA : VERM;

    const arc = (cx, cy, R, r, a0, a1) => { const big = a1 - a0 > Math.PI ? 1 : 0; const p = (rad, a) => (cx + rad * Math.sin(a)).toFixed(2) + ' ' + (cy - rad * Math.cos(a)).toFixed(2); return 'M ' + p(R, a0) + ' A ' + R + ' ' + R + ' 0 ' + big + ' 1 ' + p(R, a1) + ' L ' + p(r, a1) + ' A ' + r + ' ' + r + ' 0 ' + big + ' 0 ' + p(r, a0) + ' Z'; };
    const donut = (id, itens) => { const t = itens.reduce((s, i) => s + Math.max(i.v, 0), 0) || 1; let a = 0; return itens.filter((i) => i.v > 0).map((i) => { const sh = i.v / t; const a1 = a + sh * Math.PI * 2; const am = (a + a1) / 2; const d = arc(120, 120, 112, 70, a, Math.min(a1, a + Math.PI * 2 - 0.0001)); a = a1; const l = ((120 + 91 * Math.sin(am)) / 240 * 100).toFixed(1) + '%', tp = ((120 - 91 * Math.cos(am)) / 240 * 100).toFixed(1) + '%'; return Object.assign({}, i, { d: d, share: sh * 100, pct: pct(sh * 100), hover: tipFn(id, l, tp, [i.nome, pct(sh * 100) + ' · ' + i.tip1, i.tip2]) }); }); };

    const tabela = (id, rows, cols, defK, alt) => {
      const s = st.sorts[id] || { k: defK, dir: -1 };
      const col = cols.find((c) => c.k === s.k) || cols[0];
      const sorted = rows.slice().sort((a, b) => { const x = col.sv(a), y = col.sv(b); const r = (typeof x === 'string' ? String(x).localeCompare(String(y), 'pt-BR') : (x || 0) - (y || 0)); return r * s.dir; });
      const setS = (k, dir) => { const o = Object.assign({}, st.sorts); o[id] = { k: k, dir: dir }; set({ sorts: o }); };
      const maxBar = {}; cols.forEach((c) => { if (c.bar) maxBar[c.k] = rows.reduce((m, r) => Math.max(m, Math.abs(c.sv(r) || 0)), 0) || 1; });
      return {
        k: s.k, alt: alt || '560px',
        info: num(rows.length) + (rows.length === 1 ? ' linha' : ' linhas') + ' · ordenado por ' + col.rot.toLowerCase() + (s.dir < 0 ? ', do maior para o menor' : ', do menor para o maior'),
        dirRot: s.dir < 0 ? 'Maior → menor' : 'Menor → maior',
        inverter: () => setS(s.k, -s.dir),
        onOrd: (e) => { const k = e.target.value; const c = cols.find((x) => x.k === k); setS(k, c && c.txt ? 1 : -1); },
        opts: cols.map((c) => ({ v: c.k, rot: c.rot })),
        cols: cols.map((c) => ({ rot: c.rot, cor: c.k === s.k ? '#2B2118' : '#6B5E52', seta: c.k === s.k ? (s.dir < 0 ? '↓' : '↑') : '', pick: () => setS(c.k, c.k === s.k ? -s.dir : (c.txt ? 1 : -1)) })),
        rows: sorted.map((r) => ({ cells: cols.map((c) => {
          const t = c.fmt ? c.fmt(r) : String(c.sv(r));
          const link = c.link ? c.link(r) : null, pill = c.pill ? c.pill(r) : null, fx = c.faixa ? c.faixa(r) : null;
          return { t: t, isLink: !!link, abrir: link || null, isBar: !!c.bar, w: c.bar ? (Math.abs(c.sv(r) || 0) / maxBar[c.k] * 100).toFixed(1) + '%' : '0', bc: c.bar ? (c.barCor ? c.barCor(r) : '#C8941A') : '', isPill: !!pill, pf: pill ? pill[0] : '', pc: pill ? pill[1] : '', isFaixa: !!fx, fl: fx ? fx.l : '0', fw: fx ? fx.w : '0', fm: fx ? fx.m : '0', isTxt: !link && !c.bar && !pill && !fx };
        }) }))
      };
    };

    const perDef = [['hoje', 'Hoje', this.MAXD, this.MAXD], ['semana', 'Semana', this.MAXD - 6, this.MAXD], ['30', '30 dias', this.MAXD - 29, this.MAXD], ['mes', 'Este mês', 31, this.MAXD], ['ano', 'Ano', 0, this.MAXD], ['desde', 'Tudo (desde 01/10)', 0, this.MAXD]];
    const periodos = perDef.map((p) => { const on = st.per === p[0]; return { rot: p[1], pick: () => set({ per: p[0], de: Math.max(0, p[2]), ate: p[3], det: null, tip: null }), borda: on ? '#3D2314' : '#D8CBB6', fundo: on ? '#3D2314' : '#FFFFFF', txt: on ? '#FFFFFF' : '#2B2118' }; });
    const toD = (s) => { const x = Date.parse(s + 'T00:00:00Z'); if (isNaN(x)) return null; return Math.round((x - Date.UTC(2026, 9, 1)) / 86400000); };
    const nInc = B.prod.filter((p, i) => !st.excl[i]).length;
    const F = {
      deIso: iso(st.de), ateIso: iso(st.ate), ven: String(st.ven), lin: String(st.lin), cod: st.cod, nProd: nInc + ' de ' + B.prod.length,
      mudaDe: (e) => { const d = toD(e.target.value); if (d !== null) set({ de: Math.max(0, Math.min(d, st.ate)), per: 'custom' }); },
      mudaAte: (e) => { const d = toD(e.target.value); if (d !== null) set({ ate: Math.min(this.MAXD, Math.max(d, st.de)), per: 'custom' }); },
      mudaVen: (e) => set({ ven: e.target.value === 'todos' ? 'todos' : +e.target.value, tip: null }),
      mudaLin: (e) => set({ lin: e.target.value, tip: null }),
      mudaCod: () => set({ cod: !st.cod }),
      vens: [{ v: 'todos', rot: 'Toda a empresa' }].concat(B.ven.map((v, i) => ({ v: String(i), rot: v[1] + (v[0] !== 's/v' ? ' · ' + v[0] : '') })).sort((a, b) => a.rot.localeCompare(b.rot, 'pt-BR'))),
      escopoTxt: st.escopo === 'tudo' ? 'Os ' + (B.prod.length - nInc) + ' produtos fora da análise saem de todo o painel. Toque na engrenagem para mudar.' : 'O preço médio e o R$/kg usam ' + nInc + ' produtos; os ' + (B.prod.length - nInc) + ' de fora (despojo e subprodutos, pelo padrão) continuam no faturamento. Toque na engrenagem para mudar.'
    };
    const H = { de: ddmmaa(st.de), ate: ddmmaa(st.ate), quem: st.ven === 'todos' ? '' : ' · ' + vNome(st.ven), val: 'R$ ' + num(tot.val), kg: (tot.kg / 1000).toFixed(1).replace('.', ',') + ' t', ab: pct(tot.n ? tot.ab / tot.n * 100 : 0), desc: brl(tot.desc) };

    const diasCom = tot.dias.size || 1;
    const d1 = Math.max(1, M.mid - st.de), d2 = Math.max(1, st.ate - M.mid + 1);
    const crescDia = ((tot.v2 / d2) / ((tot.v1 / d1) || 1) - 1) * 100;
    const p1 = tot.kP1 ? tot.vP1 / tot.kP1 : 0, p2 = tot.kP2 ? tot.vP2 / tot.kP2 : 0, cp = p1 && p2 ? (p2 / p1 - 1) * 100 : 0;
    const sem = { delta: '', dF: 'transparent', dC: 'transparent' };
    const dl = (v, bom) => { if (!isFinite(v) || !tot.n || st.ate - st.de < 1) return sem; const f = Math.abs(v) < 0.05 ? NEUTRO : (v > 0) === bom ? VERDE : VERM; return { delta: sinal(v) + '% na 2ª metade', dF: f[0], dC: f[1] }; };
    const notasDev = new Set(M.devs.map((x) => x[6])).size;
    const kpis = [
      Object.assign({ rot: 'Faturamento', val: brl(tot.val), sub: diasCom + ' dias com venda · ' + brl(tot.val / diasCom) + '/dia', cor: '#2B2118' }, dl(crescDia, true)),
      Object.assign({ rot: 'Volume na análise', val: num(tot.kgP / 1000) + ' t', sub: 'mais ' + num((tot.kg - tot.kgP) / 1000) + ' t fora da análise', cor: '#2B2118' }, sem),
      Object.assign({ rot: 'Preço médio', val: rk(precoTot) + '/kg', sub: nInc + ' produtos na análise', cor: '#2B2118' }, dl(cp, true)),
      Object.assign({ rot: 'Ticket médio', val: 'R$ ' + num(tot.notas.size ? tot.val / tot.notas.size : 0), sub: num(tot.notas.size) + ' notas', cor: '#2B2118' }, sem),
      Object.assign({ rot: 'Desconto na tabela', val: pct(descPct, 2), sub: brl(tot.desc) + ' cedidos · ' + brl(tot.acima) + ' acima', cor: '#8A4B06' }, sem),
      Object.assign({ rot: 'Devoluções', val: pct(M.devTot / TOT * 100), sub: brl(M.devTot) + ' em ' + notasDev + ' notas', cor: '#A33A1F' }, sem),
      Object.assign({ rot: 'Clientes que compraram', val: num(tot.clis.size), sub: M.clis.filter((c) => c.r <= 6).length + ' nos últimos 7 dias', cor: '#2B2118' }, sem),
      Object.assign({ rot: 'Prazo médio', val: M.pz.toFixed(1).replace('.', ',') + ' dias', sub: 'ponderado pelo faturamento', cor: '#2B2118' }, sem)
    ];

    // vendedores
    const vens = []; M.venM.forEach((a, vi) => { const pz = M.venPz.get(vi); vens.push({ vi: vi, nome: vNome(vi), curto: vCurto(vi), val: a.val, v1: a.v1, v2: a.v2, kgP: a.kgP, preco: a.kgP ? a.valP / a.kgP : 0, idx: a.exp ? a.valP / a.exp * 100 : 0, cli: a.clis.size, notas: a.notas.size, tk: a.notas.size ? a.val / a.notas.size : 0, desc: a.tab ? (1 - a.val / a.tab) * 100 : 0, dev: (M.devVen.get(vi) || 0), devP: a.val ? (M.devVen.get(vi) || 0) / a.val * 100 : 0, pz: pz ? pz[0] / pz[1] : 0 }); });
    vens.sort((a, b) => b.val - a.val);
    const crV = (r) => r.v1 > 0 ? (r.v2 / d2) / (r.v1 / d1) - 1 : null;
    const vcores = ['#3D2314', '#6B3E22', '#9A6A2E', '#C8941A', '#E3C98F', '#2F6B73', '#5E9AA1', '#A9CDD0', '#8C7B6B', '#CFC4B6'];
    const vendFatias = donut('vend', vens.map((v, i) => ({ nome: v.curto, v: v.val, cor: vcores[i % 10], tip1: brl(v.val), tip2: v.cli + ' clientes · ' + rk(v.preco) + '/kg' })));
    const vendTop3 = pct(vens.slice(0, 3).reduce((s, v) => s + v.val, 0) / TOT * 100);
    const tbVend = tabela('vend', vens, [
      { k: 'nome', rot: 'Vendedor', txt: true, sv: (r) => r.nome, link: (r) => () => abrir('vend', r.vi) },
      { k: 'val', rot: 'Faturamento', sv: (r) => r.val, fmt: (r) => brl(r.val), bar: true },
      { k: 'part', rot: 'Participação', sv: (r) => r.val / TOT, fmt: (r) => pct(r.val / TOT * 100) },
      { k: 'cli', rot: 'Clientes', sv: (r) => r.cli, fmt: (r) => num(r.cli) },
      { k: 'tk', rot: 'Ticket', sv: (r) => r.tk, fmt: (r) => brl(r.tk) },
      { k: 'preco', rot: 'R$/kg', sv: (r) => r.preco, fmt: (r) => rk(r.preco) },
      { k: 'idx', rot: 'Índice de preço', sv: (r) => r.idx, fmt: (r) => r.idx ? r.idx.toFixed(1).replace('.', ',') : '—', pill: (r) => !r.idx ? NEUTRO : r.idx >= 100 ? VERDE : r.idx >= 95 ? LARANJA : VERM },
      { k: 'desc', rot: 'Desconto', sv: (r) => r.desc, fmt: (r) => r.desc <= 0 ? 'acima da tabela' : pct(r.desc, 2), pill: (r) => fx3(r.desc, 1.5, 2.5) },
      { k: 'dev', rot: 'Devolução', sv: (r) => r.devP, fmt: (r) => r.dev ? pct(r.devP) : 'nenhuma', pill: (r) => fx3(r.devP, 2.5, 4.5) },
      { k: 'pz', rot: 'Prazo', sv: (r) => r.pz, fmt: (r) => r.pz.toFixed(1).replace('.', ',') + ' dias' },
      { k: 'cr', rot: '2ª metade (por dia)', sv: (r) => crV(r) === null ? -9 : crV(r), fmt: (r) => crV(r) === null ? 'novo' : sinal(crV(r) * 100, 0) + '%', pill: (r) => { const c = crV(r); return c === null ? NEUTRO : c >= 0 ? VERDE : c >= -0.15 ? LARANJA : VERM; } }
    ], 'val');
    const vq = vens.filter((v) => v.kgP > 0 && v.val > TOT * 0.005 && B.ven[v.vi][0] !== 's/v');
    const mxD = Math.max(5, Math.ceil(Math.max.apply(null, vq.map((v) => v.desc).concat([0])))), mxV = Math.max(5, Math.ceil(Math.max.apply(null, vq.map((v) => v.devP).concat([0])) / 2.5) * 2.5);
    const QX = (d) => 60 + (Math.max(0, d) / mxD) * 540, QY = (p) => 260 - (Math.min(p, mxV) / mxV) * 240;
    const mDev = M.devTot / TOT * 100;
    const Q = { zx: QX(descPct).toFixed(1), zw: Math.max(0, 600 - QX(descPct)).toFixed(1), zh: Math.max(0, QY(mDev) - 20).toFixed(1),
      ex: [0, 1, 2, 3, 4, 5].map((i) => ({ x: QX(mxD * i / 5).toFixed(1), rot: (mxD * i / 5).toFixed(0) + '%' })), ey: [0, 1, 2, 3, 4].map((i) => ({ y: (QY(mxV * i / 4) + 4).toFixed(1), rot: (mxV * i / 4).toFixed(1).replace('.', ',') + '%' })),
      pts: vq.map((v) => { const r = 6 + Math.sqrt(v.val / (vens[0].val || 1)) * 20, x = QX(v.desc), y = QY(v.devP); return { nome: v.curto, x: x.toFixed(1), y: y.toFixed(1), r: r.toFixed(1), tx: (x + r + 4).toFixed(1), ty: (y + 4).toFixed(1), cor: v.desc > descPct && v.devP > mDev ? '#A33A1F' : '#C8941A', hover: tipFn('quad', (x / 620 * 100).toFixed(1) + '%', ((y - r) / 310 * 100).toFixed(1) + '%', [v.nome, 'Desconto ' + pct(v.desc, 2) + ' · devolução ' + pct(v.devP), brl(v.val) + ' faturados · ' + v.cli + ' clientes']) }; }) };
    const mixVend = vens.map((v) => { const g = [0, 0, 0, 0]; M.its.forEach((x) => { if (x[2] === v.vi) g[PG[x[4]]] += x[6]; }); const t = g.reduce((s, x) => s + x, 0) || 1; return { nome: v.curto, val: brl(v.val), seg: g.map((x, i) => ({ w: (x / t * 100).toFixed(1) + '%', cor: GCOR[i], hover: tipFn('mix', '55%', '0%', [v.curto + ' · ' + GNOME[i], brl(x) + ' · ' + pct(x / t * 100) + ' do que ele vende']) })) }; });

    // grupos de produto e linhas
    const grupoFatias = donut('grp', [0, 1, 2, 3].map((g) => { const a = M.grpM.get(g); const v = a ? (st.med === 'val' ? a.val : a.kg) : 0; return { nome: GNOME[g], cor: GCOR[g], v: v, val: a ? a.val : 0, kg: a ? a.kg : 0, tip1: a ? brl(a.val) + ' · ' + num(a.kg / 1000) + ' t' : '', tip2: a && a.kg ? 'R$ ' + (a.val / a.kg).toFixed(2).replace('.', ',') + '/kg' : '' }; })).map((f) => Object.assign(f, { detalhe: (st.med === 'val' ? brl(f.val) : num(f.kg / 1000) + ' t') + (f.kg ? ' · R$ ' + (f.val / f.kg).toFixed(2).replace('.', ',') + '/kg' : '') }));
    const on = { b: '#3D2314', f: '#3D2314', t: '#FFFFFF' }, off = { b: '#D8CBB6', f: '#FFFFFF', t: '#2B2118' };
    const linProds = new Map(); M.its.forEach((x) => { const l = B.prod[x[4]][1]; let s = linProds.get(l); if (!s) { s = new Set(); linProds.set(l, s); } s.add(x[4]); });
    const lins = []; M.linM.forEach((a, nome) => lins.push({ nome: nome, val: a.val, kg: a.kg, preco: a.kgP ? a.valP / a.kgP : 0, cli: a.clis.size, desc: a.tab ? (1 - a.val / a.tab) * 100 : 0, prods: (linProds.get(nome) || new Set()).size }));
    const tbLin = tabela('lin', lins, [
      { k: 'nome', rot: 'Linha', txt: true, sv: (r) => r.nome },
      { k: 'val', rot: 'Faturamento', sv: (r) => r.val, fmt: (r) => brl(r.val), bar: true },
      { k: 'part', rot: 'Participação', sv: (r) => r.val / TOT, fmt: (r) => pct(r.val / TOT * 100) },
      { k: 'kg', rot: 'Volume', sv: (r) => r.kg, fmt: (r) => num(r.kg) + ' kg' },
      { k: 'preco', rot: 'R$/kg na análise', sv: (r) => r.preco, fmt: (r) => rk(r.preco) },
      { k: 'prods', rot: 'Produtos', sv: (r) => r.prods },
      { k: 'cli', rot: 'Clientes', sv: (r) => r.cli, fmt: (r) => num(r.cli) },
      { k: 'desc', rot: 'Desconto', sv: (r) => r.desc, fmt: (r) => r.desc <= 0 ? 'na tabela' : pct(r.desc, 2), pill: (r) => fx3(r.desc, 1.5, 2.5) }
    ], 'val', '420px');

    // preço no tempo
    const ser = [{ nome: 'Toda a análise', cor: '#C8941A', esp: 4, f: () => true }, { nome: 'Desossados', cor: '#3D2314', esp: 3, f: (x) => PG[x[4]] === 0 }, { nome: 'Com osso', cor: '#2F6B73', esp: 3, f: (x) => PG[x[4]] === 1 }];
    const bucket = st.gran === 'dia' ? (d) => d : (d) => Math.floor((d + 3) / 7);
    const bRot = st.gran === 'dia' ? (b) => ddmm(b) : (b) => 'sem. ' + ddmm(Math.max(b * 7 - 3, 0));
    const bs = Array.from(new Set(M.its.map((x) => bucket(x[0])))).sort((a, b) => a - b);
    const serV = ser.map((s) => { const m = new Map(); M.its.forEach((x) => { if (M.inc(x[4]) && x[5] > 0 && s.f(x)) { const b = bucket(x[0]); const a = m.get(b) || [0, 0]; a[0] += x[6]; a[1] += x[5]; m.set(b, a); } }); return bs.map((b) => { const a = m.get(b); return a && a[1] > 50 ? { v: a[0] / a[1], kg: a[1], val: a[0] } : null; }); });
    const allV = [].concat.apply([], serV).filter((x) => x).map((x) => x.v);
    let ymin = allV.length ? Math.floor(Math.min.apply(null, allV) / 2) * 2 : 0, ymax = allV.length ? Math.ceil(Math.max.apply(null, allV) / 2) * 2 : 1; if (ymax - ymin < 4) { ymax += 2; ymin -= 2; }
    const LX = (i) => 80 + (bs.length > 1 ? i * (820 / (bs.length - 1)) : 410), LY = (v) => 20 + (ymax - v) / (ymax - ymin) * 240;
    const L = {
      sub: (st.gran === 'dia' ? 'Dia a dia' : 'Semana a semana') + ' · R$/kg dos ' + nInc + ' produtos na análise' + (cp ? ' · da 1ª para a 2ª metade: ' + sinal(cp) + '%' : ''),
      porDia: () => set({ gran: 'dia', tip: null }), porSem: () => set({ gran: 'sem', tip: null }), bDia: st.gran === 'dia' ? on : off, bSem: st.gran === 'sem' ? on : off,
      grade: [0, 1, 2, 3, 4].map((i) => { const v = ymin + (ymax - ymin) * i / 4; return { y: LY(v).toFixed(1), ty: (LY(v) + 4).toFixed(1), rot: 'R$ ' + v.toFixed(0) }; }),
      eixo: bs.map((b, i) => ({ x: LX(i).toFixed(1), rot: (bs.length > 16 && i % 2) ? '' : bRot(b) })),
      series: ser.map((s, si) => { const pts = []; serV[si].forEach((p, i) => { if (p) pts.push({ x: LX(i).toFixed(1), y: LY(p.v).toFixed(1), hover: tipFn('linha', (LX(i) / 1000 * 100).toFixed(1) + '%', (LY(p.v) / 300 * 100).toFixed(1) + '%', [s.nome + ' · ' + bRot(bs[i]), 'R$ ' + p.v.toFixed(2).replace('.', ',') + '/kg', num(p.kg) + ' kg · ' + brl(p.val)]) }); }); const last = pts[pts.length - 1]; const lv = serV[si].filter((x) => x).slice(-1)[0]; return { nome: s.nome, cor: s.cor, esp: s.esp, pts: pts.map((p) => p.x + ',' + p.y).join(' '), pontos: pts, fim: lv ? 'R$ ' + lv.v.toFixed(2).replace('.', ',') : '', fimY: last ? (+last.y + 4).toFixed(1) : '0' }; })
    };

    // faturamento por dia e ritmo da semana
    const diasL = Array.from(M.diaM.keys()).sort((a, b) => a - b); const mxDia = Math.max.apply(null, diasL.map((d) => M.diaM.get(d).val).concat([1]));
    const passo = 940 / Math.max(diasL.length, 1), bw = Math.max(6, Math.min(40, passo - 6));
    const DI = { barras: diasL.map((d, i) => { const a = M.diaM.get(d), h = a.val / mxDia * 190, x = 30 + i * passo; return { x: x.toFixed(1), y: (220 - h).toFixed(1), w: bw.toFixed(1), h: h.toFixed(1), cx: (x + bw / 2).toFixed(1), rot: diasL.length > 20 && i % 2 ? '' : ddmm(d), cor: dow(d) === 6 ? '#E3C98F' : '#C8941A', hover: tipFn('dia', ((x + bw / 2) / 1000 * 100).toFixed(1) + '%', ((220 - h) / 260 * 100).toFixed(1) + '%', [DS[dow(d)] + ' ' + ddmmaa(d), brl(a.val) + ' · ' + num(a.kg) + ' kg', a.notas.size + ' notas · ' + a.clis.size + ' clientes']) }; }) };
    const semAgg = [1, 2, 3, 4, 5, 6].map((w) => { const ds = diasL.filter((d) => dow(d) === w); const v = ds.reduce((s, d) => s + M.diaM.get(d).val, 0); return { w: w, n: ds.length, v: v, m: ds.length ? v / ds.length : 0 }; });
    const mxSem = Math.max.apply(null, semAgg.map((s) => s.m).concat([1]));
    const semana = semAgg.map((s, i) => ({ dia: DS[s.w], val: s.m ? (s.m / 1000).toFixed(0) + ' mil' : '—', h: (s.m / mxSem * 170).toFixed(0) + 'px', cor: s.m >= mxSem * 0.9 ? '#3D2314' : '#C8941A', hover: tipFn('sem', ((i + 0.5) / 6 * 100).toFixed(1) + '%', (100 - s.m / mxSem * 75).toFixed(1) + '%', [DS[s.w] + ': média de ' + brl(s.m), s.n + ' dias com venda · total ' + brl(s.v)]) }));

    // projeção do mês (usa vendedor/linha/produtos; o mês é o do último dia com dado)
    const mAte = dt(this.MAXD), mesI = mAte.getUTCMonth(), ini = Math.round((Date.UTC(2026, mesI, 1) - Date.UTC(2026, 9, 1)) / 86400000), fim = Math.round((Date.UTC(2026, mesI + 1, 0) - Date.UTC(2026, 9, 1)) / 86400000);
    const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const baseMes = B.items.filter((x) => (st.ven === 'todos' || x[2] === +st.ven) && (st.lin === 'todas' || PG[x[4]] === +st.lin) && (st.escopo !== 'tudo' || M.inc(x[4])));
    let mtd = 0, ant = 0; baseMes.forEach((x) => { if (x[0] >= ini) mtd += x[6]; else ant += x[6]; });
    let du = 0, dut = 0; for (let d = ini; d <= fim; d++) { if (util(d)) { dut++; if (d <= this.MAXD) du++; } }
    const proj = du ? mtd / du * dut : 0, mxP = Math.max(ant, proj, 1);
    const mA = MESES[(mesI + 11) % 12], mN = MESES[mesI];
    const Mo = { mesNome: mN, mesTitulo: cap(mN),
      sub: cap(mA) + ' fechado × ' + mN + ' projetado no ritmo dos ' + du + ' primeiros dias úteis (' + dut + ' no mês)' + (st.ven === 'todos' ? '' : ' · ' + vNome(st.ven)),
      barras: [{ rot: cap(mA), val: brl(ant), h: (ant / mxP * 170).toFixed(0) + 'px', hIn: '0px', fundo: '#C8941A', borda: '0', hover: tipFn('mes', '25%', '10%', [cap(mA) + ': ' + brl(ant), 'mês fechado']) },
        { rot: cap(mN) + ' (projeção)', val: brl(proj), h: (proj / mxP * 170).toFixed(0) + 'px', hIn: (proj ? mtd / mxP * 170 : 0).toFixed(0) + 'px', fundo: '#F1E3C4', borda: '2px dashed #C8941A', hover: tipFn('mes', '75%', '10%', ['Já vendido: ' + brl(mtd) + ' em ' + du + ' dias úteis', 'Ritmo: ' + brl(du ? mtd / du : 0) + ' por dia útil', 'Projeção: ' + brl(proj) + ' (' + sinal(ant ? (proj / ant - 1) * 100 : 0, 0) + '% vs ' + mA + ')']) }],
      leitura: 'No ritmo atual, ' + mN + ' fecha em ' + brl(proj) + ', ' + sinal(ant ? (proj / ant - 1) * 100 : 0, 1) + '% em relação a ' + mA + ' (' + brl(ant) + '). O ritmo é de ' + brl(du ? mtd / du : 0) + ' por dia útil. Com poucos dias úteis, a projeção ainda oscila.' };

    // clientes
    const SEG = [
      { nome: 'Campeões', regra: 'compraram nos últimos 7 dias e em 8 dias ou mais', acao: 'Proteger: visita e condição de parceiro', cor: '#1F6B34', fundo: '#EEF7F0', borda: '#CFE6D6' },
      { nome: 'Fiéis', regra: 'compram em 4 dias ou mais, ativos nas últimas 2 semanas', acao: 'Crescer: oferecer a linha que falta', cor: '#2F6B73', fundo: '#EDF5F6', borda: '#CFE3E5' },
      { nome: 'Novos no período', regra: 'primeira compra nos últimos 17 dias', acao: 'Fidelizar: segunda compra em 7 dias', cor: '#8A5A0B', fundo: '#FCF5E6', borda: '#EEDDB5' },
      { nome: 'Ocasionais', regra: 'ativos, mas compram pouco', acao: 'Frequência: pedido programado', cor: '#5E5247', fundo: '#F7F3EC', borda: '#E6DCCB' },
      { nome: 'Em risco', regra: 'compravam bem e estão há 15 a 30 dias sem comprar', acao: 'Ligar hoje', cor: '#8A4B06', fundo: '#FBEBD3', borda: '#F1D3A6' },
      { nome: 'Sumindo', regra: 'mais de 2 semanas sem comprar', acao: 'Reconquistar: oferta de retorno', cor: '#A33A1F', fundo: '#FBEDE8', borda: '#F1CFC4' }
    ];
    const C = M.clis;
    const rfm = SEG.map((s, i) => { const m = C.filter((c) => c.seg === i); const v = m.reduce((a, c) => a + c.val, 0); return Object.assign({}, s, { n: m.length, val: brl(v), tk: brl(m.length ? v / m.length : 0), abrir: () => abrir('seg', i) }); });
    const idx80 = C.findIndex((c) => c.acum >= 0.8) + 1;
    const PX = (i) => 40 + (C.length > 1 ? i / (C.length - 1) * 500 : 0), PY = (p) => 220 - p * 200;
    const pl = '40,220 ' + C.map((c, i) => PX(i).toFixed(1) + ',' + PY(c.acum).toFixed(1)).join(' ');
    const marks = Array.from(new Set([1, 5, 10, 20, 50, 100, idx80, 200, 300, C.length].filter((n) => n >= 1 && n <= C.length))).sort((a, b) => a - b);
    const P = { linha: pl, area: pl + ' ' + PX(Math.max(C.length - 1, 0)).toFixed(1) + ',220', ult: C.length + 'º', marcas: marks.map((n) => { const c = C[n - 1], x = PX(n - 1), y = PY(c.acum); return { x: x.toFixed(1), y: y.toFixed(1), hover: tipFn('pareto', (x / 560 * 100).toFixed(1) + '%', (y / 260 * 100).toFixed(1) + '%', ['Os ' + n + ' maiores clientes', 'fazem ' + pct(c.acum * 100) + ' do faturamento', n + 'º: ' + c.nome + ' · ' + brl(c.val)]) }; }) };
    const curvas = ['A', 'B', 'C'].map((l, i) => { const m = C.filter((c) => c.cur === i); const kg = m.reduce((s, c) => s + c.kgP, 0), vp = m.reduce((s, c) => s + c.valP, 0); return { l: l, n: m.length, p: pct(m.reduce((s, c) => s + c.val, 0) / TOT * 100), rkg: rk(kg ? vp / kg : 0), f: (m.length ? m.reduce((s, c) => s + c.f, 0) / m.length : 0).toFixed(1).replace('.', ',') + ' dias de compra', abrir: () => abrir('cur', i) }; });
    const crossD = [0, 1, 2, 3].map((n) => { const m = C.filter((c) => c.nl === n); const v = m.reduce((s, c) => s + c.val, 0); return { n: n, q: m.length, v: v, med: m.length ? v / m.length : 0 }; }).filter((x) => x.q > 0);
    const mxC = Math.max.apply(null, crossD.map((x) => x.med).concat([1]));
    const cross = crossD.map((x) => ({ rot: x.n === 0 ? 'Só subprodutos' : x.n + (x.n === 1 ? ' linha' : ' linhas'), n: x.q, val: brl(x.med), w: (x.med / mxC * 100).toFixed(1) + '%', cor: ['#CFC4B6', '#E3C98F', '#C8941A', '#3D2314'][x.n], abrir: () => abrir('nl', x.n) }));
    const c1 = crossD.find((x) => x.n === 1), c2 = crossD.find((x) => x.n === 2);
    const crossLeitura = c1 && c2 ? c1.q + ' clientes compram uma linha só, a ' + brl(c1.med) + ' cada. Se 1 em cada 5 passar a comprar a segunda linha (média ' + brl(c2.med) + '), são cerca de ' + brl(Math.round(c1.q / 5) * (c2.med - c1.med)) + ' a mais no período, sem cliente novo.' : 'Mude o recorte para comparar clientes de uma e de mais linhas.';
    const notaM = new Map(); M.its.forEach((x) => notaM.set(x[1], (notaM.get(x[1]) || 0) + x[6])); const notaVals = Array.from(notaM.values());
    const tkF = [['até 1 mil', 0, 1000], ['1–3 mil', 1000, 3000], ['3–7 mil', 3000, 7000], ['7–15 mil', 7000, 15000], ['15–40 mil', 15000, 40000], ['40 mil+', 40000, 1e12]].map((f) => { const m = notaVals.filter((v) => v >= f[1] && v < f[2]); return { f: f[0], n: m.length, v: m.reduce((s, v) => s + v, 0) }; });
    const mxTn = Math.max.apply(null, tkF.map((t) => t.n).concat([1])), mxTv = Math.max.apply(null, tkF.map((t) => t.v).concat([1]));
    const ticket = tkF.map((t) => ({ f: t.f, wn: (t.n / mxTn * 70).toFixed(0) + '%', pn: pct(t.n / (notaVals.length || 1) * 100, 0), wv: (t.v / mxTv * 70).toFixed(0) + '%', pv: pct(t.v / TOT * 100, 0) }));
    const gruposR = []; M.gEcoM.forEach((a, g) => { const lojas = C.filter((c) => c.grp === g); gruposR.push({ g: g, nome: B.grp[g], lojas: lojas.length, cids: new Set(lojas.map((c) => c.cidI)).size, val: a.val, desc: a.tab ? (1 - a.val / a.tab) * 100 : 0, preco: a.kgP ? a.valP / a.kgP : 0 }); });
    const pesoGrp = gruposR.reduce((s, g) => s + g.val, 0) / TOT * 100;
    const tbGrp = tabela('grp', gruposR, [
      { k: 'nome', rot: 'Grupo', txt: true, sv: (r) => r.nome, link: (r) => () => abrir('grp', r.g) },
      { k: 'lojas', rot: 'Lojas', sv: (r) => r.lojas },
      { k: 'cids', rot: 'Cidades', sv: (r) => r.cids },
      { k: 'val', rot: 'Faturamento', sv: (r) => r.val, fmt: (r) => brl(r.val), bar: true },
      { k: 'peso', rot: 'Peso', sv: (r) => r.val / TOT, fmt: (r) => pct(r.val / TOT * 100) },
      { k: 'preco', rot: 'R$/kg', sv: (r) => r.preco, fmt: (r) => rk(r.preco) },
      { k: 'desc', rot: 'Desconto', sv: (r) => r.desc, fmt: (r) => r.desc <= 0 ? 'na tabela' : pct(r.desc, 2), pill: (r) => fx3(r.desc, 1.5, 2.5) }
    ], 'val', '520px');
    tbGrp.info = gruposR.length + ' grupos com mais de uma loja · ' + pct(pesoGrp) + ' do faturamento · ' + tbGrp.info.split(' · ').slice(1).join(' · ');
    const recFaixa = (u) => u <= 6 ? 0 : u <= 14 ? 1 : u <= 29 ? 2 : 3;
    const REC = [['Até 7 dias', '#2F6B73', '#FFFFFF', 'compraram nos últimos 7 dias'], ['8 a 14 dias', '#5E9AA1', '#FFFFFF', 'última compra há 8 a 14 dias'], ['15 a 30 dias', '#E3A33C', '#2B2118', 'última compra há 15 a 30 dias'], ['Mais de 30 dias', '#A33A1F', '#FFFFFF', 'última compra há mais de 30 dias']];
    const recencia = REC.map((r, i) => { const n = C.filter((c) => recFaixa(c.r) === i).length; return { rot: r[0], n: n, cor: r[1], txt: r[2], w: (n / (C.length || 1) * 100).toFixed(1) + '%', abrir: () => abrir('rec', i) }; });

    // cidades
    const cidR = []; M.cidM.forEach((a, ci) => { const nome = B.cid[ci]; const s1 = a.v1 / (tot.v1 || 1), s2 = a.v2 / (tot.v2 || 1); cidR.push({ ci: ci, nome: nome.split('/')[0], uf: nome.split('/')[1] || '', val: a.val, kg: a.kg, preco: a.kgP ? a.valP / a.kgP : 0, cli: a.clis.size, rcli: a.clis.size ? a.val / a.clis.size : 0, vens: (M.cidVen.get(ci) || new Set()).size, desc: a.tab ? (1 - a.val / a.tab) * 100 : 0, esp: (s2 - s1) * 100 }); });
    cidR.sort((a, b) => b.val - a.val);
    const ccor = ['#2F6B73', '#3D2314', '#C8941A', '#5E9AA1', '#6B3E22', '#E3C98F', '#9A6A2E', '#A9CDD0', '#8C7B6B', '#C45A35', '#CFC4B6'];
    const restC = cidR.slice(10).reduce((s, c) => s + c.val, 0);
    const cidFatias = donut('cid', cidR.slice(0, 10).map((c, i) => ({ nome: c.nome, v: c.val, cor: ccor[i], tip1: brl(c.val), tip2: c.cli + ' clientes · ' + c.vens + (c.vens === 1 ? ' vendedor' : ' vendedores') })).concat(restC > 0 ? [{ nome: 'Outras ' + (cidR.length - 10), v: restC, cor: ccor[10], tip1: brl(restC), tip2: 'somadas' }] : []));
    const top2 = cidR.slice(0, 2).reduce((s, c) => s + c.val, 0);
    const uni = cidR.filter((c) => c.vens === 1 && c.val > TOT * 0.02);
    const foraSC = C.filter((c) => !/\/SC$/.test(c.cid)).length;
    const cidKpis = [
      { rot: 'Cidades atendidas', val: num(cidR.length), sub: 'com venda no período', cor: '#2B2118' },
      { rot: '10 maiores cidades', val: pct(cidR.slice(0, 10).reduce((s, c) => s + c.val, 0) / TOT * 100), sub: 'do faturamento · as 2 maiores: ' + pct(top2 / TOT * 100), cor: '#2B2118' },
      { rot: 'Fora de Santa Catarina', val: num(foraSC) + ' clientes', sub: pct(cidR.filter((c) => c.uf !== 'SC').reduce((s, c) => s + c.val, 0) / TOT * 100) + ' do faturamento', cor: '#2B2118' },
      { rot: 'Dependem de 1 vendedor', val: brl(uni.reduce((s, c) => s + c.val, 0)), sub: uni.length + ' cidades acima de 2% com um só vendedor', cor: '#A33A1F' }
    ];
    const tbCid = tabela('cid', cidR, [
      { k: 'nome', rot: 'Cidade', txt: true, sv: (r) => r.nome, link: (r) => () => abrir('cid', r.ci) },
      { k: 'uf', rot: 'UF', txt: true, sv: (r) => r.uf },
      { k: 'val', rot: 'Faturamento', sv: (r) => r.val, fmt: (r) => brl(r.val), bar: true, barCor: () => '#2F6B73' },
      { k: 'peso', rot: 'Peso', sv: (r) => r.val / TOT, fmt: (r) => pct(r.val / TOT * 100) },
      { k: 'cli', rot: 'Clientes', sv: (r) => r.cli },
      { k: 'rcli', rot: 'R$ por cliente', sv: (r) => r.rcli, fmt: (r) => brl(r.rcli) },
      { k: 'preco', rot: 'R$/kg', sv: (r) => r.preco, fmt: (r) => rk(r.preco) },
      { k: 'vens', rot: 'Vendedores', sv: (r) => r.vens, fmt: (r) => r.vens + (r.vens === 1 ? ' vendedor' : ' vendedores'), pill: (r) => r.vens === 1 ? VERM : r.vens === 2 ? LARANJA : VERDE },
      { k: 'esp', rot: 'Espaço', sv: (r) => r.esp, fmt: (r) => sinal(r.esp, 2) + ' p.p.', pill: (r) => r.esp >= 0.2 ? VERDE : r.esp <= -0.5 ? VERM : NEUTRO }
    ], 'val', '640px');

    // produtos
    const prodR = []; M.prodM.forEach((a, pi) => { const arr = (M.prodItens.get(pi) || []).slice().sort((x, y) => x - y); const q = (p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))] : 0; const pm = a.kg ? a.val / a.kg : 0; const pa = a.kP1 ? a.vP1 / a.kP1 : 0, pb = a.kP2 ? a.vP2 / a.kP2 : 0; prodR.push({ pi: pi, nome: B.prod[pi][0], linha: B.prod[pi][1], dentro: M.inc(pi), val: a.val, kg: a.kg, pm: pm, p10: q(0.1), p90: q(0.9), cli: a.clis.size, desc: a.tab ? (1 - a.val / a.tab) * 100 : 0, vr: pa && pb ? (pb / pa - 1) * 100 : null, dev: M.devProd.get(B.prod[pi][0]) || 0 }); });
    const fxMax = Math.max(50, Math.ceil(Math.max.apply(null, prodR.filter((p) => p.kg > 50).map((p) => p.p90).concat([0])) / 10) * 10);
    const fxP = (v) => (Math.max(0, Math.min(v, fxMax)) / fxMax * 100).toFixed(1) + '%';
    const tbProd = tabela('prod', prodR, [
      { k: 'nome', rot: 'Produto', txt: true, sv: (r) => r.nome, link: (r) => () => abrir('prod', r.pi) },
      { k: 'linha', rot: 'Linha', txt: true, sv: (r) => r.linha },
      { k: 'val', rot: 'Faturamento', sv: (r) => r.val, fmt: (r) => brl(r.val), bar: true, barCor: (r) => r.dentro ? '#C8941A' : '#CFC4B6' },
      { k: 'kg', rot: 'Volume', sv: (r) => r.kg, fmt: (r) => num(r.kg) + ' kg' },
      { k: 'pm', rot: 'R$/kg', sv: (r) => r.pm, fmt: (r) => rk(r.pm) },
      { k: 'faixa', rot: 'Faixa de preço', sv: (r) => r.p90 - r.p10, fmt: () => '', faixa: (r) => r.kg > 0 ? { l: fxP(r.p10), w: Math.max(0.5, (Math.min(r.p90, fxMax) - Math.min(r.p10, fxMax)) / fxMax * 100).toFixed(1) + '%', m: fxP(r.pm) } : null },
      { k: 'vr', rot: '2ª metade', sv: (r) => r.vr === null ? -999 : r.vr, fmt: (r) => r.vr === null ? '—' : sinal(r.vr) + '%', pill: (r) => r.vr === null ? NEUTRO : r.vr >= 1 ? VERDE : r.vr <= -1 ? VERM : NEUTRO },
      { k: 'cli', rot: 'Clientes', sv: (r) => r.cli },
      { k: 'desc', rot: 'Desconto', sv: (r) => r.desc, fmt: (r) => r.desc <= 0 ? 'na tabela' : pct(r.desc, 2), pill: (r) => fx3(r.desc, 1.5, 2.5) },
      { k: 'dentro', rot: 'Análise', sv: (r) => r.dentro ? 1 : 0, fmt: (r) => r.dentro ? 'dentro' : 'fora', pill: (r) => r.dentro ? VERDE : NEUTRO }
    ], 'val', '680px');
    const pSort = prodR.slice().sort((a, b) => b.val - a.val); let pacc = 0, p80 = 0; pSort.forEach((p) => { if (pacc < 0.8 * TOT) p80++; pacc += p.val; });
    const maisDev = prodR.slice().sort((a, b) => b.dev - a.dev)[0];
    const prodKpis = [
      { rot: 'Produtos vendidos', val: num(prodR.length), sub: prodR.filter((p) => p.dentro).length + ' dentro da análise' },
      { rot: 'Fazem 80% do faturamento', val: num(p80), sub: 'produtos (curva A)' },
      { rot: '10 maiores produtos', val: pct(pSort.slice(0, 10).reduce((s, p) => s + p.val, 0) / TOT * 100), sub: 'do faturamento' },
      { rot: 'Mais devolvido', val: maisDev && maisDev.dev ? maisDev.nome : '—', sub: maisDev && maisDev.dev ? brl(maisDev.dev) + ' devolvidos' : 'sem devolução no recorte' }
    ];

    // preço e desconto
    const HF = [['Acima da tabela', -1e9, -0.5, '#9FD3B0'], ['Na tabela', -0.5, 0.5, '#CFC4B6'], ['0,5% a 2%', 0.5, 2, '#E3C98F'], ['2% a 5%', 2, 5, '#C8941A'], ['5% a 10%', 5, 10, '#C45A35'], ['Mais de 10%', 10, 1e9, '#A33A1F']];
    const hd = HF.map((f) => ({ f: f[0], n: 0, perda: 0, cor: f[3], lo: f[1], hi: f[2] }));
    M.its.forEach((x) => { if (x[7] > 0) { const d = (1 - x[6] / x[7]) * 100; const h = hd.find((hh) => d > hh.lo && d <= hh.hi) || hd[1]; h.n++; h.perda += x[7] - x[6]; } });
    const mxH = Math.max.apply(null, hd.map((h) => h.n).concat([1]));
    const hist = hd.map((h, i) => ({ f: h.f, n: num(h.n), w: Math.max(1.5, h.n / mxH * 75).toFixed(1) + '%', cor: h.cor, perda: h.perda < -1 ? '+ ' + brl(-h.perda) : h.perda < 1000 ? '—' : '− ' + brl(h.perda), pc: h.perda < 0 ? '#1F6B34' : '#A33A1F', hover: tipFn('hist', '50%', ((i + 0.2) / 6 * 100).toFixed(1) + '%', [h.f + ': ' + num(h.n) + ' itens', h.perda < 0 ? brl(-h.perda) + ' acima da tabela' : brl(h.perda) + ' abaixo da tabela']) }));
    const h10 = hd[5], h510 = hd[4];
    const histLeitura = h10.n ? h10.n + ' itens com mais de 10% de desconto custaram ' + brl(h10.perda) + (h510.n ? ', contra ' + brl(h510.perda) + ' dos ' + h510.n + ' itens entre 5% e 10%' : '') + '. Uma regra simples fecha esse ralo: desconto acima de 5% só com aprovação da diretoria no pedido.' : 'Nenhum item com mais de 10% de desconto neste recorte.';
    const vIdx = vens.filter((v) => v.idx > 0 && B.ven[v.vi][0] !== 's/v').sort((a, b) => b.idx - a.idx);
    const iMin = Math.min(90, Math.floor(Math.min.apply(null, vIdx.map((v) => v.idx).concat([100])) / 5) * 5), iMax = Math.max(110, Math.ceil(Math.max.apply(null, vIdx.map((v) => v.idx).concat([100])) / 5) * 5);
    const IX = (v) => (v - iMin) / (iMax - iMin) * 100;
    const indice = vIdx.map((v, i) => ({ nome: v.curto, v: v.idx.toFixed(1).replace('.', ','), meio: IX(100).toFixed(1) + '%', l: Math.min(IX(v.idx), IX(100)).toFixed(1) + '%', w: Math.max(0.8, Math.abs(IX(v.idx) - IX(100))).toFixed(1) + '%', cor: v.idx >= 100 ? '#2F6B73' : '#A33A1F', hover: tipFn('idx', '55%', ((i + 0.1) / Math.max(vIdx.length, 1) * 100).toFixed(1) + '%', [v.nome + ': índice ' + v.idx.toFixed(1).replace('.', ','), rk(v.preco) + '/kg · ' + sinal(v.idx - 100) + '% em relação à média nos mesmos produtos']) }));
    const idxEsc = { a: String(iMin), b: String(iMax) };
    const descCli = C.filter((c) => c.desc > 0).map((c) => ({ ci: c.ci, nome: c.nome, cid: c.cid.split('/')[0], ven: vNome(c.ven), val: c.val, desc: c.desc, pct: c.tab ? c.desc / c.tab * 100 : 0, preco: c.kgP ? c.valP / c.kgP : 0 }));
    const tbDesc = tabela('desc', descCli, [
      { k: 'nome', rot: 'Cliente', txt: true, sv: (r) => r.nome },
      { k: 'cid', rot: 'Cidade', txt: true, sv: (r) => r.cid },
      { k: 'ven', rot: 'Vendedor', txt: true, sv: (r) => r.ven },
      { k: 'desc', rot: 'R$ abaixo da tabela', sv: (r) => r.desc, fmt: (r) => brl(r.desc), bar: true, barCor: () => '#A33A1F' },
      { k: 'pct', rot: 'Desconto', sv: (r) => r.pct, fmt: (r) => pct(r.pct, 2), pill: (r) => fx3(r.pct, 1.5, 2.5) },
      { k: 'val', rot: 'Faturamento', sv: (r) => r.val, fmt: (r) => brl(r.val) },
      { k: 'preco', rot: 'R$/kg', sv: (r) => r.preco, fmt: (r) => rk(r.preco) }
    ], 'desc', '560px');

    // logística
    const cargaCid = new Map(); M.its.forEach((x) => { if (x[8] >= 0) { let s = cargaCid.get(x[8]); if (!s) { s = new Set(); cargaCid.set(x[8], s); } s.add(B.cli[x[3]][1]); } });
    const cargaTr = new Map(); M.its.forEach((x) => { if (x[8] >= 0) cargaTr.set(x[8], x[9]); });
    const cargas = []; M.cargaM.forEach((a, k) => { let d0 = 1e9; a.dias.forEach((d) => { if (d < d0) d0 = d; }); cargas.push({ k: k, kg: a.kg, val: a.val, cli: a.clis.size, d: d0, cids: (cargaCid.get(k) || new Set()).size }); });
    const nc = cargas.length || 1;
    const trN = new Map(); cargaTr.forEach((t) => trN.set(t, (trN.get(t) || 0) + 1));
    const trR = []; M.trM.forEach((a, ti) => trR.push({ nome: B.tr[ti], n: trN.get(ti) || 0, val: a.val, kg: a.kg }));
    trR.sort((a, b) => b.n - a.n);
    const semCarga = tot.val - cargas.reduce((s, c) => s + c.val, 0);
    const logKpis = [
      { rot: 'Cargas', val: num(cargas.length), sub: brl(cargas.reduce((s, c) => s + c.val, 0) / nc) + ' por carga', cor: '#2B2118' },
      { rot: 'Peso médio', val: num(cargas.reduce((s, c) => s + c.kg, 0) / nc) + ' kg', sub: 'por carga', cor: '#2B2118' },
      { rot: 'Por viagem', val: (cargas.reduce((s, c) => s + c.cli, 0) / nc).toFixed(1).replace('.', ',') + ' clientes', sub: 'em ' + (cargas.reduce((s, c) => s + c.cids, 0) / nc).toFixed(1).replace('.', ',') + ' cidades · sem carga: ' + brl(semCarga), cor: '#2B2118' },
      { rot: 'Maior transportadora', val: trR[0] ? pct(trR[0].n / nc * 100, 0) : '—', sub: trR[0] ? trR[0].n + ' de ' + cargas.length + ' cargas' : '', cor: trR[0] && trR[0].n / nc > 0.7 ? '#A33A1F' : '#2B2118' }
    ];
    const CKF = [['até 1 t', 0, 1000], ['1 a 2 t', 1000, 2000], ['2 a 3 t', 2000, 3000], ['3 a 4 t', 3000, 4000], ['4 t ou mais', 4000, 1e12]].map((f) => { const m = cargas.filter((c) => c.kg >= f[1] && c.kg < f[2]); return { f: f[0], n: m.length, kg: m.reduce((s, c) => s + c.kg, 0) }; });
    const mxCk = Math.max.apply(null, CKF.map((c) => c.n).concat([1]));
    const cargasKg = CKF.map((c, i) => ({ f: c.f, n: c.n, h: (c.n / mxCk * 160).toFixed(0) + 'px', cor: i === 0 ? '#A33A1F' : '#2F6B73', hover: tipFn('ckg', ((i + 0.5) / 5 * 100).toFixed(1) + '%', (100 - c.n / mxCk * 75).toFixed(1) + '%', [c.f + ': ' + c.n + ' cargas (' + pct(c.n / nc * 100, 0) + ')', num(c.kg) + ' kg no total']) }));
    const CD = [1, 2, 3, 4, 5, 6].map((w) => { const ds = diasL.filter((d) => dow(d) === w); const m = cargas.filter((c) => dow(c.d) === w); return { w: w, n: ds.length ? m.length / ds.length : 0, kg: m.length ? m.reduce((s, c) => s + c.kg, 0) / m.length : 0, tot: m.length }; });
    const mxCd = Math.max.apply(null, CD.map((c) => c.n).concat([1]));
    const cargasDia = CD.map((c, i) => ({ d: DS[c.w], n: c.n.toFixed(1).replace('.', ','), h: (c.n / mxCd * 140).toFixed(0) + 'px', hover: tipFn('cdia', ((i + 0.5) / 6 * 100).toFixed(1) + '%', (100 - c.n / mxCd * 70).toFixed(1) + '%', [DS[c.w] + ': ' + c.n.toFixed(1).replace('.', ',') + ' cargas por dia', c.tot + ' cargas no período · ' + num(c.kg) + ' kg em média']) }));
    const tbTr = tabela('tr', trR, [
      { k: 'nome', rot: 'Transportadora', txt: true, sv: (r) => r.nome },
      { k: 'n', rot: 'Cargas', sv: (r) => r.n, fmt: (r) => num(r.n), bar: true, barCor: () => '#2F6B73' },
      { k: 'part', rot: 'Participação', sv: (r) => r.n / nc, fmt: (r) => pct(r.n / nc * 100) },
      { k: 'kg', rot: 'Volume', sv: (r) => r.kg, fmt: (r) => num(r.kg) + ' kg' },
      { k: 'val', rot: 'Faturamento', sv: (r) => r.val, fmt: (r) => brl(r.val) }
    ], 'n', '320px');

    // metas
    const metasR = B.ven.map((v, vi) => { let a = 0, m = 0; baseMes.forEach((x) => { if (x[2] === vi) { if (x[0] >= ini) m += x[6]; else a += x[6]; } }); const meta = a * 1.05, pj = du ? m / du * dut : 0; return { vi: vi, nome: vNome(vi), ant: a, meta: meta, mtd: m, proj: pj, r: meta ? pj / meta : 0 }; }).filter((r) => (r.ant > 0 || r.mtd > 0) && (st.ven === 'todos' || r.vi === +st.ven));
    const tbMeta = tabela('meta', metasR, [
      { k: 'nome', rot: 'Vendedor', txt: true, sv: (r) => r.nome },
      { k: 'ant', rot: cap(mA), sv: (r) => r.ant, fmt: (r) => brl(r.ant) },
      { k: 'meta', rot: 'Meta sugerida', sv: (r) => r.meta, fmt: (r) => brl(r.meta) },
      { k: 'mtd', rot: 'Já vendido', sv: (r) => r.mtd, fmt: (r) => brl(r.mtd) },
      { k: 'r', rot: 'Projeção × meta', sv: (r) => r.r, fmt: (r) => pct(r.r * 100, 0), bar: true, barCor: (r) => r.r >= 1 ? '#1F6B34' : r.r >= 0.9 ? '#C8941A' : '#A33A1F' },
      { k: 'proj', rot: 'Projeção', sv: (r) => r.proj, fmt: (r) => brl(r.proj), pill: (r) => r.r >= 1 ? VERDE : r.r >= 0.9 ? LARANJA : VERM }
    ], 'ant', '520px');

    // diagnóstico calculado
    const quedaMes = metasR.filter((r) => B.ven[r.vi][0] !== 's/v' && r.ant > 0).map((r) => ({ r: r, c: r.proj / r.ant - 1 })).sort((a, b) => a.c - b.c)[0];
    const mIdx = vIdx.slice(-1)[0];
    const grpTop = gruposR.slice().sort((a, b) => b.val - a.val)[0];
    const espTop = cidR.filter((c) => c.val > TOT * 0.01).sort((a, b) => b.esp - a.esp)[0];
    const pv = prodR.filter((p) => p.vr !== null && p.dentro && p.val > TOT * 0.01);
    const sobe = pv.slice().sort((a, b) => b.vr - a.vr)[0], cai = pv.slice().sort((a, b) => a.vr - b.vr)[0];
    const semOrd = semAgg.filter((s) => s.n > 0 && s.w <= 5).sort((a, b) => a.m - b.m);
    const risco = C.filter((c) => c.seg >= 4), riscoV = risco.reduce((s, c) => s + c.val, 0);
    const item = (t, d) => ({ t: t, d: d });
    const diag = [
      { titulo: 'Riscos', cor: '#F2A48E', itens: [
        quedaMes && quedaMes.c < -0.05 ? item(vCurto(quedaMes.r.vi) + ' ' + (quedaMes.c < -0.8 ? 'parou.' : 'desacelerou.'), 'Vendeu ' + brl(quedaMes.r.ant) + ' em ' + mA + ' e ' + brl(quedaMes.r.mtd) + ' até agora em ' + mN + ' (projeção ' + brl(quedaMes.r.proj) + ').') : item('Equipe no ritmo.', 'Nenhum vendedor com queda forte em ' + mN + '.'),
        item(gruposR.length + ' grupos econômicos pesam ' + pct(pesoGrp) + '.', grpTop ? 'O maior, ' + grpTop.nome + ' (' + grpTop.lojas + ' lojas), é ' + pct(grpTop.val / TOT * 100) + ' do faturamento.' : ''),
        trR[0] ? item('Uma transportadora leva ' + pct(trR[0].n / nc * 100, 0) + ' das cargas.', trR[0].nome + '. Se ela parar, a expedição para.') : item('Sem cargas no recorte.', ''),
        item(brl(uni.reduce((s, c) => s + c.val, 0)) + ' dependem de 1 vendedor.', uni.length ? uni.slice(0, 3).map((c) => c.nome).join(', ') + ' têm uma pessoa só atendendo.' : 'Nenhuma cidade grande com um só vendedor.')
      ] },
      { titulo: 'Oportunidades', cor: '#E3C98F', itens: [
        c1 && c2 ? item('Vender a segunda linha.', c1.q + ' clientes compram uma linha só, a ' + brl(c1.med) + '; quem compra duas gasta ' + brl(c2.med) + '.') : item('Venda cruzada.', 'Sem base para comparar neste recorte.'),
        sobe && cai && sobe.vr > 0 ? item('Repassar preço com critério.', sobe.nome + ' subiu ' + pct(sobe.vr) + (cai.vr < 0 ? '; ' + cai.nome + ' caiu ' + pct(-cai.vr) : '') + ' da 1ª para a 2ª metade.') : item('Preço estável.', 'Sem variação relevante entre as metades.'),
        espTop && espTop.esp > 0 ? item(espTop.nome + ' ganha espaço.', sinal(espTop.esp, 1) + ' ponto de participação da 1ª para a 2ª metade.') : item('Cidades estáveis.', 'Nenhuma cidade grande ganhou espaço relevante.'),
        semOrd.length > 1 ? item(cap(DSF[semOrd[0].w]) + ' é o dia fraco.', 'Vende ' + pct(semOrd[0].m / semOrd[semOrd.length - 1].m * 100, 0) + ' do que vende a ' + DSF[semOrd[semOrd.length - 1].w] + ': espaço para oferta.') : item('Ritmo.', 'Período curto para comparar os dias.')
      ] },
      { titulo: 'Ações', cor: '#9FD3B0', itens: [
        item('Ligar para ' + risco.length + ' clientes.', 'Em risco ou sumindo; compraram ' + brl(riscoV) + ' no período.'),
        mIdx && mIdx.idx < 97 ? item('Rever o preço de ' + mIdx.curto + '.', 'Índice ' + mIdx.idx.toFixed(1).replace('.', ',') + ': ' + sinal(mIdx.idx - 100) + '% em relação à média nos mesmos produtos.') : item('Preço da equipe alinhado.', vIdx.length ? 'Nos mesmos produtos, todos vendem entre ' + sinal(vIdx[vIdx.length - 1].idx - 100) + '% e ' + sinal(vIdx[0].idx - 100) + '% da média: a diferença de R$/kg entre vendedores é de mix, não de desconto.' : 'Sem base no recorte.'),
        item('Travar desconto acima de 5%.', (h10.n + h510.n) + ' itens custaram ' + brl(h10.perda + h510.perda) + '.'),
        item('Cadastrar as metas de ' + Mo.mesNome + '.', 'O sistema de origem manda as cotas zeradas.')
      ] }
    ];

    // configuração de produtos
    const prodAll = B.prod.map((p, i) => { const a = M.prodM.get(i); return { i: i, nome: p[0], linha: p[1], carne: p[2], val: a ? a.val : 0, kg: a ? a.kg : 0 }; });
    const qb = (st.cfgBusca || '').trim().toLowerCase();
    const linVal = new Map(); prodAll.forEach((p) => linVal.set(p.linha, (linVal.get(p.linha) || 0) + p.val));
    const linNomes = Array.from(linVal.keys()).sort((a, b) => linVal.get(b) - linVal.get(a));
    const setExcl = (fn) => { const e = Object.assign({}, st.excl); fn(e); set({ excl: e, tip: null }); };
    const Cf = {
      escPreco: st.escopo !== 'tudo', escTudo: st.escopo === 'tudo', setPreco: () => set({ escopo: 'preco' }), setTudo: () => set({ escopo: 'tudo' }),
      busca: st.cfgBusca, onBusca: (e) => set({ cfgBusca: e.target.value }),
      padrao: () => { const e = {}; B.prod.forEach((p, i) => { if (!p[2]) e[i] = true; }); set({ excl: e }); },
      todos: () => set({ excl: {} }),
      nenhumInativo: () => setExcl((e) => B.prod.forEach((p, i) => { if (!p[2] || /inativ/i.test(p[1])) e[i] = true; })),
      resumo: [{ rot: 'Produtos dentro', val: nInc + ' de ' + B.prod.length }, { rot: 'Preço médio com a escolha', val: rk(precoTot) + '/kg' }, { rot: 'Volume dentro', val: num(tot.kgP / 1000) + ' t' }, { rot: 'Faturamento dentro', val: brl(tot.valP) }],
      linhas: linNomes.map((ln) => { const todosL = prodAll.filter((p) => p.linha === ln); const ps = todosL.filter((p) => !qb || p.nome.toLowerCase().indexOf(qb) >= 0).sort((a, b) => b.val - a.val); const dentro = todosL.filter((p) => !st.excl[p.i]).length; return { nome: ln, info: dentro + ' de ' + todosL.length + ' dentro', marcar: () => setExcl((e) => todosL.forEach((p) => { delete e[p.i]; })), desmarcar: () => setExcl((e) => todosL.forEach((p) => { e[p.i] = true; })), prods: ps.map((p) => ({ nome: p.nome + (p.carne ? '' : ' · despojo'), on: !st.excl[p.i], cor: st.excl[p.i] ? '#6B5E52' : '#2B2118', val: brl(p.val), kg: num(p.kg) + ' kg', rkg: p.kg ? rk(p.val / p.kg) : '—', toggle: () => setExcl((e) => { if (e[p.i]) delete e[p.i]; else e[p.i] = true; }) })) }; }).filter((g) => g.prods.length)
    };

    // detalhe
    let detAberto = false, detTitulo = '', detTipo = '', detSub = '', detCor = '#8A5A0B', detAcao = '', detStats = [], detRows = [], detMostrando = '';
    if (st.det) {
      const t = st.det.tipo, v = st.det.v;
      let base = C;
      if (t === 'seg') { base = C.filter((c) => c.seg === v); detTipo = 'Grupo de clientes'; detTitulo = SEG[v].nome; detSub = SEG[v].regra; detCor = SEG[v].cor; detAcao = SEG[v].acao + '.'; }
      else if (t === 'cur') { base = C.filter((c) => c.cur === v); detTipo = 'Curva de clientes'; detTitulo = 'Curva ' + ['A', 'B', 'C'][v]; detSub = ['os clientes que fazem 80% do faturamento', 'os que fazem os 15% seguintes', 'os que fazem os últimos 5%'][v]; detAcao = ['Conta-chave: visita, previsão de pedido e condição negociada por grupo.', 'Os candidatos a subir para a curva A: oferecer a linha que falta.', 'Atender com o menor custo: pedido mínimo e entrega junto com a rota.'][v]; }
      else if (t === 'nl') { base = C.filter((c) => c.nl === v); detTipo = 'Venda cruzada'; detTitulo = v === 0 ? 'Compram só subprodutos' : 'Compram ' + v + (v === 1 ? ' linha' : ' linhas') + ' de carne'; detSub = 'desossados, com osso e miúdos'; detAcao = v === 3 ? 'Os clientes completos: proteger e usar como referência.' : 'Oferecer a linha que o cliente ainda não compra, no próximo pedido.'; }
      else if (t === 'grp') { base = C.filter((c) => c.grp === v); detTipo = 'Grupo econômico'; detTitulo = B.grp[v]; detSub = 'lojas com a mesma raiz de CNPJ'; detAcao = 'Negociar com o grupo como uma conta só: preço, prazo e meta por grupo, não por loja.'; }
      else if (t === 'rec') { base = C.filter((c) => recFaixa(c.r) === v); detTipo = 'Saúde da carteira'; detTitulo = REC[v][0]; detSub = REC[v][3]; detCor = REC[v][1]; detAcao = v >= 2 ? 'Ligar ainda esta semana, começando pelos que mais compravam.' : ''; }
      else if (t === 'vend') { base = C.filter((c) => c.ven === v); detTipo = 'Carteira do vendedor'; detTitulo = vNome(v); detSub = 'clientes em que este vendedor é quem mais vende'; }
      else if (t === 'cid') { base = C.filter((c) => c.cidI === v); detTipo = 'Cidade'; detTitulo = B.cid[v]; detSub = 'clientes da cidade'; }
      else if (t === 'prod') { const ids = new Set(); M.its.forEach((x) => { if (x[4] === v) ids.add(x[3]); }); base = C.filter((c) => ids.has(c.ci)); detTipo = 'Quem compra o produto'; detTitulo = B.prod[v][0]; detSub = B.prod[v][1] + ' · valores do cliente em todas as compras do período'; }
      else { detTipo = 'Carteira completa'; detTitulo = 'Todos os ' + C.length + ' clientes'; detSub = 'quem comprou de ' + ddmmaa(st.de) + ' a ' + ddmmaa(st.ate); }
      const qq = (st.busca || '').trim().toLowerCase();
      const lista = qq ? base.filter((c) => c.nome.toLowerCase().indexOf(qq) >= 0 || c.cid.toLowerCase().indexOf(qq) >= 0) : base;
      const ks = [(c) => c.nome, (c) => c.cid, (c) => vNome(c.ven), (c) => c.val, (c) => c.kgP ? c.valP / c.kgP : 0, (c) => c.notas, (c) => c.f, (c) => c.r, (c) => c.seg, (c) => c.cur, (c) => c.tab ? c.desc / c.tab : 0];
      const kf = ks[st.ord] || ks[3];
      const ord = lista.slice().sort((a, b) => { const x = kf(a), y = kf(b); return (typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y) * st.dir; });
      const vt = base.reduce((s, c) => s + c.val, 0), kg = base.reduce((s, c) => s + c.kgP, 0), vp = base.reduce((s, c) => s + c.valP, 0), tb = base.reduce((s, c) => s + c.tab, 0), dsc = base.reduce((s, c) => s + c.desc, 0);
      detStats = [{ rot: 'Clientes', val: num(base.length) }, { rot: 'Faturamento', val: brl(vt) }, { rot: 'Peso no recorte', val: pct(vt / TOT * 100) }, { rot: 'Por cliente', val: brl(base.length ? vt / base.length : 0) }, { rot: 'R$/kg', val: rk(kg ? vp / kg : 0) }, { rot: 'Desconto', val: pct(tb ? dsc / tb * 100 : 0, 2) }];
      detMostrando = lista.length === base.length ? num(base.length) + ' clientes' : num(lista.length) + ' de ' + num(base.length) + ' clientes';
      detRows = ord.map((c) => { const s = SEG[c.seg], fx = recFaixa(c.r), uf = [VERDE, NEUTRO, LARANJA, VERM][fx], dp = c.tab ? c.desc / c.tab * 100 : 0, df = fx3(dp, 1.5, 2.5); return { nome: c.nome, grupo: c.grp >= 0 ? 'grupo ' + B.grp[c.grp] : '', cid: c.cid, vend: vNome(c.ven), val: brl(c.val), rkg: rk(c.kgP ? c.valP / c.kgP : 0), nt: c.notas, f: c.f + (c.f === 1 ? ' vez' : ' vezes'), ult: c.r === 0 ? 'no último dia' : 'há ' + c.r + (c.r === 1 ? ' dia' : ' dias'), uF: uf[0], uC: uf[1], seg: s.nome, sF: s.fundo, sC: s.cor, cur: ['A', 'B', 'C'][c.cur], nl: c.nl + (c.nl === 1 ? ' linha' : ' linhas'), desc: dp <= 0 ? 'na tabela' : pct(dp, 2), dF: df[0], dC: df[1] }; });
      detAberto = true;
    }
    const colsDef = ['Cliente', 'Cidade', 'Vendedor', 'Faturamento', 'R$/kg', 'Notas', 'Comprou', 'Última compra', 'Grupo', 'Curva · linhas', 'Desconto'];
    const detCols = colsDef.map((rot, i) => ({ rot: rot, cor: st.ord === i ? '#2B2118' : '#6B5E52', seta: st.ord === i ? (st.dir < 0 ? '↓' : '↑') : '', pick: () => set({ ord: i, dir: st.ord === i ? -st.dir : (i <= 2 ? 1 : -1) }) }));

    const abasDef = [['geral', 'Visão geral'], ['vend', 'Vendedores'], ['cli', 'Clientes'], ['cid', 'Cidades'], ['prod', 'Produtos'], ['flex', 'Preço e desconto'], ['log', 'Logística'], ['meta', 'Metas']];
    const vazio = tot.n === 0;
    return {
      H: H, F: F, T: T, sair: sair, vazio: vazio,
      abas: abasDef.map((a) => ({ rot: a[1], pick: () => set({ tab: a[0], tip: null }), linha: st.tab === a[0] ? '#C8941A' : 'transparent', cor: st.tab === a[0] ? '#2B2118' : '#5E5247', peso: st.tab === a[0] ? '700' : '500' })),
      periodos: periodos,
      tGeral: !vazio && st.tab === 'geral', tVend: !vazio && st.tab === 'vend', tCli: !vazio && st.tab === 'cli', tCid: !vazio && st.tab === 'cid', tProd: !vazio && st.tab === 'prod', tFlex: !vazio && st.tab === 'flex', tLog: !vazio && st.tab === 'log', tMeta: st.tab === 'meta',
      kpis: kpis, diag: diag,
      grupoFatias: grupoFatias, grupoCentroRot: st.med === 'val' ? 'faturamento' : 'volume', grupoCentroVal: st.med === 'val' ? brl(tot.val) : num(tot.kg / 1000) + ' t',
      verVal: () => set({ med: 'val', tip: null }), verKg: () => set({ med: 'kg', tip: null }), mVal: st.med === 'val' ? on : off, mKg: st.med === 'val' ? off : on,
      M: Mo, L: L, DI: DI, semana: semana, tbLin: tbLin,
      vendFatias: vendFatias, vendTop3: vendTop3, tbVend: tbVend, Q: Q, mixVend: mixVend, legGrupos: GNOME.map((n, i) => ({ nome: n, cor: GCOR[i] })),
      nCli: num(C.length), rfm: rfm, P: P, curvas: curvas, cross: cross, crossLeitura: crossLeitura, ticket: ticket, tbGrp: tbGrp, recencia: recencia,
      abrirTodos: () => abrir('todos', null),
      cidFatias: cidFatias, cidCentro: { rot: '2 maiores', val: pct(top2 / TOT * 100) }, cidKpis: cidKpis, tbCid: tbCid,
      prodKpis: prodKpis, tbProd: tbProd, faixaMax: 'R$ ' + fxMax,
      hist: hist, histLeitura: histLeitura, indice: indice, idxEsc: idxEsc, tbDesc: tbDesc,
      logKpis: logKpis, cargasKg: cargasKg, cargasDia: cargasDia, tbTr: tbTr,
      tbMeta: tbMeta,
      cfgAberto: st.cfg, abrirCfg: () => set({ cfg: true, tip: null }), fecharCfg: () => set({ cfg: false }), C: Cf,
      detAberto: detAberto, detTitulo: detTitulo, detTipo: detTipo, detSub: detSub, detCor: detCor, detAcao: detAcao, detTemAcao: !!detAcao, detStats: detStats, detRows: detRows, detMostrando: detMostrando, detCols: detCols,
      fechar: () => set({ det: null }), busca: st.busca, onBusca: (e) => set({ busca: e.target.value })
    };
  }
}
