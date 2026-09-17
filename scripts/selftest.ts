import { solveAssignment, buildSuccess, matchedTagsOf } from '../src/engine/solver'
import { runStressTest, stressFingerprint } from '../src/engine/stress'
import { applySwap, enumerateSwaps } from '../src/engine/swap'
import type { AppData, AssignmentItem, AssignmentSuccess } from '../src/types'

let pass = 0
let fail = 0

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✕ ${name} ${extra}`)
  }
}

const mk = (papers: AppData['papers'], reviewers: AppData['reviewers']): AppData => ({ papers, reviewers })
const P = (id: string, title: string, reviewsRequired: number, tags: string[] = []) => ({ id: id, title, reviewsRequired, tags })
const R = (id: string, name: string, capacity: number, tags: string[] = [], conflictPaperIds: string[] = []) => ({
  id, name, capacity, tags, conflictPaperIds
})

// 1. 示例数据：可行且匹配/均衡合理
{
  const d = mk(
    [P('p1', 'LLM微调', 2, ['机器学习', 'NLP']), P('p2', 'GNN推荐', 2, ['机器学习', '推荐系统']), P('p3', 'KV存储', 2, ['分布式系统', '数据库']), P('p4', '联邦隐私', 2, ['安全', '机器学习'])],
    [R('a', 'Alice', 2, ['机器学习', 'NLP'], ['p1']), R('b', 'Bob', 2, ['机器学习', '推荐系统']), R('c', 'Carol', 3, ['分布式系统', '数据库'], ['p3']), R('d', 'Dave', 2, ['安全', '机器学习'])]
  )
  const res = solveAssignment(d)
  console.log('用例1 示例数据')
  check('可行', res.feasible)
  if (res.feasible) {
    check('共分配 8 个名额', res.objective.totalAssigned === 8, JSON.stringify(res.objective))
    check('每篇恰好 2 人', d.papers.every((p) => res.assignments.filter((a) => a.paperId === p.id).length === 2))
    check('无人超容量', res.loads.every((l) => l.assigned <= l.capacity))
    check('冲突对从未出现', !res.assignments.some((a) => (a.paperId === 'p1' && a.reviewerId === 'a') || (a.paperId === 'p3' && a.reviewerId === 'c')))
    check('主题匹配数=4（p3 与 c 的非匹配不可避免）', res.objective.topicMatches === 4, `got ${res.objective.topicMatches}`)
    check('最大负载=2（均衡）', res.objective.maxLoad === 2, `got ${res.objective.maxLoad}`)
  } else {
    console.log('   原因:', res.reasons.map((r) => r.message).join(' | '))
  }
}

// 2. 单篇稿件可分配人数不足
{
  const d = mk(
    [P('p1', '稿件A', 3, ['X'])],
    [R('a', '甲', 2, ['X'], ['p1']), R('b', '乙', 1), R('c', '丙', 1)]
  )
  const res = solveAssignment(d)
  console.log('用例2 单篇可分配人数不足')
  check('不可行', !res.feasible)
  if (!res.feasible) check('给出 paper-eligible 原因', res.reasons.some((r) => r.kind === 'paper-eligible'), JSON.stringify(res.reasons))
}

// 3. 全局容量不足
{
  const d = mk(
    [P('p1', 'A', 2), P('p2', 'B', 2)],
    [R('a', '甲', 1), R('b', '乙', 1)]
  )
  const res = solveAssignment(d)
  console.log('用例3 全局容量不足')
  check('不可行', !res.feasible)
  if (!res.feasible) check('给出 global-capacity 原因', res.reasons.some((r) => r.kind === 'global-capacity'))
}

// 4. 组合性瓶颈：p1,p2 都只能给 a,b（容量各1，共2），但两篇各需2人
{
  const d = mk(
    [P('p1', 'A', 2), P('p2', 'B', 2)],
    [R('a', '甲', 1, [], []), R('b', '乙', 1, [], []), R('c', '丙', 5, [], ['p1', 'p2'])]
  )
  const res = solveAssignment(d)
  console.log('用例4 组合性瓶颈')
  check('不可行', !res.feasible)
  if (!res.feasible) {
    const sub = res.reasons.find((r) => r.kind === 'subset-bottleneck')
    check('给出 subset-bottleneck 原因', !!sub, JSON.stringify(res.reasons.map((r) => r.kind)))
    check('缺口=2（广义 Hall 紧见证）', sub?.deficit === 2, `got ${sub?.deficit}`)
    check('瓶颈稿件含 p1,p2', sub?.paperIds?.length === 2)
    check('可选评审人仅 a,b（不含冲突者 c）', sub?.reviewerIds?.length === 2 && !sub.reviewerIds.includes('c'))
  }
}

// 4b. 全冲突型组合瓶颈（每篇都无任何可分配评审人）
{
  const res = solveAssignment(mk(
    [P('p1', 'A', 1), P('p2', 'B', 1)],
    [R('a', '甲', 5, [], ['p1', 'p2']), R('b', '乙', 5, [], ['p1', 'p2'])]
  ))
  console.log('用例4b 全冲突')
  check('不可行', !res.feasible)
  if (!res.feasible) check('每篇均给出单篇不足原因', res.reasons.filter((r) => r.kind === 'paper-eligible').length === 2)
}

// 5. 目标优先级：匹配优先于均衡（必要时宁愿负载不均也要拿匹配）
{
  // p1 标 X：只有 a 擅长 X；p2 无标签。容量 a=2,b=2。
  const d = mk(
    [P('p1', 'A', 1, ['X']), P('p2', 'B', 1)],
    [R('a', '甲', 2, ['X']), R('b', '乙', 2, ['Y'])]
  )
  const res = solveAssignment(d)
  console.log('用例5 主题匹配优先')
  check('可行', res.feasible)
  if (res.feasible) {
    const p1a = res.assignments.find((a) => a.paperId === 'p1')
    check('p1 分给匹配者 a', p1a?.reviewerId === 'a' && p1a.topicMatched)
  }
}

// 6. 均衡第二优先：匹配数相同时摊平负载
{
  // 两篇都无标签，两位评审人容量各 2，各需 1 → 应一人一篇
  const d = mk(
    [P('p1', 'A', 1), P('p2', 'B', 1)],
    [R('a', '甲', 2), R('b', '乙', 2)]
  )
  const res = solveAssignment(d)
  console.log('用例6 负载均衡')
  if (res.feasible) check('最大负载=1', res.objective.maxLoad === 1, `got ${res.objective.maxLoad}`)
}

// 7. 无评审人
{
  const res = solveAssignment(mk([P('p1', 'A', 1)], []))
  console.log('用例7 无评审人')
  check('不可行且提示', !res.feasible && res.reasons.length > 0)
}

// 8. 较大规模性能（30 稿 ×3 + 12 评审人容量 8）
{
  const papers = Array.from({ length: 30 }, (_, i) => P(`p${i}`, `稿件${i}`, 3, ['T' + (i % 6)]))
  const reviewers = Array.from({ length: 12 }, (_, j) => R(`r${j}`, `评审${j}`, 8, j < 6 ? ['T' + (j % 6)] : []))
  const t0 = Date.now()
  const res = solveAssignment(mk(papers, reviewers))
  const ms = Date.now() - t0
  console.log(`用例8 规模 30x12（${ms} ms）`)
  check('可行且 90 个名额', res.feasible && res.objective.totalAssigned === 90, JSON.stringify(res.feasible ? res.objective : res.reasons))
}

/* ============================ 缺席压力测试 ============================ */

// 9. 示例数据：总容量 9 仅比总需求 8 多 1，任何容量 ≥2 的评审人缺席都会击穿全局容量
{
  const d = mk(
    [P('p1', 'LLM微调', 2, ['机器学习', 'NLP']), P('p2', 'GNN推荐', 2, ['机器学习', '推荐系统']), P('p3', 'KV存储', 2, ['分布式系统', '数据库']), P('p4', '联邦隐私', 2, ['安全', '机器学习'])],
    [R('a', 'Alice', 2, ['机器学习', 'NLP'], ['p1']), R('b', 'Bob', 2, ['机器学习', '推荐系统']), R('c', 'Carol', 3, ['分布式系统', '数据库'], ['p3']), R('d', 'Dave', 2, ['安全', '机器学习'])]
  )
  const out = runStressTest(d)
  console.log('用例9 缺席压力测试 · 示例数据')
  check('可运行（基线可行）', out.runnable)
  if (out.runnable) {
    const rep = out.report
    check('受测 4 人', rep.testedReviewerCount === 4)
    check('汇总 0 仍可分配 / 4 不可分配（总容量仅余 1）', rep.feasibleCount === 0 && rep.infeasibleCount === 4, JSON.stringify(rep.scenarios.map((s) => [s.reviewerId, s.feasible])))
    const carol = rep.scenarios.find((s) => s.reviewerId === 'c')
    check('Carol 缺席不可行', !!carol && !carol.feasible)
    check('Carol 缺席：全局名额缺口=2', carol?.globalDeficit === 2, `got ${carol?.globalDeficit}`)
    check('Carol 缺席：剩余容量=6', carol?.remainingCapacity === 6)
    check('Carol 缺席：受影响稿件 4 篇', carol?.affectedPapers?.length === 4, `got ${carol?.affectedPapers?.length}`)
    check('Carol 缺席：瓶颈缺口=2', carol?.deficit === 2, `got ${carol?.deficit}`)
    check('Carol 缺席：可选评审人瓶颈含其余 3 人', carol?.bottleneckReviewers?.length === 3 && !carol.bottleneckReviewers.some((b) => b.reviewerId === 'c'))
    check('不可行项不止总容量：含受影响稿件与瓶颈评审人', rep.scenarios.every((s) => s.feasible || (!!s.affectedPapers?.length && !!s.bottleneckReviewers?.length)))
    check('Alice/Bob/Dave 缺席全局缺口各为 1', ['a', 'b', 'd'].every((id) => rep.scenarios.find((s) => s.reviewerId === id)?.globalDeficit === 1))
  }
}

// 10. 基线不可行时压力测试不可运行
{
  const d = mk([P('p1', 'A', 3, ['X'])], [R('a', '甲', 2, ['X'], ['p1']), R('b', '乙', 1), R('c', '丙', 1)])
  const out = runStressTest(d)
  console.log('用例10 基线不可行')
  check('runnable=false 且带回原因', !out.runnable && 'reasons' in out && out.reasons.length > 0)
}

// 11. 全局容量充足但组合性瓶颈：缺席后“不能只报总容量不足”
// 三篇各需 1；甲容量2 三篇均可评、乙容量2 三篇均可评、丙容量5 但对三篇全冲突。
// 基线可行（甲乙分担）。甲缺席 → 只剩乙（容量2）可评三篇：每篇可选人数仍够（1=需求），
// 但 Hall 缺口 1；此时剩余总容量 7 远大于需求 3，纯粹是组合性瓶颈。
{
  const d = mk(
    [P('p1', 'A', 1), P('p2', 'B', 1), P('p3', 'C', 1)],
    [R('a', '甲', 2, [], []), R('b', '乙', 2, [], []), R('c', '丙', 5, [], ['p1', 'p2', 'p3'])]
  )
  const base = solveAssignment(d)
  console.log('用例11 缺席导致纯组合性瓶颈')
  check('基线可行', base.feasible, JSON.stringify(base.feasible ? '' : base.reasons))
  const out = runStressTest(d)
  if (out.runnable) {
    check('汇总：丙缺席仍可分配，甲乙缺席不可分配', out.report.feasibleCount === 1 && out.report.infeasibleCount === 2)
    const a = out.report.scenarios.find((s) => s.reviewerId === 'a')
    check('甲缺席不可行', !!a && !a.feasible)
    check('甲缺席：全局总容量仍够（globalDeficit=0）', a?.globalDeficit === 0, `got ${a?.globalDeficit}`)
    check('甲缺席：Hall 瓶颈缺口=1', a?.deficit === 1, `got ${a?.deficit}`)
    check('甲缺席：受影响稿件 3 篇且单篇缺口均为0（仅组合瓶颈）', a?.affectedPapers?.length === 3 && a.affectedPapers.every((p) => p.shortfall === 0 && p.available === 1), JSON.stringify(a?.affectedPapers))
    check('甲缺席：瓶颈评审人仅乙（冲突者丙排除、缺席者甲排除）', a?.bottleneckReviewers?.length === 1 && a.bottleneckReviewers[0].reviewerId === 'b' && a.bottleneckReviewers[0].capacityForGroup === 2)
  }
}

// 12. 单篇可分配人数不足型缺席：p1 仅甲可选；乙/丙缺席不影响 → 该数据同时是“有仍有不可”的混合场景
{
  const d = mk(
    [P('p1', 'A', 1), P('p2', 'B', 1)],
    [R('a', '甲', 1, [], []), R('b', '乙', 1, [], ['p1']), R('c', '丙', 5, [], ['p1'])]
  )
  console.log('用例12 单点缺席（p1 只有甲）')
  const out = runStressTest(d)
  if (out.runnable) {
    check('汇总：乙、丙缺席仍可分配（2），甲缺席不可分配（1）', out.report.feasibleCount === 2 && out.report.infeasibleCount === 1)
    const a = out.report.scenarios.find((s) => s.reviewerId === 'a')
    check('甲缺席不可行', !!a && !a.feasible)
    const p1 = a?.affectedPapers?.find((p) => p.paperId === 'p1')
    check('p1 剩余可选 0 人、单篇缺口 1', p1?.available === 0 && p1.shortfall === 1, JSON.stringify(p1))
    check('甲缺席：无可选评审人瓶颈（其余全部与 p1 冲突）', (a?.bottleneckReviewers?.length ?? 0) === 0)
  }
}

// 13. 全员冗余：任何人缺席都仍可分配
{
  const d = mk(
    [P('p1', 'A', 1), P('p2', 'B', 1)],
    [R('a', '甲', 2), R('b', '乙', 2), R('c', '丙', 2)]
  )
  console.log('用例13 全员冗余')
  const out = runStressTest(d)
  if (out.runnable) check('3 人缺席全部仍可分配', out.report.feasibleCount === 3 && out.report.infeasibleCount === 0)
}

// 14. 数据指纹：容量/冲突/需求等变化后指纹改变；无关顺序与展示名不影响
{
  const d1 = mk([P('p1', 'A', 2, ['x'])], [R('a', '甲', 2, ['X'], []), R('b', '乙', 1)])
  const f1 = stressFingerprint(d1)
  const d2: AppData = { papers: d1.papers, reviewers: [R('b', '乙', 1), R('a', '甲', 2, ['X'], [])] }
  console.log('用例14 数据指纹与过期判定')
  check('仅数组顺序变化指纹不变（归一化排序）', stressFingerprint(d2) === f1)
  const d3 = mk([P('p1', 'A', 2, ['x'])], [R('a', '甲', 3, ['X'], []), R('b', '乙', 1)])
  check('容量变化指纹改变（结果立即过期）', stressFingerprint(d3) !== f1)
  const d4 = mk([P('p1', 'A', 1, ['x'])], d1.reviewers)
  check('需求变化指纹改变', stressFingerprint(d4) !== f1)
  const d5 = mk(d1.papers, [R('a', '甲', 2, ['X'], ['p1']), R('b', '乙', 1)])
  check('冲突变化指纹改变', stressFingerprint(d5) !== f1)
}

// 15. 压力测试不改变录入数据（缺席模拟用副本）
{
  const d = mk([P('p1', 'A', 1)], [R('a', '甲', 1), R('b', '乙', 1)])
  const snapshot = JSON.stringify(d)
  runStressTest(d)
  console.log('用例15 不修改录入数据')
  check('运行后输入数据引用内容不变', JSON.stringify(d) === snapshot)
  check('评审人容量仍为原值', d.reviewers.every((r) => r.capacity >= 1))
}

// 16. 基线含容量 0 的评审人：不参与受测；缺席诊断中“剩余可选人数”也不计入他们
{
  const d = mk(
    [P('p1', 'A', 1), P('p2', 'B', 1)],
    [R('a', '甲', 1), R('b', '乙', 1), R('z', '容量为零者', 0)]
  )
  const out = runStressTest(d)
  console.log('用例16 容量0评审人')
  if (out.runnable) {
    check('仅受测 2 人（容量0者不参与）', out.report.testedReviewerCount === 2)
    const a = out.report.scenarios.find((s) => s.reviewerId === 'a')
    check('甲缺席不可行', !!a && !a.feasible)
    const p1 = a?.affectedPapers?.find((p) => p.paperId === 'p1')
    // z 容量为 0 不能承担名额；p1 缺席甲后只有乙可选（available=1，需求1，不缺），真正缺口在 Hall 组层面
    check('p1 剩余可选计数不含容量0者（=1）', p1?.available === 1, JSON.stringify(p1))
  }
}

/* ============================ 分派互换 ============================ */

/** 构造一条分派条目（匹配标签按数据现算） */
const item = (d: AppData, reviewerId: string, paperId: string): AssignmentItem => {
  const p = d.papers.find((x) => x.id === paperId)!
  const r = d.reviewers.find((x) => x.id === reviewerId)!
  const tags = matchedTagsOf(p, r)
  return { paperId, reviewerId, topicMatched: tags.length > 0, matchedTags: tags }
}

/** 由显式分派对构造成功结果（模拟引擎输出） */
const buildResult = (d: AppData, pairs: Array<[string, string]>, totalRequired: number): AssignmentSuccess =>
  buildSuccess(
    d.reviewers,
    pairs.map(([rid, pid]) => item(d, rid, pid)),
    totalRequired
  )

/** 结果结构完整性：无重复对、每篇人数、个人容量、统计自洽、无冲突 */
function isSound(d: AppData, res: AssignmentSuccess): boolean {
  const seen = new Set<string>()
  for (const a of res.assignments) {
    const key = `${a.paperId}|${a.reviewerId}`
    if (seen.has(key)) return false
    seen.add(key)
    const rv = d.reviewers.find((r) => r.id === a.reviewerId)
    const pp = d.papers.find((p) => p.id === a.paperId)
    if (!rv || !pp || rv.conflictPaperIds.includes(pp.id)) return false
  }
  for (const p of d.papers) {
    if (res.assignments.filter((a) => a.paperId === p.id).length !== p.reviewsRequired) return false
  }
  for (const l of res.loads) {
    if (l.assigned !== res.assignments.filter((a) => a.reviewerId === l.reviewerId).length) return false
    if (l.assigned > l.capacity) return false
  }
  if (res.objective.totalAssigned !== res.assignments.length) return false
  if (res.objective.topicMatches !== res.assignments.filter((a) => a.topicMatched).length) return false
  if (res.objective.maxLoad !== Math.max(0, ...res.loads.map((l) => l.assigned))) return false
  return true
}

// 17. 枚举排除：同稿 / 交换后组合不变 / 利益冲突，均不进候选
{
  const d = mk(
    [P('p1', '稿1', 2, ['X']), P('p2', '稿2', 2, ['Y'])],
    [R('a', '甲', 2, ['X']), R('b', '乙', 2, ['Y']), R('c', '丙', 2, ['X'])]
  )
  // 显式分派：p1→甲、丙；p2→甲、乙（甲承担两篇）
  const res = buildResult(d, [['a', 'p1'], ['c', 'p1'], ['a', 'p2'], ['b', 'p2']], 4)
  console.log('用例17 互换枚举排除三类')
  const ac = enumerateSwaps(d, res, 'a', 'c')
  // (a,p1)⇄(c,p1)：同稿；(a,p2)⇄(c,p1)：甲已评 p1 → 交换后甲重复承担 p1（组合不变）
  const reasons = new Set(ac.exclusions.map((e) => e.reason))
  check('a⇄c 无可行候选', ac.candidates.length === 0)
  check('a⇄c 含 same-paper 与 unchanged-pair', reasons.has('same-paper') && reasons.has('unchanged-pair'), JSON.stringify([...reasons]))

  // 纯同稿：丙与甲都只评 p1
  const enAB = enumerateSwaps(d, res, 'c', 'b')
  // (c,p1)⇄(b,p2)：c 未评 p2、b 未评 p1、无冲突 → 合法候选（用于对照，枚举器确实工作）
  check('对照：丙⇄乙 存在 1 个合法候选', enAB.candidates.length === 1, JSON.stringify(enAB.candidates.map((x) => x.id)))

  // 冲突排除：p3 由甲、丁评审（各需…），乙与 p3 冲突且乙评 p4
  const d2 = mk(
    [P('p3', '稿3', 2, ['X']), P('p4', '稿4', 1)],
    [R('a2', '甲', 2), R('b2', '乙', 1, [], ['p3']), R('e2', '丁', 1)]
  )
  const res2 = buildResult(d2, [['a2', 'p3'], ['e2', 'p3'], ['b2', 'p4']], 3)
  const en = enumerateSwaps(d2, res2, 'b2', 'e2')
  check('乙(冲突p3)⇄丁：候选被 conflict 排除', en.candidates.length === 0 && en.exclusions.some((e) => e.reason === 'conflict'))
}

// 18. 可行互换：候选按 Δ 匹配排序；确认后更新结果、标记已人工调整、负载不变、录入不变
{
  // p1/p2/p3 都标 X；甲擅长 X（容量2），丙不擅长（容量2）。
  // 初始：甲评 p1、p3（两条均命中），丙评 p2（不命中）。
  // 甲⇄丙 的两个候选：甲换去 p2 仍命中 X，丙换来 p1/p3 不命中 → 两条 Δ 均为 0，按 paperA 稳定排序 p1 在前。
  const d = mk(
    [P('p1', '稿1', 1, ['X']), P('p2', '稿2', 1, ['X']), P('p3', '稿3', 1, ['X'])],
    [R('a', '甲', 2, ['X']), R('c', '丙', 2, [])]
  )
  const res = buildResult(d, [['a', 'p1'], ['a', 'p3'], ['c', 'p2']], 3)
  console.log('用例18 可行互换与人工调整标记')
  check('前置：结果结构自洽', isSound(d, res))
  const en = enumerateSwaps(d, res, 'a', 'c')
  check('a⇄c 有 2 个候选且 Δ=0 时 p1 排在前', en.candidates.length === 2 && en.candidates.every((c) => c.deltaMatches === 0) && en.candidates[0].paperA === 'p1')

  // Δ=+1 场景：p1 标 X、p2 无标签；甲擅长 X、丙不擅长。初始甲→p2(无)、丙→p1(无)。
  const d3 = mk(
    [P('q1', '稿q1', 1, ['X']), P('q2', '稿q2', 1)],
    [R('g', '甲', 1, ['X']), R('h', '丙', 1, [])]
  )
  const res3 = buildResult(d3, [['h', 'q1'], ['g', 'q2']], 2)
  check('前置：初始总匹配=0', res3.objective.topicMatches === 0)
  const en3 = enumerateSwaps(d3, res3, 'g', 'h')
  check('枚举 1 个候选且 Δ=+1', en3.candidates.length === 1 && en3.candidates[0].deltaMatches === 1)
  const snapshot = JSON.stringify(d3)
  const after = applySwap(d3, res3, en3.candidates[0])
  check('互换返回非空', after !== null)
  if (after) {
    check('互换后总匹配=1', after.objective.topicMatches === 1, `got ${after.objective.topicMatches}`)
    check('互换后分派为 甲→q1(命中)、丙→q2', !!after.assignments.find((x) => x.reviewerId === 'g' && x.paperId === 'q1' && x.topicMatched) && !!after.assignments.find((x) => x.reviewerId === 'h' && x.paperId === 'q2'))
    check('负载不变（各 1 篇，最大负载 1）', after.loads.every((l) => l.assigned === 1) && after.objective.maxLoad === 1)
    check('结果标记 manuallyAdjusted', after.manuallyAdjusted === true)
    check('审计轨迹 1 条，记录前后匹配 0→1', (after.adjustments?.length ?? 0) === 1 && after.adjustments![0].topicMatchesBefore === 0 && after.adjustments![0].topicMatchesAfter === 1)
    check('互换后结构自洽（人数/容量/无冲突/无重复）', isSound(d3, after))
    check('录入数据未被修改', JSON.stringify(d3) === snapshot)
  }
}

// 19. Δ 排序方向：Δ 高（匹配改善）的候选排在前，Δ 为负的排在后
{
  // 三篇各需1：p1 标 X（甲擅长），p2 无标签，p3 标 Z（丁擅长）。
  // 甲→p1(匹配)，丁→p3(匹配)，丙→p2(无)。构造甲⇄丙、丁⇄丙：
  //  (甲,p1)⇄(丙,p2): before 1+0=1; after 甲→p2(0)+丙→p1(0)=0 → Δ=-1
  // 这里再补一对 Δ=+1：乙不擅长任何标签，评 p1；甲评 p2(无)，互换 甲→p1 命中：
  const d = mk(
    [P('p1', '稿1', 1, ['X']), P('p2', '稿2', 1), P('p3', '稿3', 1, ['Z'])],
    [R('a', '甲', 2, ['X']), R('c', '丙', 1, ['Z']), R('b', '乙', 1, [])]
  )
  // 甲→p2(无)、丙→p3(命中Z)、乙→p1(无)
  const res = buildResult(d, [['a', 'p2'], ['c', 'p3'], ['b', 'p1']], 3)
  // 甲⇄乙：候选 (a,p2)⇄(b,p1)：after a→p1 命中, b→p2 无 → before 0+0=0, after 1+0=1 → Δ=+1
  const en = enumerateSwaps(d, res, 'a', 'b')
  check('甲⇄乙 唯一候选 Δ=+1 且排首位', en.candidates.length === 1 && en.candidates[0].deltaMatches === 1)
  // 甲⇄丙：(a,p2)⇄(c,p3)：a→p3 不命中, c→p2 不命中 → before 0+1=1 after 0 → Δ=-1
  const en2 = enumerateSwaps(d, res, 'a', 'c')
  check('甲⇄丙 唯一候选 Δ=-1', en2.candidates.length === 1 && en2.candidates[0].deltaMatches === -1)
  check('Δ 序列非增（+1 在前、-1 在后的相对次序由分组枚举保证）', en.candidates[0].deltaMatches > en2.candidates[0].deltaMatches)
  const after = applySwap(d, res, en2.candidates[0])
  check('Δ=-1 互换后仍结构自洽且已调整', after !== null && isSound(d, after) && after.manuallyAdjusted)
}

// 20. 互换后不会让同一评审人重复承担同一稿件（unchanged-pair 已在枚举拦截，applySwap 二次防御）
{
  const d = mk(
    [P('p1', '稿1', 2), P('p2', '稿2', 1)],
    [R('a', '甲', 2), R('b', '乙', 1), R('c', '丙', 1)]
  )
  // 甲评 p1,p2；乙评 p1；丙无任务。甲⇄乙的 (甲,p2)⇄(乙,p1)：乙已在 p1、甲已在 p2…
  // 实际 unchanged：乙已评 p1，若 (甲,p2)⇄(乙,p1) 则 乙→p2、甲→p1，但甲已评 p1 → unchanged-pair
  const res = buildResult(d, [['a', 'p1'], ['a', 'p2'], ['b', 'p1']], 3)
  const en = enumerateSwaps(d, res, 'a', 'b')
  const cond20 = en.candidates.length === 0 && en.exclusions.every((e) => e.reason === 'unchanged-pair' || e.reason === 'same-paper')
  check('重复承担场景无候选，全部 unchanged-pair/same-paper', cond20)
  // 无任务评审人不进入选择面：甲⇄丙 枚举为空（丙 0 篇）
  const en2 = enumerateSwaps(d, res, 'a', 'c')
  check('无任务评审人之间枚举为空', en2.candidates.length === 0 && en2.exclusions.length === 0)
  // 重新生成（solveAssignment）得到的结果默认未人工调整
  const fresh = solveAssignment(d)
  check('求解器产出结果未带人工调整标记', fresh.feasible && fresh.manuallyAdjusted === false && (fresh.adjustments?.length ?? 0) === 0)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
