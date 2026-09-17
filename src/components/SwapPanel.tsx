import { useMemo, useState } from 'react'
import type { AppData, AssignmentSuccess } from '../types'
import { applySwap, enumerateSwaps, swapExclusionLabel } from '../engine/swap'

interface SwapPanelProps {
  data: AppData
  result: AssignmentSuccess
  /** 结果相对录入数据已过期：工具只读不可用，需重新生成分派 */
  stale: boolean
  onApplied: (next: AssignmentSuccess) => void
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta > 0) return <span className="badge badge-match">匹配 +{delta}</span>
  if (delta < 0) return <span className="badge badge-nomatch">匹配 {delta}</span>
  return <span className="badge badge-flat">匹配 ±0</span>
}

/** 交换一侧的稿件—命中标签小块 */
function SwapLeg({ title, tags, matched }: { title: string; tags: string[]; matched: boolean }) {
  return (
    <div className={`swap-leg ${matched ? 'is-match' : 'is-nomatch'}`}>
      <span className="swap-leg-paper" title={title}>
        《{title}》
      </span>
      {matched ? (
        <span className="badge badge-match">主题匹配</span>
      ) : (
        <span className="badge badge-nomatch">无直接匹配</span>
      )}
      {tags.length > 0 && (
        <div className="mini-tags">
          {tags.map((t) => (
            <span className="mini-tag mini-tag--green" key={t}>
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function SwapPanel({ data, result, stale, onApplied }: SwapPanelProps) {
  const [reviewerA, setReviewerA] = useState('')
  const [reviewerB, setReviewerB] = useState('')

  const paperMap = useMemo(() => new Map(data.papers.map((p) => [p.id, p])), [data.papers])
  const reviewerMap = useMemo(() => new Map(data.reviewers.map((r) => [r.id, r])), [data.reviewers])
  const loadOf = useMemo(() => new Map(result.loads.map((l) => [l.reviewerId, l.assigned])), [result.loads])

  // 仅列出当前结果中“已有任务”的评审人
  const busyReviewers = useMemo(
    () =>
      data.reviewers
        .filter((r) => (loadOf.get(r.id) ?? 0) > 0)
        .map((r) => ({
          id: r.id,
          name: r.name,
          assigned: loadOf.get(r.id) ?? 0,
          paperTitles: result.assignments
            .filter((a) => a.reviewerId === r.id)
            .map((a) => paperMap.get(a.paperId)?.title ?? a.paperId)
        })),
    [data.reviewers, loadOf, result.assignments, paperMap]
  )

  const bothChosen = reviewerA !== '' && reviewerB !== '' && reviewerA !== reviewerB
  const enumeration = useMemo(
    () => (bothChosen ? enumerateSwaps(data, result, reviewerA, reviewerB) : { candidates: [], exclusions: [] }),
    // 每次确认互换后 result 引用变化，候选自动重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, result, reviewerA, reviewerB]
  )

  const confirm = (candidateId: string) => {
    const candidate = enumeration.candidates.find((c) => c.id === candidateId)
    if (!candidate) return
    const next = applySwap(data, result, candidate)
    if (next) onApplied(next)
  }

  const name = (id: string) => reviewerMap.get(id)?.name ?? id
  const paperTitle = (id: string) => paperMap.get(id)?.title ?? id

  return (
    <section className="card swap-panel">
      <div className="swap-panel-head">
        <h3 className="swap-panel-title">🔀 分派互换（一换一人工调整）</h3>
        <p className="muted">
          选择两位<strong>已有任务</strong>的评审人，枚举其稿件之间所有可行的一换一候选；仅展示交换后不触发利益冲突、
          同一评审人不重复承担同一稿件、且每篇人数与个人容量仍满足的项，按主题匹配变化从高到低排列。确认只调整当前结果，不改录入数据。
        </p>
      </div>

      {stale ? (
        <div className="swap-disabled">
          ⚠ 当前结果相对录入数据<strong>已过期</strong>，互换工具已锁定。请重新点击「▶ 生成分派」后再进行人工调整。
        </div>
      ) : (
        <>
          <div className="swap-pickers">
            <label className="swap-picker">
              <span className="field-label">评审人 A</span>
              <select className="input" value={reviewerA} onChange={(e) => setReviewerA(e.target.value)}>
                <option value="">请选择…</option>
                {busyReviewers.map((r) => (
                  <option key={r.id} value={r.id} title={`承担稿件：${r.paperTitles.join('、')}`}>
                    {r.name}（承担 {r.assigned} 篇）
                  </option>
                ))}
              </select>
            </label>
            <span className="swap-arrow">⇄</span>
            <label className="swap-picker">
              <span className="field-label">评审人 B</span>
              <select
                className="input"
                value={reviewerB}
                onChange={(e) => setReviewerB(e.target.value)}
                disabled={reviewerA === ''}
              >
                <option value="">请选择…</option>
                {busyReviewers
                  .filter((r) => r.id !== reviewerA)
                  .map((r) => (
                    <option key={r.id} value={r.id} title={`承担稿件：${r.paperTitles.join('、')}`}>
                      {r.name}（承担 {r.assigned} 篇）
                    </option>
                  ))}
              </select>
            </label>
            {(reviewerA !== '' || reviewerB !== '') && (
              <button
                className="btn btn-ghost swap-reset"
                onClick={() => {
                  setReviewerA('')
                  setReviewerB('')
                }}
              >
                重选
              </button>
            )}
          </div>

          {reviewerA !== '' && reviewerB !== '' && reviewerA === reviewerB && (
            <p className="swap-hint swap-hint--warn">请选择两位不同的评审人。</p>
          )}

          {bothChosen && (
            <>
              <div className="swap-summary">
                共 <strong>{enumeration.candidates.length}</strong> 个可行候选
                {enumeration.exclusions.length > 0 && (
                  <>
                    ，已排除 <strong>{enumeration.exclusions.length}</strong> 个
                  </>
                )}
                ；当前总主题匹配数 <strong>{result.objective.topicMatches}</strong>
                {result.manuallyAdjusted && <span className="swap-adjusted-chip">已人工调整 ×{result.adjustments?.length ?? 0}</span>}
              </div>

              {enumeration.candidates.length === 0 ? (
                <p className="swap-hint">这两位评审人之间没有可行的一换一候选（全部被排除或不构成互换）。</p>
              ) : (
                <div className="swap-candidate-list">
                  {enumeration.candidates.map((c) => (
                    <div className="card swap-candidate" key={c.id}>
                      <div className="swap-candidate-head">
                        <DeltaBadge delta={c.deltaMatches} />
                        <span className="muted">
                          {name(c.reviewerA)} ⇄ {name(c.reviewerB)}
                        </span>
                        <button className="btn btn-primary swap-confirm" onClick={() => confirm(c.id)}>
                          确认此项互换
                        </button>
                      </div>
                      <div className="swap-flow">
                        <div className="swap-flow-col">
                          <div className="swap-flow-label">交换前</div>
                          <SwapLeg title={paperTitle(c.paperA)} tags={c.beforeTagsA} matched={c.beforeTagsA.length > 0} />
                          <div className="swap-flow-by muted">— {name(c.reviewerA)}</div>
                          <SwapLeg title={paperTitle(c.paperB)} tags={c.beforeTagsB} matched={c.beforeTagsB.length > 0} />
                          <div className="swap-flow-by muted">— {name(c.reviewerB)}</div>
                        </div>
                        <span className="swap-flow-arrow">→</span>
                        <div className="swap-flow-col">
                          <div className="swap-flow-label">交换后</div>
                          <SwapLeg title={paperTitle(c.paperB)} tags={c.afterTagsA} matched={c.afterMatchedA} />
                          <div className="swap-flow-by muted">— {name(c.reviewerA)}</div>
                          <SwapLeg title={paperTitle(c.paperA)} tags={c.afterTagsB} matched={c.afterMatchedB} />
                          <div className="swap-flow-by muted">— {name(c.reviewerB)}</div>
                        </div>
                      </div>
                      <div className="swap-delta muted">
                        这两条分派的主题命中 {c.beforeMatches} → {c.afterMatches}；交换后全局总匹配数{' '}
                        {result.objective.topicMatches} → {result.objective.topicMatches + c.deltaMatches}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {enumeration.exclusions.length > 0 && (
                <details className="swap-excluded">
                  <summary>查看被排除的 {enumeration.exclusions.length} 个配对及原因</summary>
                  <ul>
                    {enumeration.exclusions.map((e, i) => (
                      <li key={i}>
                        {name(e.reviewerA)}《{paperTitle(e.paperA)}》 ⇄ {name(e.reviewerB)}《{paperTitle(e.paperB)}》
                        ：{swapExclusionLabel(e.reason)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
