"use client";

import { useMemo, useState } from "react";
import { BackgroundTask } from "@/lib/types";
import { StatusPill } from "@/components/ui";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";

export function TaskCenterFlyout({
  isOpen,
  onClose,
  tasks,
  onClearFinished,
  onRemoveTask,
  onRefresh,
}: {
  isOpen: boolean;
  onClose: () => void;
  tasks: BackgroundTask[];
  onClearFinished: () => void;
  onRemoveTask: (id: string) => void;
  onRefresh?: () => void;
}) {
  const [filterTab, setFilterTab] = useState<"all" | "running" | "failed" | "completed">("all");
  const [recovering, setRecovering] = useState(false);
  const toast = useToast();

  const runningCount = tasks.filter((t) => t.status === "running" || t.status === "pending").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;
  const completedCount = tasks.filter((t) => t.status === "succeeded").length;

  const filteredTasks = useMemo(() => {
    if (filterTab === "running") {
      return tasks.filter((t) => t.status === "running" || t.status === "pending");
    }
    if (filterTab === "failed") {
      return tasks.filter((t) => t.status === "failed");
    }
    if (filterTab === "completed") {
      return tasks.filter((t) => t.status === "succeeded");
    }
    return tasks;
  }, [filterTab, tasks]);

  if (!isOpen) return null;

  async function handleBatchRecovery() {
    setRecovering(true);
    try {
      await api.startSummaryRecovery();
      toast.showSuccess("已发起全部失败任务重试。");
      onRefresh?.();
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : "重试任务失败");
    } finally {
      setRecovering(false);
    }
  }
  return (
    <div className="task-flyout-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="task-flyout" onClick={(e) => e.stopPropagation()}>
        <div className="task-flyout-header">
          <div className="task-flyout-title-row">
            <span className="task-flyout-icon">⚡</span>
            <div>
              <h3>任务中心</h3>
              <p className="task-flyout-subtitle">
                {tasks.length > 0 ? `共 ${tasks.length} 项系统任务记录` : "暂无任务记录"}
              </p>
            </div>
          </div>
          <div className="task-flyout-actions">
            {onRefresh && (
              <button aria-label="刷新任务状态" className="icon-close-button" onClick={onRefresh} title="刷新任务" type="button">
                ↻
              </button>
            )}
            {completedCount > 0 && (
              <button className="text-link-button" onClick={onClearFinished} type="button">
                清理已完成
              </button>
            )}
            <button aria-label="关闭" className="icon-close-button" onClick={onClose} type="button">
              ✕
            </button>
          </div>
        </div>

        <div className="task-filter-tabs">
          <button
            className={`task-tab-btn${filterTab === "all" ? " active" : ""}`}
            onClick={() => setFilterTab("all")}
            type="button"
          >
            全部 ({tasks.length})
          </button>
          <button
            className={`task-tab-btn${filterTab === "running" ? " active" : ""}${runningCount > 0 ? " has-items warn" : ""}`}
            onClick={() => setFilterTab("running")}
            type="button"
          >
            进行中 ({runningCount})
          </button>
          <button
            className={`task-tab-btn${filterTab === "failed" ? " active" : ""}${failedCount > 0 ? " has-items danger" : ""}`}
            onClick={() => setFilterTab("failed")}
            type="button"
          >
            需关注 ({failedCount})
          </button>
          <button
            className={`task-tab-btn${filterTab === "completed" ? " active" : ""}`}
            onClick={() => setFilterTab("completed")}
            type="button"
          >
            已完成 ({completedCount})
          </button>
        </div>

        {failedCount > 0 && (
          <div className="task-recovery-alert-bar">
            <span>有 {failedCount} 个任务执行失败</span>
            <button
              className="task-recovery-action-btn"
              disabled={recovering}
              onClick={() => void handleBatchRecovery()}
              type="button"
            >
              {recovering ? "正在触发..." : "一键重试失败任务"}
            </button>
          </div>
        )}
        <div className="task-flyout-body">
          {filteredTasks.length === 0 ? (
            <div className="task-empty">
              <p className="task-empty-title">
                {filterTab === "running"
                  ? "当前没有运行中的任务"
                  : filterTab === "failed"
                    ? "暂无失败或异常任务"
                    : filterTab === "completed"
                      ? "暂无已完成任务"
                      : "暂无后台任务记录"}
              </p>
              <p className="task-empty-copy">
                系统每日摘要定时生成、历史消息回补与快速回顾的进度将在此处实时汇聚展示。
              </p>
            </div>
          ) : (
            <div className="task-list">
              {filteredTasks.map((task) => (
                <TaskCard key={task.id} onRemove={() => onRemoveTask(task.id)} task={task} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function TaskCard({ task, onRemove }: { task: BackgroundTask; onRemove: () => void }) {
  const isRunning = task.status === "running" || task.status === "pending";
  const kindLabel =
    {
      backfill: "历史回补",
      summary: "每日摘要",
      catchup: "快速回顾",
      digest: "每日总览",
    }[task.kind] || "后台任务";

  const tone = {
    running: "warn" as const,
    pending: "neutral" as const,
    succeeded: "good" as const,
    failed: "bad" as const,
  }[task.status];

  const statusLabel = {
    running: "运行中",
    pending: "排队中",
    succeeded: "已完成",
    failed: "失败",
  }[task.status];

  return (
    <div className={`task-card task-card-${task.status}`}>
      <div className="task-card-header">
        <div className="task-card-kind-row">
          <span className="task-kind-tag">{kindLabel}</span>
          <StatusPill tone={tone}>{statusLabel}</StatusPill>
        </div>
        {!isRunning && (
          <button aria-label="移除任务记录" className="task-remove-btn" onClick={(e) => { e.stopPropagation(); onRemove(); }} type="button">
            ✕
          </button>
        )}
      </div>

      <div className="task-card-title">{task.title}</div>

      {task.progress && (
        <div className="task-progress-box">
          <div className="task-progress-text">
            <span>已同步消息</span>
            <strong>{task.progress.current.toLocaleString()} 条</strong>
          </div>
          {isRunning && (
            <div className="task-progress-bar-track">
              <div className="task-progress-bar-indeterminate" />
            </div>
          )}
        </div>
      )}

      {task.errorMessage && (
        <div className="task-error-text" title={task.errorMessage}>
          {task.errorMessage}
        </div>
      )}

      <div className="task-card-footer">
        <span className="task-time">{formatTaskTime(task.startedAt)}</span>
      </div>
    </div>
  );
}

function formatTaskTime(val: string) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString("zh-CN", { hour12: false });
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}`;
}
