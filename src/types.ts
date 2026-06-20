export type BillSource =
  | "assembly_member"
  | "assembly_government"
  | "government_pre_submit"
  | "government_notice";

export type BillStage =
  | "drafting"
  | "pre_announcement"
  | "submitted_to_assembly"
  | "committee_review"
  | "plenary_review"
  | "passed"
  | "rejected"
  | "withdrawn"
  | "promulgated"
  | "unknown";

export type AiSummaryStatus = "none" | "pending" | "done" | "failed";

export type BillEvent = {
  id: string;
  billId: string;
  eventType: string;
  eventLabel: string;
  eventDate?: string;
  sourceUrl?: string;
};

export type Bill = {
  id: string;
  externalId: string;
  assemblyBillNo?: string;
  governmentTrackingId?: string;
  source: BillSource;
  title: string;
  normalizedTitle: string;
  stage: BillStage;
  statusLabel: string;
  proposerName?: string;
  proposerType?: "member" | "government" | "committee" | "ministry" | "unknown";
  ministry?: string;
  committee?: string;
  proposedDate?: string;
  noticeStartDate?: string;
  noticeEndDate?: string;
  lastUpdatedAt?: string;
  officialUrl: string;
  originalTextUrl?: string;
  summarySourceUrl?: string;
  summarySourceLabel?: string;
  rawSummary?: string;
  aiSummary?: string;
  aiSummaryStatus: AiSummaryStatus;
  aiSummaryUpdatedAt?: string;
  needsReview?: boolean;
  events: BillEvent[];
  createdAt: string;
  updatedAt: string;
};

export type BillDataFile = {
  generatedAt: string;
  sourceNote: string;
  bills: Bill[];
};

export type IssueArticle = {
  title: string;
  url: string;
  outlet?: string;
  publishedAt?: string;
};

export type IssueNode = {
  id: string;
  label: string;
  summary?: string;
  children?: IssueNode[];
  articles?: IssueArticle[];
};

export type IssueMindmapFile = {
  serviceName: string;
  date: string;
  generatedAt: string;
  title: string;
  editorialPolicy: {
    excludedCategories: string[];
    selectionCriteria: string[];
  };
  root: IssueNode;
};

export type IssueArchiveEntry = {
  date: string;
  title: string;
  path: string;
};

export type IssueArchiveIndex = {
  latestDate: string;
  generatedAt: string;
  entries: IssueArchiveEntry[];
};
