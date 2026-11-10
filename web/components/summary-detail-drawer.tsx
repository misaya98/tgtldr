"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { Drawer } from "@/components/drawer";
import { EmptyState } from "@/components/dashboard-page";
import { SummaryMarkdown } from "@/components/summary-markdown";
import { Button, StatusPill } from "@/components/ui";
import { Chat, Summary, SummaryContextPreview } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { summaryModelLabel } from "@/lib/summary-model";
import { api } from "@/lib/api";
import { deliveryState, statusText, statusTone } from "@/components/summaries-panel-sections";

export function SummaryDetailDrawer({
  active,
  botReady,
  chatTitle,
  emptyDescription = "从列表中选择一条摘要后，这里会展示完整正文。",
  emptyTitle = "没有可查看的摘要",
  loading = false,
  onClose,
  onRerunSummary,
  onRetryDelivery,
  onGenerateNow,
  open,
  selectedChat,
  selectedSummary,
  summaryRetryLimit
}: {
  active: boolean;
  botReady: boolean;
  chatTitle: string;
  emptyDescription?: string;
  emptyTitle?: string;
  loading?: boolean;
  onClose: () => void;
  onOpenContext?: () => void;
  onRerunSummary: (summary: Summary) => Promise<void>;
  onRetryDelivery: (summary: Summary) => Promise<void>;
  onGenerateNow?: () => Promise<void>;
  open: boolean;
  selectedChat: Chat | null;
  selectedSummary: Summary | null;
  summaryRetryLimit: number;
}) {
  const { language } = useI18n();
  const [zenMode, setZenMode] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "md" | "text">("idle");
  const [generating, setGenerating] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextPreview, setContextPreview] = useState<SummaryContextPreview | null>(null);

  // Reset context and zen mode on summary change
  useEffect(() => {
    setContextOpen(false);
    setContextPreview(null);
  }, [selectedSummary?.id]);

  async function toggleContext() {
    if (contextOpen) {
      setContextOpen(false);
      return;
    }
    setContextOpen(true);
    if (!contextPreview && selectedSummary) {
      setContextLoading(true);
      try {
        const preview = await api.summaryContextPreview(selectedSummary.id);
        setContextPreview(preview);
      } catch {
        // ignore preview failure
      } finally {
        setContextLoading(false);
      }
    }
  }

  async function handleCopy(mode: "md" | "text") {
    if (!selectedSummary?.content) return;
    try {
      const text = mode === "md" ? selectedSummary.content : stripMarkdown(selectedSummary.content);
      await copyTextToClipboard(text);
      setCopyState(mode);
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      // ignore
    }
  }

  function handleExportMarkdown() {
    if (!selectedSummary?.content) return;
    const blob = new Blob([selectedSummary.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TGTLDR-${selectedSummary.summaryDate}-${chatTitle.replace(/\s+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleInPlaceGenerate() {
    if (!onGenerateNow || generating) return;
    setGenerating(true);
    try {
      await onGenerateNow();
    } finally {
      setGenerating(false);
    }
  }

  const selectedDelivery = selectedSummary
    ? deliveryState(selectedSummary, selectedChat, botReady)
    : null;

  return (
    <Drawer active={active} panelClassName={zenMode ? "drawer-zen-mode" : undefined} onClose={onClose} open={open}>
      {loading ? (
        <p className="muted">正在读取当天摘要…</p>
      ) : !selectedSummary ? (
        <div className="summary-empty-wrapper">
          <EmptyState
            description={emptyDescription}
            title={emptyTitle}
          />
          {onGenerateNow && (
            <div className="summary-empty-actions">
              <Button disabled={generating} onClick={() => void handleInPlaceGenerate()} variant="primary">
                {generating ? "正在生成摘要中..." : "立即为本日此话题生成摘要"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="summary-detail-stack">
          <div className="summary-detail-header">
            <div className="summary-detail-header-main">
              <h2>
                {chatTitle} · {selectedSummary.summaryDate}
              </h2>
              {selectedSummary.topicTitle && (
                <span className="summary-detail-topic-badge">#{selectedSummary.topicTitle}</span>
              )}
            </div>
            <div className="summary-header-tools">
              <button
                className={`tool-icon-btn${zenMode ? " active" : ""}`}
                onClick={() => setZenMode(!zenMode)}
                title={zenMode ? "退出沉浸模式" : "全屏沉浸阅读"}
                type="button"
              >
                {zenMode ? "⤓ 还原" : "⤢ 沉浸"}
              </button>
            </div>
          </div>

          {/* 证据链直跳入口 */}
          <div className="summary-evidence-banner">
            <Link
              className="summary-evidence-link"
              href={`/dashboard/chats/${selectedSummary.chatId}/messages?date=${selectedSummary.summaryDate}${
                selectedSummary.topicId ? `&topicId=${selectedSummary.topicId}` : ""
              }`}
              title="在聊天记录中查看对应原始上下文"
            >
              <span>🔍 查看当天原始会话与证据链</span>
              <span aria-hidden="true" className="arrow-icon">→</span>
            </Link>
          </div>

          <div className="summary-status-actions">
            <StatusPill tone={statusTone(selectedSummary.status)}>
              {statusText(selectedSummary.status)}
            </StatusPill>
            <StatusPill
              className={selectedDelivery?.detail ? "status-pill-hoverable" : undefined}
              title={selectedDelivery?.detail}
              tone={selectedDelivery?.tone ?? "neutral"}
            >
              {selectedDelivery?.label ?? "不发送"}
            </StatusPill>
            {selectedDelivery?.retryable ? (
              <button
                className="text-link-button summary-delivery-link"
                onClick={() => startTransition(() => void onRetryDelivery(selectedSummary))}
                type="button"
              >
                通过 Bot 发送
              </button>
            ) : null}

            {/* 核心高频动作 */}
            <div className="summary-action-buttons">
              <button
                className="summary-mini-btn"
                onClick={() => void handleCopy("md")}
                type="button"
                title="复制 Markdown 源代码"
              >
                {copyState === "md" ? "✓ 已复制 MD" : "复制 Markdown"}
              </button>
              <button
                className="summary-mini-btn"
                onClick={() => void handleCopy("text")}
                type="button"
                title="复制无标记纯文本"
              >
                {copyState === "text" ? "✓ 已复制纯文本" : "复制纯文本"}
              </button>
              <button
                className="summary-mini-btn"
                onClick={handleExportMarkdown}
                type="button"
                title="导出为 .md 文件"
              >
                导出 .md
              </button>
            </div>
          </div>

          <div className="summary-detail-meta">
            <p>
              {summaryModelLabel(selectedSummary, language)} · 消息 {selectedSummary.sourceMessageCount} 条 · 分块{" "}
              {selectedSummary.chunkCount}
            </p>
            <div className="summary-detail-meta-actions">
              <button className="text-link-button" onClick={() => void toggleContext()} type="button">
                {contextOpen ? "收起执行审计" : "查看执行审计与 Prompt"}
              </button>
              <button
                className="text-link-button"
                onClick={() => startTransition(() => void onRerunSummary(selectedSummary))}
                type="button"
              >
                重新生成
              </button>
            </div>
          </div>

          {/* 内联执行审计与 Prompt 折叠面板（消除抽屉叠抽屉） */}
          {contextOpen && (
            <div className="summary-inline-context-accordion">
              <div className="inline-context-head">
                <strong>执行审计与 Prompt 预览</strong>
                <button className="text-link-button" onClick={() => setContextOpen(false)} type="button">
                  收起
                </button>
              </div>
              {contextLoading ? (
                <p className="muted">正在读取 Prompt 上下文...</p>
              ) : contextPreview ? (
                <div className="summary-context-stack">
                  <CopyableContextBlock title="系统提示词 (System Prompt)" value={contextPreview.systemPrompt} />
                  {(contextPreview.chunks ?? []).map((chunk) => (
                    <CopyableContextBlock
                      key={chunk.index}
                      title={`分块 ${chunk.index + 1} (消息 ${chunk.messageCount} 条)`}
                      value={chunk.content}
                    />
                  ))}
                  {contextPreview.finalPrompt ? (
                    <CopyableContextBlock title="最终合并提示词" value={contextPreview.finalPrompt} />
                  ) : null}
                </div>
              ) : (
                <p className="muted">无法读取该摘要的 Prompt 预览记录。</p>
              )}
            </div>
          )}

          <SummaryContent summary={selectedSummary} summaryRetryLimit={summaryRetryLimit} />
        </div>
      )}
    </Drawer>
  );
}

function stripMarkdown(md: string) {
  return md
    .replace(/#+\s+/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/`{1,3}(.*?)`{1,3}/g, "$1")
    .replace(/>\s+/g, "")
    .trim();
}

function SummaryContent({
  summary,
  summaryRetryLimit,
}: {
  summary: Summary;
  summaryRetryLimit: number;
}) {
  if (summary.status === "failed") {
    return (
      <div className="summary-context-stack">
        <RetryStatus summary={summary} summaryRetryLimit={summaryRetryLimit} />
        <div>
          <p className="muted">服务器返回错误</p>
          <pre className="summary-context-block">{summary.errorMessage || ""}</pre>
        </div>
        {summary.errorContext ? (
          <CopyableContextBlock title="OpenAI 请求参数" value={summary.errorContext} />
        ) : null}
        {summary.errorSystemPrompt ? (
          <CopyableContextBlock title="System prompt" value={summary.errorSystemPrompt} />
        ) : null}
        {summary.errorUserPrompt ? (
          <CopyableContextBlock title="User prompt" value={summary.errorUserPrompt} />
        ) : null}
      </div>
    );
  }

  if (!summary.content) {
    return (
      <EmptyState
        description="这条摘要还没有正文，请稍后重试或重新生成。"
        title="还没有摘要内容"
      />
    );
  }

  return (
    <div className="summary-detail-content">
      <SummaryMarkdown content={summary.content} />
    </div>
  );
}

function RetryStatus({
  summary,
  summaryRetryLimit,
}: {
  summary: Summary;
  summaryRetryLimit: number;
}) {
  const retryCount = summary.retryCount || 0;
  const limitLabel =
    summaryRetryLimit > 0 ? `${retryCount} / ${summaryRetryLimit}` : `${retryCount} / 0`;
  let detail = "未安排自动重试。";
  if (summary.nextRetryAt) {
    detail = `下次自动重试：${formatRetryTime(summary.nextRetryAt)}`;
  } else if (summaryRetryLimit > 0 && retryCount >= summaryRetryLimit) {
    detail = "已达到自动重试上限。";
  } else if (summaryRetryLimit === 0) {
    detail = "自动重试已关闭。";
  }

  return (
    <div className="summary-retry-status">
      <p>已自动重试 {limitLabel}</p>
      <span>{detail}</span>
    </div>
  );
}

function formatRetryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function CopyableContextBlock({ title, value }: { title: string; value: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    try {
      await copyTextToClipboard(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <div className="summary-error-context-section">
      <div className="summary-error-context-head">
        <p className="muted">{title}</p>
        <button className="text-link-button" onClick={handleCopy} type="button">
          {copyButtonLabel(copyState)}
        </button>
      </div>
      <pre className="summary-context-block summary-error-context-block">{value}</pre>
    </div>
  );
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy command failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function copyButtonLabel(state: "idle" | "copied" | "failed") {
  if (state === "copied") {
    return "已复制";
  }
  if (state === "failed") {
    return "复制失败";
  }
  return "复制";
}
