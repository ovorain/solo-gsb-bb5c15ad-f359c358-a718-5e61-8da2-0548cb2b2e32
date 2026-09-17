# 盲审分配台 · Blind Review Desk

一款在 **浏览器本地** 完成稿件—评审人自动分配的 Web 应用。无需后端、无需注册，所有数据只保存在你自己的浏览器（localStorage）中，分配计算由 [javascript-lp-solver](https://www.npmjs.com/package/javascript-lp-solver) 以整数线性规划（ILP）在页面内完成。

技术栈：**React 18 + TypeScript + Vite + javascript-lp-solver**。

## 功能

- **录入稿件**：标题、所需评审人数、主题标签（可多个）。
- **录入评审人**：姓名、擅长标签、审稿容量（最多承担稿件数）、利益冲突（勾选需回避的稿件）。
- **一键生成**：先严格满足全部硬约束，再做目标优化。
  - 硬约束
    1. **利益冲突**：声明冲突的稿件—评审人对绝不分配；
    2. **容量**：每位评审人承担稿件数 ≤ 其容量；
    3. **人数**：每篇稿件恰好分配到所需数量的、互不相同的评审人。
  - 优化目标（字典序）
    1. **主题匹配最大化**：优先把稿件分给擅长标签命中的评审人；
    2. **负载均衡**：在此基础上最小化评审人的最大负载。
  - 可行性预检使用 Dinic 最大流；不可行时基于最小割给出**具体原因**：
    - 单篇稿件可分配评审人数不足（含缺口数）；
    - 全局容量不足（总名额缺口）；
    - 组合性瓶颈：哪一组稿件只能由哪几位评审人承担、缺口多少（Hall 条件违反的紧见证）。
- **结果展示**：每篇稿件的分配明细与主题匹配标记、评审人负载进度条、匹配/负载统计、本地求解耗时。
- **分派互换（人工微调）**：在「**分配结果**」页对**成功且未过期**的结果提供「🔀 分派互换」工具。
  - 选择两位**已有任务**的评审人后，枚举其当前承担稿件之间的全部**一换一**候选（A 的稿件 pA 与 B 的稿件 pB 互换）；
  - 自动**排除同稿配对**（两人评的是同一篇）以及**交换后组合不变**的配对（对方已承担该稿件，互换会导致稿件少人 / 同一评审人重复承担同一稿件）；
  - 仅保留交换后**不触发利益冲突、不会让同一评审人重复承担同一稿件、且每篇人数与个人容量仍满足**的候选（一换一天然保持各稿人数与各人负载不变，并另有防御性校验）；
  - 候选按**主题匹配数变化 Δ 从高到低**展示，每项可预览交换前后的**稿件、命中标签与总匹配数变化**，被排除配对亦可折叠查看原因；
  - 确认后**只更新当前结果、不改动任何录入数据**，负载统计即时重算保持正确，结果标记为「**已人工调整**」并记录互换审计轨迹；录入数据一旦变化导致结果过期，工具即锁定，重新生成分派后解锁（人工标记同时复位）。
- **评审人缺席压力测试**：在顶部「**缺席压力测试**」标签页进入。
  - 仅在**当前数据可生成可行方案**时可运行；对每位容量 > 0 的评审人分别模拟**完全缺席**（容量临时置 0），
    使用与生成分派**完全相同的硬约束可行性逻辑**（Dinic 最大流）重新判定，**不改变录入数据或当前分配**。
  - 结果按「**仍可分配 / 不可分配**」两组汇总；每个不可分配场景必须给出：
    - **缺席者**；
    - **受影响稿件**：广义 Hall 缺陷稿件组，逐稿列出需求、缺席后剩余可选评审人数、单篇缺口；
    - **名额缺口**：组合性瓶颈缺口（Hall 紧见证）与全局剩余容量缺口两个口径——即使总容量仍充足，也能识别“调不开”的组合性瓶颈；
    - **可选评审人瓶颈**：见证评审人集合及其容量、对受影响稿件组至多能承担的名额，而不是只报总容量不足。
  - 录入数据（标题 / 需求 / 标签 / 评审人容量 / 冲突）一旦变化，报告立即在标签页上标记**已过期**，重新运行后更新。
  - 支持**导出压力测试报告 JSON**。
- **数据持久化**：录入内容自动保存到 localStorage，刷新或关闭页面不丢失。
- **导出 JSON**：将分配结果（含稿件、评审人、匹配标签、负载与利用率）下载为 JSON 文件；压力测试报告亦可单独导出。
- 另附「载入示例」按钮，可快速体验。

## 一条命令启动（Docker Compose）

应用入口为页面顶部导航的四个标签页：**稿件**、**评审人 / 利益冲突**、**分配结果**、**缺席压力测试**。

```bash
docker compose up -d --build
```

启动后在浏览器访问：

> **http://localhost:8080**

停止：

```bash
docker compose down
```

> 如宿主机的 8080 端口被占用，修改 `docker-compose.yml` 中 `"8080:80"` 的左侧端口即可。

## 本地开发（不用 Docker）

要求 Node.js ≥ 18。

```bash
npm install
npm run dev        # 开发服务器，访问 http://localhost:5173
```

生产构建与本地预览：

```bash
npm run build      # 类型检查 + 打包到 dist/
npm run preview    # 预览生产构建，访问 http://localhost:4173
```

## 导出结果 JSON 结构

分配结果导出（`分配结果` 页 → 导出结果 JSON，文件名 `blind-review-assignment-*.json`）：

```jsonc
{
  "exportedAt": "2026-09-17T08:00:00.000Z",
  "manuallyAdjusted": false, // 是否经过“分派互换”人工调整
  "summary": {
    "topicMatches": 6,      // 命中主题匹配的分配条数
    "maxLoad": 2,           // 评审人最大负载
    "totalAssigned": 8,     // 已分配名额
    "totalRequired": 8      // 总需求名额
  },
  "assignments": [
    {
      "paperId": "paper_ml_001",
      "paperTitle": "面向大语言模型的高效微调方法",
      "reviewerId": "rev_bob",
      "reviewerName": "Bob（推荐/ML）",
      "topicMatched": true,
      "matchedTags": ["机器学习", "NLP"]
    }
  ],
  "reviewerLoads": [
    {
      "reviewerId": "rev_bob",
      "reviewerName": "Bob（推荐/ML）",
      "assigned": 2,
      "capacity": 2,
      "utilization": 1.0
    }
  ],
  "adjustments": [ // 已确认的一换一明细（未人工调整时为 []）
    {
      "at": "2026-09-17T08:05:00.000Z",
      "removed": [
        { "reviewerId": "rev_alice", "reviewerName": "Alice（机器学习）", "paperId": "paper_ml_002", "paperTitle": "图神经网络在推荐系统中的应用" },
        { "reviewerId": "rev_bob", "reviewerName": "Bob（推荐/ML）", "paperId": "paper_sec_001", "paperTitle": "联邦学习中的隐私泄露攻击与防御" }
      ],
      "added": [
        { "reviewerId": "rev_alice", "reviewerName": "Alice（机器学习）", "paperId": "paper_sec_001", "paperTitle": "联邦学习中的隐私泄露攻击与防御" },
        { "reviewerId": "rev_bob", "reviewerName": "Bob（推荐/ML）", "paperId": "paper_ml_002", "paperTitle": "图神经网络在推荐系统中的应用" }
      ],
      "topicMatchesBefore": 4,
      "topicMatchesAfter": 5
    }
  ]
}
```

压力测试报告导出（`缺席压力测试` 页 → 导出压力测试报告 JSON，文件名 `blind-review-absence-stress-*.json`）：

```jsonc
{
  "exportedAt": "2026-09-17T08:00:00.000Z",
  "kind": "reviewer-absence-stress-test",
  "summary": {
    "testedReviewerCount": 4,  // 受测评审人数（容量 > 0）
    "totalRequired": 8,
    "totalCapacity": 9,
    "feasibleCount": 0,        // 缺席后仍可分配的人数
    "infeasibleCount": 4       // 缺席后不可分配（单点风险）的人数
  },
  "scenarios": [
    {
      "reviewerId": "rev_carol",
      "reviewerName": "Carol（系统/数据库）",
      "capacity": 3,           // 被抽走的原容量
      "feasible": false,
      "message": "若 Carol（系统/数据库） 完全缺席，则无法生成可行分配。……",
      "deficit": 2,            // 组合性瓶颈名额缺口（Hall 紧见证）
      "globalDeficit": 2,      // 全局剩余容量缺口（为 0 时表示纯组合性瓶颈）
      "remainingCapacity": 6,
      "affectedPapers": [      // 受影响稿件
        { "paperId": "paper_ml_001", "paperTitle": "面向大语言模型的高效微调方法", "required": 2, "available": 3, "shortfall": 0 }
      ],
      "bottleneckReviewers": [ // 可选评审人瓶颈
        { "reviewerId": "rev_bob", "reviewerName": "Bob（推荐/ML）", "capacity": 2, "eligiblePaperCount": 4, "capacityForGroup": 2 }
      ]
    }
  ]
}
```

> 报告的“是否过期”由运行时录入数据指纹在页面对比判定（不写入额外文件）；数据变化后标签页会出现 ● 标记，重新运行即可刷新。

## 求解模型说明

对每个无冲突的（稿件 i，评审人 j）对设置 0/1 变量 `x[i][j]`：

- 约束：每篇稿件 `Σ_j x[i][j] = 需求_i`；每位评审人 `Σ_i x[i][j] ≤ 容量_j`；
- 冲突对不生成变量，因此天然不可能被分配；
- 目标采用**两阶段字典序优化**（避免直接引入 min-max 变量破坏全幺模性、拖慢整数分支）：
  1. **阶段一**：在真实容量下最大化 `Σ 命中主题的 x[i][j]`。该模型是带容量二部图匹配（b-匹配/运输问题），约束矩阵全幺模，LP 松弛的最优顶点解即为 0/1 整数解，求解器在根节点即可快速完成；
  2. **阶段二**：固定阶段一的最优匹配数不损失，对“评审人最大负载 L”做二分搜索（把所有评审人的容量上限临时改为 L 后重复阶段一），找到可行的最小 L，即实现负载均衡。

生成前先以 Dinic 最大流验证硬约束可行性：若不可行则不调用优化器，并通过最小割源侧集合定位瓶颈，给出可操作的修改提示。

**缺席压力测试**不重新做目标优化：它把某位评审人的容量在临时数据副本中置 0（原录入数据与当前分配均不变），再次执行同一套硬约束评估。不可行时同样利用最小割源侧可达稿件集合作为广义 Hall 缺陷见证，输出受影响稿件、名额缺口（`需求(Z) − Σ_j∈Y min(容量_j, |Z 中可评稿件数|)`，另附全局剩余容量缺口口径）与可选评审人瓶颈 Y。

## 目录结构

```
src/
  engine/
    maxflow.ts      # Dinic 最大流：硬约束可行性与瓶颈定位
    solver.ts       # 主流程 + ILP 建模（javascript-lp-solver）；导出可复用的 evaluateHardConstraints / matchedTagsOf / buildSuccess
    stress.ts       # 评审人缺席压力测试：逐位容量置 0 后复用硬约束判定，输出 Hall 瓶颈诊断与数据指纹
    swap.ts         # 分派互换：枚举一换一候选（排除同稿/组合不变/冲突）、按匹配变化排序、确认后只改结果并追加人工调整轨迹
  components/
    StressPanel.tsx # 缺席压力测试面板（运行 / 过期提示 / 汇总 / 逐场景明细 / 导出）
    SwapPanel.tsx   # 分派互换面板（选择两位有任务评审人 / 候选预览 / 确认）
    …               # 录入与结果展示组件
  types.ts          # 数据模型（含压力测试报告类型）
  storage.ts        # localStorage 持久化
  exporter.ts       # 分配结果 / 压力测试报告 JSON 导出
  sampleData.ts     # 示例数据
Dockerfile          # 多阶段构建：Node 构建 + nginx 静态托管
docker-compose.yml  # 一条命令启动（http://localhost:8080）
```
