import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Database,
  FileSearch,
  Filter,
  Gavel,
  Search
} from "lucide-react";
import { loadBillData } from "./data";
import { sourceLabels, sourceOptions, stageLabels, stageOptions } from "./constants";
import type { Bill, BillDataFile, BillSource, BillStage } from "./types";
import { formatDate, getBillDate, getBillOwner, normalizeText } from "./utils";

type SortKey = "recent" | "noticeEnd" | "updated";

function App() {
  const [data, setData] = useState<BillDataFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | BillSource>("all");
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
          (source === "all" || bill.source === source) &&
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
  }, [bills, query, sort, source, stage]);

  const selectedBill =
    filteredBills.find((bill) => bill.id === selectedBillId) ??
    filteredBills[0] ??
    null;

  useEffect(() => {
    if (filteredBills.length > 0 && selectedBillId && !filteredBills.some((bill) => bill.id === selectedBillId)) {
      setSelectedBillId(filteredBills[0].id);
    }
  }, [filteredBills, selectedBillId]);

  const stats = useMemo(() => {
    return {
      total: bills.length,
      notice: bills.filter((bill) => bill.stage === "pre_announcement").length,
      assembly: bills.filter((bill) => bill.source === "assembly_member" || bill.source === "assembly_government").length,
      aiSummary: bills.filter((bill) => bill.aiSummaryStatus === "done" && bill.aiSummary).length
    };
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

      <section className="stats-grid" aria-label="법률안 현황">
        <StatCard icon={<FileSearch />} label="수집된 항목" value={stats.total} />
        <StatCard icon={<CalendarDays />} label="입법예고" value={stats.notice} />
        <StatCard icon={<Gavel />} label="국회 단계" value={stats.assembly} />
        <StatCard icon={<BookOpen />} label="AI 요약" value={stats.aiSummary} />
      </section>

      <section className="workspace">
        <aside className="list-pane" aria-label="법률안 목록">
          <div className="filters">
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
                <Filter size={16} />
                <select value={source} onChange={(event) => setSource(event.target.value as "all" | BillSource)}>
                  <option value="all">전체 출처</option>
                  {sourceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

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
            </div>

            <div className="filter-row">
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

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <div>
        <strong>{value.toLocaleString("ko-KR")}</strong>
        <p>{label}</p>
      </div>
    </div>
  );
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
