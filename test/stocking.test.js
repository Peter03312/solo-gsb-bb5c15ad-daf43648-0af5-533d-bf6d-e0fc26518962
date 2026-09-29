'use strict';

const assert = require('assert');
const { validateStocking, planStocking, MAX_STOCK_MISSING, MAX_PACKAGES } = require('../stocking');

const S = (id, props) => ({ id, name: id, props });

/** 构造已校验载荷并求解的快捷函数 */
function run(body) {
  const v = validateStocking(body);
  assert.deepStrictEqual(v.errors, []);
  return planStocking(v.required, v.prepared, v.missing, v.packages);
}

/* 1. 无缺件：空组合、总价零 */
{
  const r = run({
    scenes: [S('s', ['A', 'B'])],
    stocking: { prepared: ['A', 'B'], packages: [{ name: 'p', price: 3, props: ['A'] }] },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.selectedIndexes, []);
  assert.deepStrictEqual(r.selectedPackages, []);
  assert.strictEqual(r.packageCount, 0);
  assert.strictEqual(r.totalPrice, 0);
}

/* 1b. 无缺件且完全没有采购包数据：仍返回空组合、总价零（不报错） */
{
  const r1 = run({ scenes: [S('s', ['A'])], stocking: { prepared: ['A'] } });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.totalPrice, 0);
  assert.deepStrictEqual(r1.selectedPackages, []);

  const r2 = run({ scenes: [S('s', ['A'])], stocking: { prepared: ['A'], packages: [] } });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.totalPrice, 0);
}

/* 2. 基础覆盖：3 件缺件，取低价组合 */
{
  const r = run({
    scenes: [S('s', ['A', 'B', 'C'])],
    stocking: {
      prepared: [],
      packages: [
        { name: 'p1', price: 5, props: ['A', 'B'] },
        { name: 'p2', price: 5, props: ['C'] },
        { name: 'p3', price: 12, props: ['A', 'B', 'C'] },
      ],
    },
  });
  assert.strictEqual(r.totalPrice, 10);
  assert.deepStrictEqual(r.selectedIndexes, [0, 1]);
  assert.deepStrictEqual(r.selectedPackages.map(p => p.name), ['p1', 'p2']);
  // 每个缺件都有覆盖来源
  for (const { prop, by } of r.coveredMissing) {
    assert.ok(by.length > 0, `缺件 ${prop} 未被覆盖`);
  }
  assert.deepStrictEqual(r.coveredMissing.map(x => x.prop), ['A', 'B', 'C']);
}

/* 3. 同价优先包数少：单包 10 元 vs 两包 5+5 */
{
  const r = run({
    scenes: [S('s', ['A', 'B'])],
    stocking: {
      prepared: [],
      packages: [
        { name: 'two1', price: 5, props: ['A'] },
        { name: 'two2', price: 5, props: ['B'] },
        { name: 'one', price: 10, props: ['A', 'B'] },
      ],
    },
  });
  assert.strictEqual(r.totalPrice, 10);
  assert.strictEqual(r.packageCount, 1);
  assert.deepStrictEqual(r.selectedPackages.map(p => p.name), ['one']);
}

/* 4. 同价同包数按录入顺序稳定：取序号集合字典序小者 */
{
  // 组合甲 {包1(idx1)} 与组合乙 {包2(idx2)} 同价同包数 → 取 idx1
  const r = run({
    scenes: [S('s', ['A', 'B'])],
    stocking: {
      prepared: [],
      packages: [
        { name: 'later-single', price: 10, props: ['A'] },
        { name: 'combo-a', price: 10, props: ['A', 'B'] },
        { name: 'combo-b', price: 10, props: ['B', 'A'] },
      ],
    },
  });
  assert.deepStrictEqual(r.selectedIndexes, [1]);
  // 确定性：重复求解一致
  const r2 = run({
    scenes: [S('s', ['A', 'B'])],
    stocking: {
      prepared: [],
      packages: [
        { name: 'later-single', price: 10, props: ['A'] },
        { name: 'combo-a', price: 10, props: ['A', 'B'] },
        { name: 'combo-b', price: 10, props: ['B', 'A'] },
      ],
    },
  });
  assert.deepStrictEqual(r.selectedIndexes, r2.selectedIndexes);
}

/* 5. 多包组合同分稳定性：{0,2} 与 {0,3} 同价同包数 → {0,2} 字典序小 */
{
  const r = run({
    scenes: [S('s', ['A', 'B'])],
    stocking: {
      prepared: [],
      packages: [
        { name: 'p0', price: 4, props: ['A'] },
        { name: 'p1', price: 4, props: ['A'] },
        { name: 'p2', price: 6, props: ['B'] },
        { name: 'p3', price: 6, props: ['B'] },
      ],
    },
  });
  assert.strictEqual(r.totalPrice, 10);
  assert.deepStrictEqual(r.selectedIndexes, [0, 2]);
}

/* 6. 每包最多买一次：不能靠重复买同一个便宜包凑覆盖 */
{
  const r = run({
    scenes: [S('s', ['A', 'B'])],
    stocking: {
      prepared: [],
      packages: [
        { name: 'cheap', price: 1, props: ['A'] },
        { name: 'bpack', price: 5, props: ['B'] },
      ],
    },
  });
  assert.strictEqual(r.totalPrice, 6);
  assert.deepStrictEqual(r.selectedIndexes, [0, 1]);
}

/* 7. 已备齐道具：缺件只是未备齐部分；包可含已备齐道具 */
{
  const r = run({
    scenes: [S('s', ['A', 'B', 'C'])],
    stocking: {
      prepared: ['A'],
      packages: [
        { name: 'only-missing', price: 9, props: ['B', 'C'] },
        { name: 'with-ready', price: 8, props: ['A', 'B', 'C'] },
      ],
    },
  });
  assert.deepStrictEqual(r.missing, ['B', 'C']);
  assert.strictEqual(r.totalPrice, 8);
  assert.deepStrictEqual(r.selectedPackages[0].props, ['A', 'B', 'C']);
  assert.deepStrictEqual(r.selectedPackages[0].coversMissing, ['B', 'C']);
}

/* 8. 只含已备齐道具的包不会被单独选中 */
{
  const r = run({
    scenes: [S('s', ['A', 'B'])],
    stocking: {
      prepared: ['A'],
      packages: [
        { name: 'redundant', price: 1, props: ['A'] },
        { name: 'need', price: 5, props: ['B'] },
      ],
    },
  });
  assert.strictEqual(r.totalPrice, 5);
  assert.deepStrictEqual(r.selectedIndexes, [1]);
}

/* 9. 缺件无法覆盖：明确报错且不输出方案 */
{
  const r = run({
    scenes: [S('s', ['A', 'B'])],
    stocking: { prepared: [], packages: [{ name: 'p', price: 1, props: ['A'] }] },
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('B')));
  assert.strictEqual(r.selectedPackages, undefined);
}

/* 10. 缺件超过 14 种：报错件数 */
{
  const props = Array.from({ length: 15 }, (_, i) => `p${i}`);
  const v = validateStocking({
    scenes: [S('s', props)],
    stocking: { prepared: [], packages: [{ name: 'p', price: 1, props }] },
  });
  assert.ok(v.errors.some(e => e.includes('15') && e.includes(String(MAX_STOCK_MISSING))));
}

/* 11. 恰好 14 种缺件可以求解 */
{
  const props = Array.from({ length: 14 }, (_, i) => `p${i}`);
  const r = run({
    scenes: [S('s', props)],
    stocking: { prepared: [], packages: [{ name: 'all', price: 1, props }] },
  });
  assert.strictEqual(r.totalPrice, 1);
  assert.strictEqual(r.missing.length, 14);
}

/* 12. 采购包名称重复：报错 */
{
  const v = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: {
      prepared: [],
      packages: [
        { name: '同款', price: 1, props: ['A'] },
        { name: ' 同款 ', price: 2, props: ['A'] },
      ],
    },
  });
  assert.ok(v.errors.some(e => e.includes('重复')));
}

/* 13. 价格无效：0、负数、小数、非数字 */
for (const price of [0, -1, 1.5, 'abc', null]) {
  const v = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: { prepared: [], packages: [{ name: 'p', price, props: ['A'] }] },
  });
  assert.ok(v.errors.some(e => e.includes('价格') && e.includes('正整数')), `价格 ${price} 应报错`);
}

/* 14. 道具无效：空包、包内含清单外道具、props 非数组 */
{
  const v1 = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: { prepared: [], packages: [{ name: 'p', price: 1, props: [] }] },
  });
  assert.ok(v1.errors.some(e => e.includes('至少')));

  const v2 = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: { prepared: [], packages: [{ name: 'p', price: 1, props: ['A', 'X'] }] },
  });
  assert.ok(v2.errors.some(e => e.includes('X')));

  const v3 = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: { prepared: [], packages: [{ name: 'p', price: 1, props: 'A' }] },
  });
  assert.ok(v3.errors.some(e => e.includes('道具必须是数组')));
}

/* 15. 已备齐道具不在需求清单：报错 */
{
  const v = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: { prepared: ['Z'], packages: [{ name: 'p', price: 1, props: ['A'] }] },
  });
  assert.ok(v.errors.some(e => e.includes('Z')));
}

/* 16. 采购包数量：0 个且有缺件报错；超过 30 个报错 */
{
  const v1 = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: { prepared: [], packages: [] },
  });
  assert.ok(v1.errors.some(e => e.includes('采购包')));

  const many = Array.from({ length: MAX_PACKAGES + 1 }, (_, i) => ({
    name: `p${i}`, price: 1, props: ['A'],
  }));
  const v2 = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: { prepared: [], packages: many },
  });
  assert.ok(v2.errors.some(e => e.includes(String(MAX_PACKAGES))));
}

/* 17. 缺采购包字段 / stocking 缺失：报错 */
{
  const v1 = validateStocking({ scenes: [S('s', ['A'])] });
  assert.ok(v1.errors.some(e => e.includes('采购包')));

  const v2 = validateStocking({
    scenes: [S('s', ['A'])],
    stocking: { prepared: [], packages: [null] },
  });
  assert.ok(v2.errors.some(e => e.includes('格式无效')));
}

/* 18. 需求清单来自多场景汇总去重（与装箱同口径、同顺序） */
{
  const r = run({
    scenes: [S('s1', ['灯笼', '地毯']), S('s2', ['王座', '灯笼'])],
    stocking: {
      prepared: ['灯笼'],
      packages: [
        { name: 'p', price: 7, props: ['地毯', '王座'] },
      ],
    },
  });
  assert.deepStrictEqual(r.required, ['灯笼', '地毯', '王座']);
  assert.deepStrictEqual(r.missing, ['地毯', '王座']);
  assert.strictEqual(r.totalPrice, 7);
}

/* 19. 14 件缺件 + 30 包性能冒烟：毫秒级 */
{
  const props = Array.from({ length: 14 }, (_, i) => `p${i}`);
  const packages = Array.from({ length: 30 }, (_, i) => ({
    name: `包${i}`,
    price: 1 + (i % 9),
    props: props.filter((_, j) => ((i * 7 + j * 3) % 5) === 0),
  })).map(p => p.props.length ? p : { ...p, props: ['p0'] });
  const t0 = Date.now();
  const r = run({
    scenes: [S('s', props)],
    stocking: { prepared: [], packages },
  });
  assert.ok(Date.now() - t0 < 1000, '备货求解超时');
  // 结果合法：并集覆盖全部缺件
  const covered = new Set();
  for (const sp of r.selectedPackages) for (const p of sp.coversMissing) covered.add(p);
  assert.strictEqual(covered.size, 14);
}

console.log('备货测试全部通过 ✔');
