'use strict';
/**
 * 巡演备货随机对拍：枚举全部采购包子集（2^k）暴力求最低总价组合
 * （同价比包数、再比录入顺序字典序），与 stocking.js 的子集 DP 对拍。
 * 用法：node fuzz-stock.js [组数=400]
 */
const { validateStocking, planStocking } = require('./stocking');

const ITERS = Number(process.argv[2]) || 400;

let seed = 135792468;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(n) { return Math.floor(rnd() * n); }

/** 暴力：枚举全部包子集，按 (总价, 包数, 序号掩码字典序) 取最优。 */
function brute(k, cover, price, fullMask) {
  let best = null;
  for (let mask = 0; mask < (1 << k); mask++) {
    let cov = 0;
    let total = 0;
    let cnt = 0;
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) { cov |= cover[i]; total += price[i]; cnt++; }
    }
    if (cov !== fullMask) continue;
    if (!best
        || total < best.total
        || (total === best.total && cnt < best.cnt)
        || (total === best.total && cnt === best.cnt && mask < best.mask)) {
      best = { total, cnt, mask };
    }
  }
  return best;
}

let cases = 0;
for (let t = 0; t < ITERS; t++) {
  const n = 1 + ri(9); // 1..9 种缺件
  const required = Array.from({ length: n }, (_, i) => `p${i}`);
  // 随机备齐一些道具（缺件 = 未备齐）
  const prepared = required.filter(() => rnd() < 0.25);
  const missing = required.filter(p => !prepared.includes(p));
  if (!missing.length) continue;

  const k = 1 + ri(12); // 1..12 个包（枚举上限 2^12）
  const nameSeen = new Set();
  const packages = [];
  for (let i = 0; i < k; i++) {
    let name = `包${i}`;
    while (nameSeen.has(name)) name += '_';
    nameSeen.add(name);
    const props = required.filter(() => rnd() < 0.35);
    // 部分包只含已备齐道具（允许但无用）
    const useReadyOnly = rnd() < 0.1 && prepared.length > 0;
    packages.push({
      name,
      price: 1 + ri(20),
      props: useReadyOnly ? [prepared[ri(prepared.length)]] : (props.length ? props : [required[ri(n)]]),
    });
  }

  const body = { scenes: [{ id: 's', props: required }], stocking: { prepared, packages } };
  const v = validateStocking(body);
  if (v.errors.length) throw new Error('合法载荷被判错：' + v.errors.join('；'));

  const missIndex = new Map(missing.map((p, i) => [p, i]));
  const fullMask = (1 << missing.length) - 1;
  const cover = packages.map(pkg => {
    let m = 0;
    for (const p of pkg.props) if (missIndex.has(p)) m |= 1 << missIndex.get(p);
    return m;
  });
  const expect = brute(k, cover, packages.map(p => p.price), fullMask);
  const r = planStocking(v.required, v.prepared, v.missing, v.packages);

  if (!expect) {
    // 暴力无解：DP 也必须报无法覆盖
    if (r.ok) throw new Error(`第 ${t} 组：暴力无解但 DP 给出方案`);
    cases++;
    continue;
  }
  if (!r.ok) throw new Error(`第 ${t} 组：暴力有解但 DP 报错：${r.errors.join('；')}`);

  const gotMask = r.selectedIndexes.reduce((m, i) => m | (1 << i), 0);
  if (r.totalPrice !== expect.total || r.packageCount !== expect.cnt || gotMask !== expect.mask) {
    console.error(JSON.stringify(body, null, 2));
    throw new Error(`第 ${t} 组：DP=(价${r.totalPrice}, 包${r.packageCount}, ${gotMask}) `
      + `暴力=(价${expect.total}, 包${expect.cnt}, ${expect.mask})`);
  }

  // 合法性：选中包确实覆盖全部缺件，每包至多买一次（下标唯一）
  assertUnique(r.selectedIndexes);
  let cov = 0;
  for (const i of r.selectedIndexes) cov |= cover[i];
  if (cov !== fullMask) throw new Error(`第 ${t} 组：未覆盖全部缺件`);
  // 总价等于选中包价格之和
  const sum = r.selectedIndexes.reduce((s, i) => s + packages[i].price, 0);
  if (sum !== r.totalPrice) throw new Error(`第 ${t} 组：总价与选中包价格之和不一致`);
  cases++;
}

function assertUnique(arr) {
  if (new Set(arr).size !== arr.length) throw new Error('存在采购包被重复购买');
}

console.log(`备货对拍 ${cases} 组全部通过 ✔`);
