import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Database,
  Search
} from "lucide-react";
import { loadBillData } from "./data";
import { sourceLabels, stageLabels, stageOptions } from "./constants";
import type { Bill, BillDataFile, BillSource, BillStage } from "./types";
import { formatDate, getBillDate, getBillOwner, normalizeText } from "./utils";

type SortKey = "recent" | "noticeEnd" | "updated";
type CategoryKey = BillSource;
type ChartPoint = {
  label: string;
  start: Date;
  end: Date;
  assembly: number;
  government: number;
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
          <p className="eyebrow">공개 입법 정보 추적</p>
          <h1>Law Check</h1>
        </div>
        <div className="topbar-note">
          <Database size={18} />
          <span>{data ? `마지막 갱신 ${formatDate(data.generatedAt)}` : "데이터 확인 중"}</span>
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
        <MetaItem label="제안·제출 주체" value={getBillOwner(bill)} />
        <MetaItem label="소관부처" value={bill.ministry ?? "미확인"} />
        <MetaItem label="소관위원회" value={bill.committee ?? "미확인"} />
        <MetaItem label="제안일" value={formatDate(bill.proposedDate)} />
        <MetaItem label="입법예고 기간" value={formatNoticePeriod(bill)} />
        <MetaItem label="최근 갱신" value={formatDate(bill.updatedAt)} />
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
          {bill.events.map((event) => (
            <li key={event.id}>
              <time>{formatDate(event.eventDate)}</time>
              <span>{event.eventLabel}</span>
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

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "strong" | "warn" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function MetaItem({ label, value }: { label: string; value: string }) {
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
