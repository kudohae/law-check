import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Database,
  FileText,
  Network,
  Newspaper,
  Search
} from "lucide-react";
import { loadBillData, loadIssueArchiveIndex, loadIssueMindmap } from "./data";
import { sourceLabels, stageLabels, stageOptions } from "./constants";
import type {
  Bill,
  BillDataFile,
  BillSource,
  BillStage,
  IssueArchiveIndex,
  IssueMindmapFile,
  IssueNode
} from "./types";
import { formatDate, getBillDate, getBillOwner, normalizeText } from "./utils";

type SortKey = "recent" | "noticeEnd" | "updated";
type CategoryKey = BillSource;
type DetailMeta = {
  label: string;
  value: React.ReactNode;
};
type TimelineState = "done" | "current" | "upcoming";
type ProcedureStep = {
  key: string;
  label: string;
};
type ProcedureTimelineItem = ProcedureStep & {
  state: TimelineState;
  date?: string;
};
type ChartPoint = {
  label: string;
  start: Date;
  end: Date;
  assembly: number;
  government: number;
};
type AppSection = "issues" | "law";
type MindmapLayoutNode = {
  node: IssueNode;
  x: number;
  y: number;
  angle: number;
  depth: number;
  size: number;
  children: MindmapLayoutNode[];
};
type MindmapLink = {
  key: string;
  path: string;
  depth: number;
};

const categoryOptions: CategoryKey[] = [
  "assembly_member",
  "assembly_government",
  "government_notice",
  "government_pre_submit"
];

const categoryDescriptions: Record<CategoryKey, string> = {
  assembly_member: "국회의원이 국회에 제출한 법률안입니다.",
  assembly_government: "정부가 국회에 공식 제출한 법률안입니다.",
  government_notice: "정부가 국회 제출 전 국민 의견을 받는 단계입니다.",
  government_pre_submit: "정부 안에서 추진 중인 법령안의 진행 현황입니다."
};

function App() {
  const [section, setSection] = useState<AppSection>("issues");

  if (section === "law") {
    return <LawCheckSection onOpenIssues={() => setSection("issues")} />;
  }

  return <SeeseonHome onOpenLawCheck={() => setSection("law")} />;
}

function SeeseonHome({ onOpenLawCheck }: { onOpenLawCheck: () => void }) {
  const [archiveIndex, setArchiveIndex] = useState<IssueArchiveIndex | null>(null);
  const [mindmap, setMindmap] = useState<IssueMindmapFile | null>(null);
  const [selectedNode, setSelectedNode] = useState<IssueNode | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIssueArchiveIndex()
      .then((index) => {
        setArchiveIndex(index);
        const latest = index.entries.find((entry) => entry.date === index.latestDate) ?? index.entries[0];
        setActivePath(latest?.path ?? null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "시사 이슈 데이터를 불러오지 못했습니다.");
      });
  }, []);

  useEffect(() => {
    if (!activePath) return;
    setSelectedNode(null);
    loadIssueMindmap(activePath)
      .then(setMindmap)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "시사 이슈 마인드맵을 불러오지 못했습니다.");
      });
  }, [activePath]);

  return (
    <main className="app-shell seeseon-shell">
      <section className="seeseon-hero">
        <div className="brand-row">
          <div>
            <p className="eyebrow">시선(時線) / SEESEON</p>
            <h1>{mindmap?.title ?? "오늘의 시사 이슈 마인드맵"}</h1>
          </div>
          <nav className="section-switch" aria-label="서비스 카테고리">
            <button type="button" className="section-button active">
              <Network size={18} />
              시사 이슈
            </button>
            <button type="button" className="section-button" onClick={onOpenLawCheck}>
              <FileText size={18} />
              입법 정보
            </button>
          </nav>
        </div>

        <div className="hero-copy">
          <p>
            AI는 기사를 대신 판단하는 권위자가 아니라, 여러 공식 출처와 기사 흐름을 묶어 사건의 구조를 정리하는
            편집 보조 엔진으로 작동합니다.
          </p>
          <div className="policy-chips" aria-label="편집 원칙">
            <span>연예 제외</span>
            <span>스포츠 제외</span>
            <span>공공 영향 우선</span>
            <span>출처 교차 확인</span>
          </div>
        </div>
      </section>

      {error ? <section className="notice-band"><AlertCircle size={20} /><p>{error}</p></section> : null}

      <section className="mindmap-panel">
        <div className="mindmap-header">
          <div>
            <p className="section-label">오늘 18시 반영 기준</p>
            <h2>핵심 이슈 3개와 하위 쟁점</h2>
          </div>
          <div className="topbar-note">
            <CalendarDays size={18} />
            <span>{mindmap ? `생성 ${formatDate(mindmap.generatedAt)}` : "마인드맵 확인 중"}</span>
          </div>
        </div>

        {mindmap ? (
          <IssueMindmap root={mindmap.root} onSelectNode={setSelectedNode} />
        ) : (
          <div className="empty-state">마인드맵 데이터를 불러오는 중입니다.</div>
        )}
      </section>

      <section className="archive-panel">
        <button type="button" className="archive-toggle" onClick={() => setArchiveOpen((value) => !value)}>
          <span>
            <strong>과거 마인드맵</strong>
            <small>날짜를 펼칠 때 해당 JSON만 불러옵니다.</small>
          </span>
          <ChevronDown className={archiveOpen ? "rotated" : ""} size={20} />
        </button>

        {archiveOpen ? (
          <div className="archive-list">
            {archiveIndex?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={entry.path === activePath ? "archive-item active" : "archive-item"}
                onClick={() => setActivePath(entry.path)}
              >
                <span>{formatDate(entry.date)}</span>
                <strong>{entry.title}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <footer className="site-footer">
        <div>
          <strong>시선(時線)</strong>
          <p>뉴스를 새로 쓰지 않고, 공개된 흐름을 구조화해 보여주는 시사 이슈 플랫폼입니다.</p>
        </div>
        <nav aria-label="사이트 정책">
          <a href="/privacy.html">개인정보 처리방침</a>
          <a href="/contact.html">문의</a>
          <a href="/editorial-policy.html">편집 원칙</a>
        </nav>
      </footer>

      {selectedNode ? <IssueModal node={selectedNode} onClose={() => setSelectedNode(null)} /> : null}
    </main>
  );
}

function IssueMindmap({ root, onSelectNode }: { root: IssueNode; onSelectNode: (node: IssueNode) => void }) {
  const [isCompact, setIsCompact] = useState(() => (typeof window === "undefined" ? false : window.innerWidth < 700));
  const layout = useMemo(() => buildMindmapLayout(root, isCompact), [root, isCompact]);
  const links = collectMindmapLinks(layout);
  const nodes = collectMindmapNodes(layout);
  const width = isCompact ? 520 : 760;
  const height = isCompact ? 430 : 560;

  useEffect(() => {
    const update = () => setIsCompact(window.innerWidth < 700);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div className="mindmap-canvas-wrap">
      <svg className="mindmap-canvas" viewBox={`0 0 ${width} ${height}`} role="img">
        <title>시선 시사 이슈 마인드맵</title>
        <desc>오늘의 핵심 시사 이슈를 대분류와 하위 쟁점으로 나눈 트리입니다.</desc>
        <defs>
          <radialGradient id="mindmap-core-gradient" cx="50%" cy="45%" r="62%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="48%" stopColor="#dff7ef" />
            <stop offset="100%" stopColor="#102033" />
          </radialGradient>
          <filter id="mindmap-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={layout.x}
          cy={layout.y}
          r={isCompact ? 176 : 244}
          className="mindmap-orbit orbit-outer"
          style={{ transformOrigin: `${layout.x}px ${layout.y}px` }}
        />
        <circle
          cx={layout.x}
          cy={layout.y}
          r={isCompact ? 116 : 166}
          className="mindmap-orbit orbit-mid"
          style={{ transformOrigin: `${layout.x}px ${layout.y}px` }}
        />
        <circle
          cx={layout.x}
          cy={layout.y}
          r={isCompact ? 62 : 88}
          className="mindmap-orbit orbit-inner"
          style={{ transformOrigin: `${layout.x}px ${layout.y}px` }}
        />
        <circle
          cx={layout.x}
          cy={layout.y}
          r={isCompact ? 42 : 54}
          className="mindmap-core-glow"
          filter="url(#mindmap-soft-glow)"
        />
        {links.map((link) => (
          <path key={link.key} d={link.path} className={`mindmap-link depth-${link.depth}`} />
        ))}
        {nodes.map(({ node, x, y, angle, depth, size }) => {
          const isLeaf = !node.children || node.children.length === 0;
          return (
            <foreignObject
              key={node.id}
              x={x - size / 2}
              y={y - size / 2}
              width={size}
              height={size}
            >
              <div className="mindmap-node-box" style={{ width: size, height: size }}>
                <button
                  type="button"
                  className={`mindmap-node depth-${depth} ${isLeaf ? "leaf" : ""}`}
                  onClick={() => {
                    if (isLeaf) onSelectNode(node);
                  }}
                  disabled={!isLeaf}
                >
                  <span>{node.label}</span>
                  {isLeaf ? <small>기사 3건</small> : null}
                </button>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}

function IssueModal({ node, onClose }: { node: IssueNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article className="issue-modal" role="dialog" aria-modal="true" aria-labelledby="issue-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="section-label">핵심 뉴스 3건</p>
            <h2 id="issue-modal-title">{node.label}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        {node.summary ? <p className="modal-summary">{node.summary}</p> : null}
        <div className="article-list">
          {(node.articles ?? []).slice(0, 3).map((article) => (
            <a key={article.url} href={article.url} target="_blank" rel="noreferrer" className="article-link">
              <Newspaper size={18} />
              <span>
                <strong>{article.title}</strong>
                {article.outlet ? <small>{article.outlet}</small> : null}
              </span>
              <ArrowUpRight size={16} />
            </a>
          ))}
        </div>
      </article>
    </div>
  );
}

function buildMindmapLayout(root: IssueNode, isCompact = false): MindmapLayoutNode {
  const center = isCompact ? { x: 260, y: 215 } : { x: 380, y: 280 };
  const radiusByDepth = isCompact ? [0, 94, 168, 212] : [0, 136, 244, 312];
  const sizeByDepth = isCompact ? [102, 86, 76, 68] : [126, 106, 92, 82];
  const leaves = flattenLeaves(root);
  const leafAngles = new Map<string, number>();
  const start = -Math.PI * 0.82;
  const span = Math.PI * 1.64;

  leaves.forEach((leaf, index) => {
    const t = leaves.length <= 1 ? 0.5 : index / (leaves.length - 1);
    leafAngles.set(leaf.id, start + t * span);
  });

  const visit = (node: IssueNode, depth: number): MindmapLayoutNode => {
    const children = node.children?.map((child) => visit(child, depth + 1)) ?? [];
    const angle = children.length === 0
      ? leafAngles.get(node.id) ?? 0
      : circularMean(children.map((child) => child.angle));
    const radius = radiusByDepth[Math.min(depth, radiusByDepth.length - 1)] ?? 420;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius * 0.86;
    const size = sizeByDepth[Math.min(depth, sizeByDepth.length - 1)] ?? 98;

    return { node, x, y, angle, depth, size, children };
  };

  return visit(root, 0);
}

function flattenLeaves(node: IssueNode): IssueNode[] {
  if (!node.children || node.children.length === 0) return [node];
  return node.children.flatMap(flattenLeaves);
}

function circularMean(angles: number[]) {
  if (angles.length === 0) return 0;
  const x = angles.reduce((sum, angle) => sum + Math.cos(angle), 0);
  const y = angles.reduce((sum, angle) => sum + Math.sin(angle), 0);
  return Math.atan2(y, x);
}

function collectMindmapNodes(node: MindmapLayoutNode): MindmapLayoutNode[] {
  return [node, ...node.children.flatMap(collectMindmapNodes)];
}

function collectMindmapLinks(node: MindmapLayoutNode): MindmapLink[] {
  return node.children.flatMap((child) => {
    const startX = node.x + Math.cos(child.angle) * (node.size * 0.38);
    const startY = node.y + Math.sin(child.angle) * (node.size * 0.32);
    const endX = child.x - Math.cos(child.angle) * (child.size * 0.45);
    const endY = child.y - Math.sin(child.angle) * (child.size * 0.38);
    const controlRadius = 74 + child.depth * 24;
    const controlX = (startX + endX) / 2 + Math.cos(child.angle + Math.PI / 2) * controlRadius * 0.18;
    const controlY = (startY + endY) / 2 + Math.sin(child.angle + Math.PI / 2) * controlRadius * 0.18;
    return [
      {
        key: `${node.node.id}-${child.node.id}`,
        depth: child.depth,
        path: `M ${startX.toFixed(2)} ${startY.toFixed(2)} Q ${controlX.toFixed(2)} ${controlY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`
      },
      ...collectMindmapLinks(child)
    ];
  });
}

function LawCheckSection({ onOpenIssues }: { onOpenIssues: () => void }) {
  const [data, setData] = useState<BillDataFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryKey>("assembly_member");
  const [stage, setStage] = useState<"all" | BillStage>("all");
  const [sort, setSort] = useState<SortKey>("recent");

  useEffect(() => {
    loadBillData()
      .then((nextData) => {
        setData(nextData);
        setSelectedBillId(nextData.bills[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "데이터를 불러오지 못했습니다.");
      });
  }, []);

  const bills = data?.bills ?? [];

  const filteredBills = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    return bills
      .filter((bill) => {
        const queryTarget = normalizeText(
          [
            bill.title,
            bill.proposerName,
            bill.ministry,
            bill.committee,
            bill.statusLabel,
            bill.rawSummary
          ]
            .filter(Boolean)
            .join(" ")
        );

        return (
          (!normalizedQuery || queryTarget.includes(normalizedQuery)) &&
          bill.source === category &&
          (stage === "all" || bill.stage === stage)
        );
      })
      .sort((a, b) => {
        if (sort === "noticeEnd") {
          return dateValue(a.noticeEndDate, Number.MAX_SAFE_INTEGER) - dateValue(b.noticeEndDate, Number.MAX_SAFE_INTEGER);
        }
        if (sort === "updated") {
          return dateValue(b.updatedAt, 0) - dateValue(a.updatedAt, 0);
        }
        return dateValue(getBillDate(b), 0) - dateValue(getBillDate(a), 0);
      });
  }, [bills, category, query, sort, stage]);

  const selectedBill =
    filteredBills.find((bill) => bill.id === selectedBillId) ??
    filteredBills[0] ??
    null;

  useEffect(() => {
    if (filteredBills.length > 0 && selectedBillId && !filteredBills.some((bill) => bill.id === selectedBillId)) {
      setSelectedBillId(filteredBills[0].id);
    }
  }, [filteredBills, selectedBillId]);

  const chartPoints = useMemo(() => buildLegislationChartPoints(bills), [bills]);
  const categoryCounts = useMemo(() => {
    return categoryOptions.reduce<Record<CategoryKey, number>>((counts, option) => {
      counts[option] = bills.filter((bill) => bill.source === option).length;
      return counts;
    }, {
      assembly_member: 0,
      assembly_government: 0,
      government_notice: 0,
      government_pre_submit: 0
    });
  }, [bills]);

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">시선(時線) / 공개 입법 정보 추적</p>
          <h1>Law Check</h1>
        </div>
        <div className="law-top-actions">
          <nav className="section-switch" aria-label="서비스 카테고리">
            <button type="button" className="section-button" onClick={onOpenIssues}>
              <Network size={18} />
              시사 이슈
            </button>
            <button type="button" className="section-button active">
              <FileText size={18} />
              입법 정보
            </button>
          </nav>
          <div className="topbar-note">
            <Database size={18} />
            <span>{data ? `마지막 갱신 ${formatDate(data.generatedAt)}` : "데이터 확인 중"}</span>
          </div>
        </div>
      </section>

      <section className="notice-band">
        <AlertCircle size={20} />
        <p>
          이 사이트는 법률 자문을 제공하지 않습니다. 표시된 내용은 공개 데이터를 정리한 정보이며,
          중요한 판단에는 공식 원문을 확인해야 합니다. AI 요약은 비용을 쓰지 않기 위해 현재 비활성화되어 있습니다.
        </p>
      </section>

      <section className="ad-reserved" aria-label="광고 예정 영역">
        <span>광고 영역 예정</span>
        <p>현재 광고 코드는 없습니다. 나중에 수익화를 시작할 때 법률 정보와 분리해 표시합니다.</p>
      </section>

      <LegislationTrendChart points={chartPoints} />

      <section className="workspace">
        <aside className="list-pane" aria-label="법률안 목록">
          <div className="filters">
            <div className="category-tabs" aria-label="법률안 카테고리">
              {categoryOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={category === option ? "category-tab active" : "category-tab"}
                  onClick={() => {
                    setCategory(option);
                    setSelectedBillId(null);
                  }}
                >
                  <span className="category-tab-main">
                    <span>{sourceLabels[option]}</span>
                    <strong>{categoryCounts[option].toLocaleString("ko-KR")}</strong>
                  </span>
                  <small>{categoryDescriptions[option]}</small>
                </button>
              ))}
            </div>

            <label className="search-field">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="법률안명, 부처, 위원회 검색"
              />
            </label>

            <div className="filter-row">
              <label>
                <select value={stage} onChange={(event) => setStage(event.target.value as "all" | BillStage)}>
                  <option value="all">전체 단계</option>
                  {stageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                  <option value="recent">최신순</option>
                  <option value="noticeEnd">예고 종료 임박순</option>
                  <option value="updated">최근 갱신순</option>
                </select>
              </label>
            </div>
          </div>

          {error ? <div className="empty-state">{error}</div> : null}
          {!error && !data ? <div className="empty-state">데이터를 불러오는 중입니다.</div> : null}
          {data && filteredBills.length === 0 ? <div className="empty-state">조건에 맞는 법률안이 없습니다.</div> : null}

          <div className="bill-list">
            {filteredBills.map((bill) => (
              <button
                key={bill.id}
                className={bill.id === selectedBill?.id ? "bill-item active" : "bill-item"}
                onClick={() => setSelectedBillId(bill.id)}
              >
                <span className="item-meta">
                  <Badge>{sourceLabels[bill.source]}</Badge>
                  <span>{formatDate(getBillDate(bill))}</span>
                </span>
                <strong>{bill.title}</strong>
                <span className="item-subline">
                  {getBillOwner(bill)} · {stageLabels[bill.stage]}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="detail-pane" aria-label="법률안 상세">
          {selectedBill ? <BillDetail bill={selectedBill} /> : <div className="empty-state">법률안을 선택하세요.</div>}
        </section>
      </section>

      <footer className="site-footer">
        <div>
          <strong>Law Check</strong>
          <p>공식 입법 정보를 보기 쉽게 정리하는 공개 정보 서비스입니다.</p>
        </div>
        <nav aria-label="사이트 정책">
          <a href="/privacy.html">개인정보 처리방침</a>
          <a href="/contact.html">문의</a>
          <a href="/editorial-policy.html">편집 원칙</a>
        </nav>
      </footer>
    </main>
  );
}

function BillDetail({ bill }: { bill: Bill }) {
  return (
    <article className="bill-detail">
      <div className="detail-header">
        <div>
          <div className="detail-badges">
            <Badge>{sourceLabels[bill.source]}</Badge>
            <Badge tone="strong">{stageLabels[bill.stage]}</Badge>
            {bill.needsReview ? <Badge tone="warn">매칭 검토 필요</Badge> : null}
          </div>
          <h2>{bill.title}</h2>
          <p>{bill.statusLabel}</p>
        </div>
        <a className="official-link" href={bill.officialUrl} target="_blank" rel="noreferrer">
          공식 원문
          <ArrowUpRight size={17} />
        </a>
      </div>

      <dl className="meta-grid">
        {buildDetailMetaItems(bill).map((item) => (
          <MetaItem key={item.label} label={item.label} value={item.value} />
        ))}
      </dl>

      <section className="summary-panel">
        <div>
          <p className="section-label">AI 요약</p>
          <h3>{bill.aiSummary ? "Gemini 요약" : "요약 대기"}</h3>
        </div>
        {bill.aiSummary ? (
          <div className="ai-summary-text">{renderSummaryLines(bill.aiSummary)}</div>
        ) : (
          <p>
            아직 저장된 AI 요약이 없습니다. API 키를 브라우저에 노출하지 않기 위해, 요약은 배포 전 작업에서 생성해
            데이터 파일에 저장합니다.
          </p>
        )}
        <span className="summary-status">
          상태: {summaryStatusLabel(bill.aiSummaryStatus)}
          {bill.aiSummaryUpdatedAt ? ` · ${formatDate(bill.aiSummaryUpdatedAt)}` : ""}
        </span>
      </section>

      {bill.rawSummary ? (
        <section className="content-section">
          <p className="section-label">공식 데이터 요지</p>
          <p>{bill.rawSummary}</p>
        </section>
      ) : null}

      <section className="content-section">
        <p className="section-label">진행 타임라인</p>
        <ol className="timeline">
          {buildProcedureTimeline(bill).map((item) => (
            <li key={item.key} className={`timeline-item ${item.state}`}>
              <span className="timeline-date">
                {item.state === "upcoming" ? "" : item.date ? formatDate(item.date) : "날짜 미확인"}
              </span>
              <span className="timeline-label">
                {item.label}
                {item.state === "current" ? <strong>현재</strong> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function LegislationTrendChart({ points }: { points: ChartPoint[] }) {
  const width = 960;
  const height = 270;
  const padding = { top: 24, right: 24, bottom: 40, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.assembly, point.government]));
  const assemblyTotal = points.reduce((sum, point) => sum + point.assembly, 0);
  const governmentTotal = points.reduce((sum, point) => sum + point.government, 0);
  const yTicks = buildYTicks(maxValue);
  const startLabel = points[0]?.start ? formatMonthDay(points[0].start) : "";
  const endLabel = points[points.length - 1]?.end ? formatMonthDay(points[points.length - 1].end) : "";

  const x = (index: number) => {
    if (points.length <= 1) return padding.left;
    return padding.left + (index / (points.length - 1)) * plotWidth;
  };
  const y = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
  const assemblyPath = buildLinePath(points.map((point, index) => [x(index), y(point.assembly)]));
  const governmentPath = buildLinePath(points.map((point, index) => [x(index), y(point.government)]));

  return (
    <section className="trend-panel" aria-label="최근 1년 법안 발의 추이">
      <div className="trend-header">
        <div>
          <p className="section-label">최근 1년 법안 수</p>
          <h2>국회와 정부의 법안 발의 추이</h2>
        </div>
        <div className="trend-legend">
          <span className="legend-item assembly">국회가 발의한 법안 {assemblyTotal.toLocaleString("ko-KR")}건</span>
          <span className="legend-item government">정부가 발의한 법안 {governmentTotal.toLocaleString("ko-KR")}건</span>
        </div>
      </div>
      <div className="trend-chart-wrap">
        <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <title>최근 1년 국회와 정부의 법안 발의 수 선형 그래프</title>
          <desc>가로축은 1년 전부터 오늘까지, 세로축은 주 단위 법안 수입니다.</desc>
          <rect x="0" y="0" width={width} height={height} rx="8" className="chart-bg" />
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(tick)}
                y2={y(tick)}
                className="chart-grid"
              />
              <text x={padding.left - 12} y={y(tick) + 4} textAnchor="end" className="chart-tick">
                {tick}
              </text>
            </g>
          ))}
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + plotHeight}
            y2={padding.top + plotHeight}
            className="chart-axis"
          />
          <line
            x1={padding.left}
            x2={padding.left}
            y1={padding.top}
            y2={padding.top + plotHeight}
            className="chart-axis"
          />
          <path d={assemblyPath} className="chart-line assembly" />
          <path d={governmentPath} className="chart-line government" />
          {points.map((point, index) => (
            <g key={point.label}>
              {point.assembly > 0 ? <circle cx={x(index)} cy={y(point.assembly)} r="3" className="chart-dot assembly" /> : null}
              {point.government > 0 ? <circle cx={x(index)} cy={y(point.government)} r="3" className="chart-dot government" /> : null}
            </g>
          ))}
          <text x={padding.left} y={height - 12} className="chart-axis-label">
            {startLabel}
          </text>
          <text x={width - padding.right} y={height - 12} textAnchor="end" className="chart-axis-label">
            {endLabel}
          </text>
          <text x={padding.left} y={16} className="chart-axis-label">
            주간 법안 수
          </text>
        </svg>
      </div>
      <p className="trend-note">
        국회는 국회의원 발의안의 제안일, 정부는 정부입법예고 시작일과 정부 제출안의 제안일을 기준으로 집계합니다.
        날짜가 없는 항목은 그래프에서 제외합니다.
      </p>
    </section>
  );
}

function buildLegislationChartPoints(bills: Bill[]): ChartPoint[] {
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);

  const points: ChartPoint[] = [];
  for (let cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 7)) {
    const bucketStart = new Date(cursor);
    const bucketEnd = new Date(cursor);
    bucketEnd.setDate(bucketEnd.getDate() + 6);
    if (bucketEnd > today) bucketEnd.setTime(today.getTime());
    points.push({
      label: `${bucketStart.toISOString().slice(0, 10)}-${bucketEnd.toISOString().slice(0, 10)}`,
      start: bucketStart,
      end: bucketEnd,
      assembly: 0,
      government: 0
    });
  }

  for (const bill of bills) {
    const date = getLegislationDate(bill);
    if (!date || date < start || date > today) continue;
    const index = Math.min(points.length - 1, Math.floor((date.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    if (isAssemblyBill(bill)) {
      points[index].assembly += 1;
    } else if (isGovernmentBill(bill)) {
      points[index].government += 1;
    }
  }

  return points;
}

function getLegislationDate(bill: Bill) {
  const rawDate = isAssemblyBill(bill) || bill.source === "assembly_government"
    ? bill.proposedDate
    : bill.noticeStartDate;
  if (!rawDate) return null;
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function isAssemblyBill(bill: Bill) {
  return bill.source === "assembly_member";
}

function isGovernmentBill(bill: Bill) {
  return bill.source === "government_notice" || bill.source === "assembly_government";
}

function buildLinePath(points: number[][]) {
  if (points.length === 0) return "";
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

function buildYTicks(maxValue: number) {
  const step = Math.max(1, Math.ceil(maxValue / 4));
  const ticks = [];
  for (let value = 0; value <= maxValue; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== maxValue) ticks.push(maxValue);
  return ticks;
}

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function formatMonthDay(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function buildDetailMetaItems(bill: Bill): DetailMeta[] {
  const items: DetailMeta[] = [];
  const add = (label: string, value?: React.ReactNode) => {
    if (value === undefined || value === null || value === "") return;
    items.push({ label, value });
  };
  const addDate = (label: string, value?: string) => {
    if (!value) return;
    add(label, formatDate(value));
  };

  if (bill.source === "assembly_member") {
    add("의안 번호", bill.assemblyBillNo ?? bill.externalId);
    add("제안 주체", bill.proposerName);
    add("소관위원회", bill.committee);
    add("관련 부처", bill.ministry);
    addDate("제안일", bill.proposedDate);
    add("현재 상태", bill.statusLabel);
    addDate("상태 변경일", latestEventDate(bill) ?? bill.lastUpdatedAt ?? bill.updatedAt);
    return items;
  }

  if (bill.source === "assembly_government") {
    add("의안 번호", bill.assemblyBillNo ?? bill.externalId);
    add("정부입법 관리번호", bill.governmentTrackingId);
    add("제출 주체", bill.proposerName ?? "대한민국 정부");
    add("소관부처", bill.ministry);
    add("소관위원회", bill.committee);
    addDate("제출일", bill.proposedDate);
    add("국회 진행 상태", bill.statusLabel);
    addDate("최근 갱신일", latestEventDate(bill) ?? bill.lastUpdatedAt ?? bill.updatedAt);
    return items;
  }

  if (bill.source === "government_notice") {
    add("공고 번호", bill.externalId);
    add("주관 행정기관", bill.ministry ?? bill.proposerName);
    add("법령 종류", readRawSummaryValue(bill, "법령종류"));
    addDate("공고일", bill.noticeStartDate);
    add("입법예고 기간", formatNoticePeriod(bill));
    addDate("예고 종료일", bill.noticeEndDate);
    add("의견제출", <a href={bill.officialUrl} target="_blank" rel="noreferrer">국민참여입법센터에서 보기</a>);
    addDate("최근 갱신일", bill.lastUpdatedAt ?? bill.updatedAt);
    return items;
  }

  add("관리 번호", bill.externalId);
  add("소관부처", bill.ministry ?? bill.proposerName);
  add("진행 단계", bill.statusLabel);
  add("법령 종류", readRawSummaryValue(bill, "법령종류"));
  add("제·개정구분", readRawSummaryValue(bill, "제·개정구분"));
  addDate("최근 갱신일", latestEventDate(bill) ?? bill.lastUpdatedAt ?? bill.updatedAt);
  return items;
}

function latestEventDate(bill: Bill) {
  return bill.events
    .map((event) => event.eventDate)
    .filter((value): value is string => Boolean(value))
    .at(-1);
}

function readRawSummaryValue(bill: Bill, label: string) {
  const part = bill.rawSummary
    ?.split("/")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${label}:`));
  return part?.replace(`${label}:`, "").trim();
}

const assemblyProcedure: ProcedureStep[] = [
  { key: "received", label: "접수" },
  { key: "referred", label: "회부" },
  { key: "committee-agenda", label: "상정" },
  { key: "subcommittee", label: "소위심사" },
  { key: "committee-passed", label: "위원회 의결" },
  { key: "legislation-judiciary", label: "법사위 체계·자구 심사" },
  { key: "plenary", label: "본회의 심의·의결" },
  { key: "sent-government", label: "정부 이송" },
  { key: "promulgated", label: "공포" }
];

const governmentNoticeProcedure: ProcedureStep[] = [
  { key: "notice-open", label: "예고 진행 중" },
  { key: "notice-closed", label: "예고 종료" },
  { key: "next-process", label: "후속 절차 진행 중" },
  { key: "promulgated", label: "공포 완료" }
];

const governmentProgressProcedure: ProcedureStep[] = [
  { key: "drafting", label: "입안" },
  { key: "consultation", label: "관계기관 협의" },
  { key: "notice", label: "입법예고" },
  { key: "regulatory-review", label: "규제심사" },
  { key: "moleg-review", label: "법제처 심사" },
  { key: "vice-minister-meeting", label: "차관회의" },
  { key: "cabinet-meeting", label: "국무회의" },
  { key: "presidential-approval", label: "대통령 재가" },
  { key: "submitted-to-assembly", label: "국회 제출" },
  { key: "waiting-promulgation", label: "공포대기" },
  { key: "promulgated", label: "공포" }
];

function buildProcedureTimeline(bill: Bill): ProcedureTimelineItem[] {
  if (bill.source === "government_notice") {
    return buildTimelineItems(
      governmentNoticeProcedure,
      getGovernmentNoticeStepIndex(bill),
      getGovernmentNoticeDates(bill)
    );
  }

  if (bill.source === "government_pre_submit") {
    return buildTimelineItems(
      governmentProgressProcedure,
      getGovernmentProgressStepIndex(bill),
      getGovernmentProgressDates(bill)
    );
  }

  return buildTimelineItems(
    assemblyProcedure,
    getAssemblyStepIndex(bill),
    getAssemblyDates(bill)
  );
}

function buildTimelineItems(steps: ProcedureStep[], currentIndex: number, dates: Record<string, string | undefined>) {
  const boundedIndex = Math.max(0, Math.min(currentIndex, steps.length - 1));
  return steps.map((step, index) => ({
    ...step,
    state: index < boundedIndex ? "done" : index === boundedIndex ? "current" : "upcoming",
    date: dates[step.key]
  } satisfies ProcedureTimelineItem));
}

function getAssemblyStepIndex(bill: Bill) {
  const status = `${bill.statusLabel} ${bill.rawSummary ?? ""}`;
  if (/공포/.test(status)) return 8;
  if (/정부\s*이송|이송/.test(status)) return 7;
  if (/본회의|본회의의결/.test(status)) return 6;
  if (/법사|체계|자구/.test(status)) return 5;
  if (/위원회\s*(가결|의결)|소관위.*(가결|의결)/.test(status)) return 4;
  if (/소위|소위원회/.test(status)) return 3;
  if (/상정/.test(status)) return 2;
  if (/회부/.test(status)) return 1;
  return 0;
}

function getAssemblyDates(bill: Bill) {
  const firstDate = bill.proposedDate ?? latestEventDate(bill) ?? bill.lastUpdatedAt ?? bill.updatedAt;
  const currentStep = assemblyProcedure[getAssemblyStepIndex(bill)]?.key;
  return {
    received: firstDate,
    [currentStep]: latestEventDate(bill) ?? firstDate
  };
}

function getGovernmentNoticeStepIndex(bill: Bill) {
  if (/공포/.test(bill.statusLabel)) return 3;
  const endDate = parseDateValue(bill.noticeEndDate);
  if (endDate && endDate < startOfDay(new Date())) return 1;
  return 0;
}

function getGovernmentNoticeDates(bill: Bill) {
  const currentStep = governmentNoticeProcedure[getGovernmentNoticeStepIndex(bill)]?.key;
  return {
    "notice-open": bill.noticeStartDate,
    "notice-closed": bill.noticeEndDate,
    [currentStep]: currentStep === "notice-open" ? bill.noticeStartDate : bill.noticeEndDate ?? bill.lastUpdatedAt
  };
}

function getGovernmentProgressStepIndex(bill: Bill) {
  const status = bill.statusLabel;
  if (/공포$|공포완료/.test(status)) return 10;
  if (/공포대기/.test(status)) return 9;
  if (/국회|제출/.test(status)) return 8;
  if (/국무/.test(status)) return 6;
  if (/차관/.test(status)) return 5;
  if (/법제처/.test(status)) return 4;
  if (/규제/.test(status)) return 3;
  if (/입법예고/.test(status)) return 2;
  if (/협의/.test(status)) return 1;
  return 0;
}

function getGovernmentProgressDates(bill: Bill) {
  const currentStep = governmentProgressProcedure[getGovernmentProgressStepIndex(bill)]?.key;
  return {
    [currentStep]: latestEventDate(bill) ?? bill.lastUpdatedAt ?? bill.updatedAt
  };
}

function parseDateValue(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "strong" | "warn" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function MetaItem({ label, value }: DetailMeta) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function renderSummaryLines(summary: string) {
  return summary.split("\n").map((line) => (
    <p key={line}>
      {line.replace(/^[-*]\s*/, "")}
    </p>
  ));
}

function summaryStatusLabel(status: Bill["aiSummaryStatus"]) {
  if (status === "done") return "완료";
  if (status === "pending") return "대기";
  if (status === "failed") return "실패";
  return "없음";
}

function formatNoticePeriod(bill: Bill) {
  if (!bill.noticeStartDate && !bill.noticeEndDate) return "해당 없음";
  return `${formatDate(bill.noticeStartDate)} - ${formatDate(bill.noticeEndDate)}`;
}

function dateValue(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.getTime();
}

export default App;
