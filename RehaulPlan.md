## 迁移计划：Next.js → Express + Vite + React Router（保留现有 CSS）

  ### Summary

  - 目标是把当前应用迁移为 单个 Express 服务 + Vite 前端构建 + React Router SPA，同时保持现有功能、
    URL、查询参数和主要 API 行为不变。
  - 本次迁移 不引入 Tailwind，保留现有 globals.css 和所有现有 class 命名，避免 UI 重写。
  - 运行时架构改为：Express 仅负责 API、静态资源和 SPA fallback；首页和 /comparison 都由浏览器端
    React Router 渲染。
  - /comparison 不再依赖服务端页面渲染；改为通过新增的 Express API 读取现有 comparison 逻辑结果，首页
    继续保留当前的客户端 refresh/polling 行为。

  ### Key Changes

  #### 1. Runtime / routing

  - 用 server/ 目录替代 Next runtime，新增一个 Express 入口：
      - 开发环境：Express 挂载 Vite middleware，单端口提供前端与 API。
      - 生产环境：Express 提供 Vite build 产物和 API，并对 /、/comparison 做 SPA fallback。
  - 前端改为 src/ 结构，使用 createBrowserRouter + RouterProvider。
  - 保留浏览器路由不变：
      - /
      - /comparison?startDate=...&endDate=...&city=...&selectedDate=...
  - 保留 comparison 查询参数语义不变；React Router 负责读取和更新 search params。

  #### 2. Frontend migration

  - WeatherDashboard 继续作为客户端组件使用，保留现有行为：
      - 首次进入自动 POST /api/weather/refresh
      - 轮询 /api/weather
      - 单卡片 refresh
      - 打开 /comparison 链接
  - ComparisonDashboard 继续复用现有 UI 和样式，但把 next/link 改为 react-router-dom 的 Link。
  - /comparison 页面改为路由 loader 驱动：
      - loader 从新的 comparison API 拉取页面所需完整数据
      - 路由 element 直接把 loader data 传给现有 ComparisonDashboard
  - layout.tsx / page.tsx / comparison/page.tsx / loading.tsx 的职责迁移到普通 React 路由、应用入口和
    必要的 loading UI；不再保留 Next App Router 文件约定。

  #### 3. Server / API

  - 现有 API 路径保持不变，Express 中继续提供：
      - GET /api/weather
      - POST /api/weather/refresh
      - GET /api/polymarket-links
  - 新增一个 聚合 comparison 页面数据接口，避免前端多次拼装：
      - GET /api/comparison
  - GET /api/comparison 的响应固定为：
      - startDate
      - endDate
      - city
      - selectedDate
      - report (ComparisonReport)
      - cityDetail (ComparisonCityReport | null)
      - dayDetail (ComparisonDayDetail | null)
      - earliestResolvedDate (string | null)
      - statusLabel (string)
  - 该接口直接复用当前 lib/comparison/* 与 lib/comparison/history-coverage.ts 的现有服务端逻辑；不改
    comparison 业务规则。
  - lib/refresh-weather.ts、lib/store.ts、lib/polymarket.ts、lib/comparison/*、scripts/* 保持为 Node/
    TS 业务层，尽量原样复用。

  #### 4. Tooling / build

  - 移除 Next 运行与配置依赖：
      - next
      - next.config.ts
      - scripts/run-next.mjs
      - Next 专用 ESLint/tsconfig 配置
  - 新增/切换到：
      - vite
      - @vitejs/plugin-react
      - react-router-dom
      - express
  - 保留 TypeScript；拆分客户端/服务端 tsconfig：
      - 前端 tsconfig 供 Vite 使用
      - 服务端 tsconfig 供 Express 构建使用
  - npm scripts 固定为：
      - dev: 启动单个 Express 进程，内部挂载 Vite middleware
      - build: 先 vite build，再编译 server TS
      - start: 启动编译后的 Express 服务
      - 保留 compare:weather-settlement / compare:backfill-history
  - 现有 app/globals.css 原样迁移到前端入口样式文件并全局引入；不做 Tailwind 转写。

  ### Test Plan

  - 路由与页面：
      - / 能正常加载，自动触发 refresh，卡片渲染与手动 refresh 行为不变
      - /comparison 在无 query、仅 city、完整 query 三种情况下行为与当前一致
      - /comparison 中城市切换、日期选择、回到首页链接都正常
  - API：
      - GET /api/weather、POST /api/weather/refresh、GET /api/polymarket-links 响应结构与当前一致
      - GET /api/comparison 返回完整 comparison 页面数据，且与当前 Next 页面计算结果一致
  - 数据行为：
      - comparison 仍只显示 resolved Polymarket 日期
      - day detail 仍读取单日原始 WU/AW 曲线点
      - earliest resolved date 提示保持一致
  - 工程检查：
      - npm run lint
      - npm run typecheck
      - npm run build
      - npm run start 后访问 / 和 /comparison smoke test

  ### Assumptions / defaults

  - 默认按 单个 Express 进程 设计生产部署；如果后续要前后端分离，再从该结构拆分。
  - 默认保持所有现有浏览器 URL 和 query 参数契约不变。
  - 默认保持首页“进入即 refresh”的现有功能，不在本次迁移中改产品行为。
  - 默认不引入 Tailwind、不重写 CSS，只做框架迁移。
  - comparison 前端采用 SPA + API，不保留服务端 HTML 渲染；这是本次资源占用最省、改动最小的默认实现。
