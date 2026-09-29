'use strict';

/**
 * 巡演备货：以当前场景道具全集为需求清单，标记已备齐的道具，
 * 录入至多 30 个采购包（每包名称唯一、正整数价格、所含道具均来自需求清单，
 * 每包最多购买一次），求覆盖全部缺件的最低总价组合。
 *
 * 约束：
 *  - 需求道具由全部场景道具汇总去重（与装箱共用道具口径）；
 *  - 缺件（未备齐道具）种数 n ≤ 14（MAX_STOCK_MISSING）；
 *  - 采购包 0～30 个，名称非空且不重复，价格为正整数，道具均来自需求清单；
 *  - 包内道具允许重复覆盖同一缺件，也允许只含已备齐道具（这样的包永远不会入选）。
 *
 * 目标：
 *  ① 选中包价格总和最小；
 *  ② 同价时包数最少；
 *  ③ 仍同分时按录入顺序稳定选取（包序号升序集合的字典序最小）。
 * 没有缺件时返回空组合、总价 0；缺件无法被任何包组合覆盖时明确报错。
 *
 * 算法：0/1 背包式子集 DP。
 *  - 每个包把它在缺件集合上覆盖到的位掩码 pm 视作“物品”，按录入顺序逐个处理，
 *    ndp[m | pm] = min(dp[m] + 该包代价)（0/1：只从上一轮 dp 转移）；
 *  - 状态代价为 (总价, 包数, 已选包序号升序集合的字典序)，n ≤ 14、包 ≤ 30 时
 *    至多 30 × 16384 ≈ 49 万次转移；
 *  - parent 链记录每个状态“最后选入的包”，沿链重构即得按录入顺序排列的采购包。
 */

const { collectProps } = require('./packing');

/** 缺件（未备齐道具）种数上限。 */
const MAX_STOCK_MISSING = 14;
/** 采购包数量上限。 */
const MAX_PACKAGES = 30;

/** 掩码 a 的置位序号升序列表是否字典序小于 b 的（首个分歧位取序号小者）。 */
function maskLexLess(a, b) {
  let x = a;
  let y = b;
  while (x && y) {
    const ia = 31 - Math.clz32(x & (-x));
    const ib = 31 - Math.clz32(y & (-y));
    if (ia !== ib) return ia < ib;
    x &= x - 1;
    y &= y - 1;
  }
  return false; // 两者完全相同
}

/**
 * 候选方案 (价格, 包数, 包序号掩码) 是否严格优于现状。
 * 优先级：总价低 → 包数少 → 包序号集合字典序小（录入顺序稳定）。
 */
function better(candPrice, candCount, candMask, curPrice, curCount, curMask) {
  if (candPrice !== curPrice) return candPrice < curPrice;
  if (candCount !== curCount) return candCount < curCount;
  return maskLexLess(candMask, curMask);
}

/**
 * 校验并规范化备货载荷
 * { scenes, stocking: { prepared: string[], packages: [{ name, price, props }] } }。
 * 返回 { errors, required, prepared, missing, packages }：
 *  - required: 需求清单（场景道具汇总去重，保持录入顺序）；
 *  - prepared: 已备齐道具（规范化去重，均须在需求清单内，保持其录入顺序）；
 *  - missing: 缺件 = 需求清单中未备齐者（保持需求清单顺序）；
 *  - packages: [{ name, price, props }]（名称 trim、道具按需求清单顺序去重）。
 */
function validateStocking(body) {
  const errors = [];

  const rawScenes = body && body.scenes;
  if (!Array.isArray(rawScenes)) errors.push('场景数据缺失，无法汇总备货需求清单');
  const required = collectProps(Array.isArray(rawScenes) ? rawScenes : []);
  const requiredSet = new Set(required);

  // ---- 已备齐道具：须为字符串数组，且每件都在需求清单内 ----
  const rawPrepared = body && body.stocking && body.stocking.prepared;
  const prepared = [];
  if (rawPrepared !== undefined && rawPrepared !== null) {
    if (!Array.isArray(rawPrepared)) {
      errors.push('已备齐道具必须是道具名称数组');
    } else {
      for (const p0 of rawPrepared) {
        if (typeof p0 !== 'string' && typeof p0 !== 'number') {
          errors.push('已备齐道具名称必须是文本');
          continue;
        }
        const p = String(p0).trim();
        if (!p) continue;
        if (!requiredSet.has(p)) {
          errors.push(`已备齐道具「${p}」不在当前场景道具需求清单中`);
          continue;
        }
        if (!prepared.includes(p)) prepared.push(p);
      }
    }
  }

  // ---- 缺件：需求清单中未标记备齐者 ----
  const preparedSet = new Set(prepared);
  const missing = required.filter(p => !preparedSet.has(p));
  if (missing.length > MAX_STOCK_MISSING) {
    errors.push(`缺件共 ${missing.length} 种，超过 ${MAX_STOCK_MISSING} 种上限，请先备齐部分道具或减少场景道具种类`);
  }

  // ---- 采购包 ----
  const rawPackages = body && body.stocking && body.stocking.packages;
  const packages = [];
  if (rawPackages !== undefined && rawPackages !== null && !Array.isArray(rawPackages)) {
    errors.push('采购包必须是数组');
  }
  const rawList = Array.isArray(rawPackages) ? rawPackages : [];
  if (rawList.length > MAX_PACKAGES) {
    errors.push(`采购包最多录入 ${MAX_PACKAGES} 个（当前 ${rawList.length} 个）`);
  }
  const nameSeen = new Set();
  rawList.slice(0, MAX_PACKAGES).forEach((pkg, i) => {
    const where = `第 ${i + 1} 个采购包`;
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      errors.push(`${where}格式无效：应为 { name, price, props }`);
      return;
    }

    const name = String(pkg.name == null ? '' : pkg.name).trim();
    if (!name) {
      errors.push(`${where}缺少名称`);
    } else if (nameSeen.has(name)) {
      errors.push(`采购包名称重复：「${name}」`);
    }
    nameSeen.add(name);

    const price = Number(pkg.price);
    if (!Number.isInteger(price) || price <= 0) {
      errors.push(`采购包「${name || where}」的价格必须是正整数`);
    }

    const props = [];
    if (pkg.props !== undefined && pkg.props !== null && !Array.isArray(pkg.props)) {
      errors.push(`采购包「${name || where}」的道具必须是数组`);
    } else {
      for (const p0 of (Array.isArray(pkg.props) ? pkg.props : [])) {
        if (typeof p0 !== 'string' && typeof p0 !== 'number') {
          errors.push(`采购包「${name || where}」中存在无效道具名`);
          continue;
        }
        const p = String(p0).trim();
        if (!p) continue;
        if (!requiredSet.has(p)) {
          errors.push(`采购包「${name || where}」包含需求清单之外的道具：${p}`);
          continue;
        }
        if (!props.includes(p)) props.push(p);
      }
      if (props.length === 0) {
        errors.push(`采购包「${name || where}」至少要包含一件需求清单内的道具`);
      }
    }

    packages.push({ name, price: Number.isInteger(price) && price > 0 ? price : 0, props });
  });
  if ((rawPackages === undefined || rawPackages === null) && missing.length > 0) {
    errors.push(`缺少采购包数据：请录入至少 1 个采购包（最多 ${MAX_PACKAGES} 个）`);
  } else if (Array.isArray(rawPackages) && rawPackages.length === 0 && missing.length > 0) {
    errors.push('还没有录入任何采购包，无法覆盖缺件');
  }

  return { errors, required, prepared, missing, packages };
}

/**
 * 求覆盖全部缺件的最低总价采购包组合。入参须先经 validateStocking 校验。
 * 返回
 * { ok, required, prepared, missing, packages, selectedIndexes,
 *   selectedPackages, packageCount, totalPrice, coveredMissing }：
 *  - selectedPackages: [{ index, name, price, props, coversMissing }]，按录入顺序；
 *  - coveredMissing: 每个缺件被哪些选中包覆盖（{ prop, by: [包名...] }，按缺件顺序）。
 * 无法覆盖时返回 { ok:false, errors:[...] }，不输出采购方案。
 */
function planStocking(required, prepared, missing, packages) {
  const n = missing.length;

  // 没有缺件：空组合、总价零
  if (n === 0) {
    return {
      ok: true,
      required: required.slice(),
      prepared: prepared.slice(),
      missing: [],
      packages: packages.map(p => ({ name: p.name, price: p.price, props: p.props.slice() })),
      selectedIndexes: [],
      selectedPackages: [],
      packageCount: 0,
      totalPrice: 0,
      coveredMissing: [],
    };
  }

  const missIndex = new Map(missing.map((p, i) => [p, i]));
  // 每个包在缺件集合上的覆盖掩码（只含已备齐道具的包掩码为 0，永不入选）
  const coverMasks = packages.map(p => {
    let m = 0;
    for (const prop of p.props) {
      const i = missIndex.get(prop);
      if (i !== undefined) m |= 1 << i;
    }
    return m;
  });

  // 覆盖性预检：某缺件不被任何包包含 → 直接给出具体名单
  let union = 0;
  for (const m of coverMasks) union |= m;
  const uncovered = missing.filter((_, i) => !(union & (1 << i)));
  if (uncovered.length) {
    return {
      ok: false,
      errors: [`以下缺件无法被任何采购包覆盖：${uncovered.join('、')}`],
    };
  }

  const size = 1 << n;
  const INF = Infinity;
  // 每个状态记录最优方案的总价、包数、包序号掩码，以及上一状态与最后选入的包
  const price = new Array(size).fill(INF);
  const count = new Array(size).fill(0);
  const chosen = new Array(size).fill(0);
  const prev = new Int32Array(size).fill(-1);
  const prevPkg = new Int16Array(size).fill(-1);
  price[0] = 0;

  packages.forEach((pkg, pi) => {
    const pm = coverMasks[pi];
    // 0/1 背包：只从上一轮状态转移（快照上一轮全部可达状态）
    const reachable = [];
    for (let m = 0; m < size; m++) if (price[m] !== INF) reachable.push(m);
    for (const m of reachable) {
      const nm = m | pm;
      if (nm === m) continue; // 该包对本状态无新增覆盖，买了只会更贵/包数更多
      const np = price[m] + pkg.price;
      const nc = count[m] + 1;
      const nChosen = chosen[m] | (1 << pi);
      if (price[nm] === INF
          || better(np, nc, nChosen, price[nm], count[nm], chosen[nm])) {
        price[nm] = np;
        count[nm] = nc;
        chosen[nm] = nChosen;
        prev[nm] = m;
        prevPkg[nm] = pi;
      }
    }
  });

  const full = size - 1;
  if (price[full] === INF) {
    // 与前置的并集预检互为兜底（理论上不可达：并集覆盖即可逐件凑齐）
    return { ok: false, errors: ['现有采购包无法组合覆盖全部缺件，请补充采购包'] };
  }

  // 沿 parent 链重构（链上是逆序的“最后选入包”），再按录入顺序输出
  const selectedIndexes = [];
  let mask = full;
  while (mask > 0) {
    selectedIndexes.push(prevPkg[mask]);
    mask = prev[mask];
  }
  selectedIndexes.sort((a, b) => a - b);

  return buildResult(required, prepared, missing, packages, coverMasks, selectedIndexes);
}

/** 按选中包下标组装稳定的成功响应。 */
function buildResult(required, prepared, missing, packages, coverMasks, selectedIndexes) {
  const selectedPackages = selectedIndexes.map(pi => ({
    index: pi,
    name: packages[pi].name,
    price: packages[pi].price,
    props: packages[pi].props.slice(),
    coversMissing: packages[pi].props.filter(p => missing.includes(p)),
  }));
  const totalPrice = selectedIndexes.reduce((sum, pi) => sum + packages[pi].price, 0);

  // 每个缺件由哪些选中包提供（按缺件顺序；同名道具可被多个包重复覆盖）
  const coveredMissing = missing.map((prop, mi) => {
    const by = [];
    for (const pi of selectedIndexes) {
      if (coverMasks[pi] & (1 << mi)) by.push(packages[pi].name);
    }
    return { prop, by };
  });

  return {
    ok: true,
    required: required.slice(),
    prepared: prepared.slice(),
    missing: missing.slice(),
    packages: packages.map(p => ({ name: p.name, price: p.price, props: p.props.slice() })),
    selectedIndexes,
    selectedPackages,
    packageCount: selectedIndexes.length,
    totalPrice,
    coveredMissing,
  };
}

module.exports = {
  validateStocking,
  planStocking,
  MAX_STOCK_MISSING,
  MAX_PACKAGES,
};
