/**
 * 分派互换（一换一）引擎。
 *
 * 在一个**已成功生成、且相对录入数据未过期**的分配结果上，用户选取两位各自承担了稿件的
 * 评审人 A、B 后，枚举 A 的稿件 pA 与 B 的稿件 pB 之间所有“一换一”候选：
 *
 *   交换前分派：(A, pA)、(B, pB)
 *   交换后分派：(A, pB)、(B, pA)
 *
 * 排除项（不计入候选）：
 *   1. same-paper      —— pA === pB（交换发生在同一篇稿件内部，纯属同人换岗）；
 *   2. unchanged-pair  —— 交换后分派组合不变：A 已评审 pB 或 B 已评审 pA
 *                          （直接交换只会让稿件少一名评审人 / 评审人重复评审同一篇稿件）；
 *   3. conflict        —— A 与 pB、或 B 与 pA 存在利益冲突。
 *
 * 通过排除后，一换一天然保持：
 *   - 每篇稿件的评审人数不变（pA、pB 各走一人、各来一人，其余稿件不动）；
 *   - 每位评审人的承担稿件数（负载）不变；
 * 仍额外显式校验“同一评审人不重复承担同一稿件、人数与个人容量”，作为结果完整性的防御性检查。
 *
 * 候选按主题匹配数变化（Δ = 交换后匹配数 − 交换前匹配数）从高到低排序展示。
 * 确认后只替换结果中的两条分派并重算统计，绝不修改录入数据；结果标记为“已人工调整”。
 */

import { buildSuccess, hasConflict, matchedTagsOf } from './solver'
import type { AppData, AssignmentItem, AssignmentSuccess, SwapAdjustment } from '../types'

export type SwapExclusionReason = 'same-paper' | 'unchanged-pair' | 'conflict'

/** 一个通过全部校验、可直接确认的一换一候选（含交换前后预览） */
export interface SwapCandidate {
  id: string
  reviewerA: string
  reviewerB: string
  /** A 目前承担、将被换出的稿件 */
  paperA: string
  /** B 目前承担、将被换出的稿件 */
  paperB: string
  /** 交换前 A→pA 一条的命中标签 */
  beforeTagsA: string[]
  /** 交换前 B→pB 一条的命中标签 */
  beforeTagsB: string[]
  /** 交换后 A→pB 一条的命中标签 */
  afterTagsA: string[]
  /** 交换后 B→pA 一条的命中标签 */
  afterTagsB: string[]
  /** 两条新分派各自是否命中主题 */
  afterMatchedA: boolean
  afterMatchedB: boolean
  /** 交换前这两条分派中的主题匹配条数（0~2） */
  beforeMatches: number
  /** 交换后这两条分派中的主题匹配条数（0~2） */
  afterMatches: number
  /** afterMatches - beforeMatches：总主题匹配数变化 */
  deltaMatches: number
}

/** 被排除的原始配对及原因（供 UI 折叠展示“为什么没有这个选项”） */
export interface SwapExclusion {
  reviewerA: string
  reviewerB: string
  paperA: string
  paperB: string
  reason: SwapExclusionReason
}

export interface SwapEnumeration {
  candidates: SwapCandidate[]
  exclusions: SwapExclusion[]
}

const exclusionReasonLabel: Record<SwapExclusionReason, string> = {
  'same-paper': '同篇稿件（两人评审的是同一稿，互换不构成分派变化）',
  'unchanged-pair': '交换后组合不变（对方已承担该稿件，互换会导致少人/重复）',
  conflict: '交换后触发利益冲突'
}

export function swapExclusionLabel(reason: SwapExclusionReason): string {
  return exclusionReasonLabel[reason]
}

/** 找到某评审人对某稿件的当前分派条目（无则 undefined） */
function findAssignment(assignments: AssignmentItem[], reviewerId: string, paperId: string): AssignmentItem | undefined {
  return assignments.find((a) => a.reviewerId === reviewerId && a.paperId === paperId)
}

/**
 * 枚举两位评审人之间全部可行的一换一候选。
 * 要求两人均在当前结果中承担至少一篇稿件；调用方负责保证结果成功且未过期。
 */
export function enumerateSwaps(
  data: AppData,
  result: AssignmentSuccess,
  reviewerAId: string,
  reviewerBId: string
): SwapEnumeration {
  const paperMap = new Map(data.papers.map((p) => [p.id, p]))
  const reviewerMap = new Map(data.reviewers.map((r) => [r.id, r]))
  const reviewerA = reviewerMap.get(reviewerAId)
  const reviewerB = reviewerMap.get(reviewerBId)

  const candidates: SwapCandidate[] = []
  const exclusions: SwapExclusion[] = []
  if (!reviewerA || !reviewerB || reviewerAId === reviewerBId) return { candidates, exclusions }

  const papersOfA = result.assignments.filter((a) => a.reviewerId === reviewerAId)
  const papersOfB = result.assignments.filter((a) => a.reviewerId === reviewerBId)

  for (const itemA of papersOfA) {
    for (const itemB of papersOfB) {
      const paperA = paperMap.get(itemA.paperId)
      const paperB = paperMap.get(itemB.paperId)
      if (!paperA || !paperB) continue

      // 排除 1：同稿
      if (itemA.paperId === itemB.paperId) {
        exclusions.push({ reviewerA: reviewerAId, reviewerB: reviewerBId, paperA: itemA.paperId, paperB: itemB.paperId, reason: 'same-paper' })
        continue
      }
      // 排除 2：交换后组合不变（A 已评 pB 或 B 已评 pA → 互换会删条目 / 同一评审人重复承担同一稿件）
      if (findAssignment(result.assignments, reviewerAId, itemB.paperId) || findAssignment(result.assignments, reviewerBId, itemA.paperId)) {
        exclusions.push({ reviewerA: reviewerAId, reviewerB: reviewerBId, paperA: itemA.paperId, paperB: itemB.paperId, reason: 'unchanged-pair' })
        continue
      }
      // 排除 3：交换后触发利益冲突
      if (hasConflict(paperB, reviewerA) || hasConflict(paperA, reviewerB)) {
        exclusions.push({ reviewerA: reviewerAId, reviewerB: reviewerBId, paperA: itemA.paperId, paperB: itemB.paperId, reason: 'conflict' })
        continue
      }

      const beforeTagsA = itemA.matchedTags
      const beforeTagsB = itemB.matchedTags
      const afterTagsA = matchedTagsOf(paperB, reviewerA)
      const afterTagsB = matchedTagsOf(paperA, reviewerB)
      const beforeMatches = (itemA.topicMatched ? 1 : 0) + (itemB.topicMatched ? 1 : 0)
      const afterMatches = (afterTagsA.length > 0 ? 1 : 0) + (afterTagsB.length > 0 ? 1 : 0)

      candidates.push({
        id: `${reviewerAId}:${itemA.paperId}⇄${reviewerBId}:${itemB.paperId}`,
        reviewerA: reviewerAId,
        reviewerB: reviewerBId,
        paperA: itemA.paperId,
        paperB: itemB.paperId,
        beforeTagsA,
        beforeTagsB,
        afterTagsA,
        afterTagsB,
        afterMatchedA: afterTagsA.length > 0,
        afterMatchedB: afterTagsB.length > 0,
        beforeMatches,
        afterMatches,
        deltaMatches: afterMatches - beforeMatches
      })
    }
  }

  // 主题匹配变化从高到低；Δ 相同按确定次序（Δ 相同优先保持匹配更多的组合，再按 id），保证展示稳定
  candidates.sort(
    (x, y) =>
      y.deltaMatches - x.deltaMatches ||
      y.afterMatches - x.afterMatches ||
      x.paperA.localeCompare(y.paperA) ||
      x.paperB.localeCompare(y.paperB)
  )
  return { candidates, exclusions }
}

/**
 * 确认执行某个候选互换。
 *
 * 只在当前结果副本上替换 (A,pA)、(B,pB) 两条分派为 (A,pB)、(B,pA)，
 * 录入数据（data）只读不写；随后重算负载与目标统计并追加人工调整标记。
 * 若当前结果已不再满足候选前提（理论上不会发生），返回 null 由调用方忽略。
 */
export function applySwap(
  data: AppData,
  result: AssignmentSuccess,
  candidate: SwapCandidate
): AssignmentSuccess | null {
  const { reviewerA, reviewerB, paperA, paperB } = candidate
  if (reviewerA === reviewerB || paperA === paperB) return null

  const oldA = findAssignment(result.assignments, reviewerA, paperA)
  const oldB = findAssignment(result.assignments, reviewerB, paperB)
  if (!oldA || !oldB) return null

  // 防御性校验：交换后不得让同一评审人重复承担同一稿件
  if (findAssignment(result.assignments, reviewerA, paperB) || findAssignment(result.assignments, reviewerB, paperA)) {
    return null
  }

  const paperMap = new Map(data.papers.map((p) => [p.id, p]))
  const reviewerMap = new Map(data.reviewers.map((r) => [r.id, r]))
  const rvA = reviewerMap.get(reviewerA)
  const rvB = reviewerMap.get(reviewerB)
  const pa = paperMap.get(paperA)
  const pb = paperMap.get(paperB)
  if (!rvA || !rvB || !pa || !pb) return null

  // 防御性校验：利益冲突
  if (hasConflict(pb, rvA) || hasConflict(pa, rvB)) return null

  const tagsAtoB = matchedTagsOf(pb, rvA)
  const tagsBtoA = matchedTagsOf(pa, rvB)
  const newA: AssignmentItem = { paperId: paperB, reviewerId: reviewerA, topicMatched: tagsAtoB.length > 0, matchedTags: tagsAtoB }
  const newB: AssignmentItem = { paperId: paperA, reviewerId: reviewerB, topicMatched: tagsBtoA.length > 0, matchedTags: tagsBtoA }

  // 一换一：删两条、加两条，其余分派不动
  const assignments = result.assignments.filter((a) => a !== oldA && a !== oldB)
  assignments.push(newA, newB)

  // 防御性校验：交换后仍满足每篇人数与个人容量
  const perPaper = new Map<string, number>()
  const perReviewer = new Map<string, number>()
  for (const a of assignments) {
    perPaper.set(a.paperId, (perPaper.get(a.paperId) ?? 0) + 1)
    perReviewer.set(a.reviewerId, (perReviewer.get(a.reviewerId) ?? 0) + 1)
  }
  for (const p of data.papers) {
    if (p.reviewsRequired > 0 && (perPaper.get(p.id) ?? 0) !== p.reviewsRequired) return null
  }
  const capacityOf = new Map(result.loads.map((l) => [l.reviewerId, l.capacity]))
  for (const [rid, n] of perReviewer) {
    if (n > (capacityOf.get(rid) ?? 0)) return null
  }

  // 容量以当前结果负载表为准（录入数据可能在生成后被编辑，但本工具只在未过期时开放）
  const reviewersForRebuild = data.reviewers.map((r) => ({ ...r, capacity: capacityOf.get(r.id) ?? r.capacity }))
  // 先用既有审计轨迹重建，以取得交换后的主题匹配总数
  const probe = buildSuccess(reviewersForRebuild, assignments, result.objective.totalRequired, result.adjustments)

  const adjustment: SwapAdjustment = {
    at: new Date().toISOString(),
    removed: [
      { reviewerId: reviewerA, paperId: paperA },
      { reviewerId: reviewerB, paperId: paperB }
    ],
    added: [
      { reviewerId: reviewerA, paperId: paperB },
      { reviewerId: reviewerB, paperId: paperA }
    ],
    topicMatchesBefore: result.objective.topicMatches,
    topicMatchesAfter: probe.objective.topicMatches
  }
  return buildSuccess(reviewersForRebuild, assignments, result.objective.totalRequired, [
    ...(result.adjustments ?? []),
    adjustment
  ])
}
