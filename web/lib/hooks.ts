import useSWR, { mutate } from "swr";
import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import {
  AppSettings,
  BackgroundTask,
  Bootstrap,
  Chat,
  SummaryListResponse,
  SummarySearchFilters,
  SummaryStats,
} from "@/lib/types";
import { taskStore } from "@/lib/task-store";
import { onBootstrapRefresh } from "@/lib/bootstrap-sync";

export function useBootstrap() {
  const swr = useSWR<Bootstrap>("/api/bootstrap", () => api.bootstrap(), {
    revalidateOnFocus: false,
    dedupingInterval: 4000,
  });

  useEffect(() => {
    return onBootstrapRefresh(() => {
      void swr.mutate();
    });
  }, [swr]);

  return swr;
}

export function useChats(options?: { includeTopics?: boolean }) {
  const key = `/api/chats?includeTopics=${options?.includeTopics ? "true" : "false"}`;
  return useSWR<Chat[]>(key, () => api.listChats(options), {
    revalidateOnFocus: false,
    dedupingInterval: 4000,
  });
}

export function useSettings() {
  return useSWR<AppSettings>("/api/settings", () => api.settings(), {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });
}

export function useSummaryStats() {
  return useSWR<SummaryStats>("/api/summaries/stats", () => api.summaryStats(), {
    refreshInterval: 10000,
    revalidateOnFocus: false,
  });
}

export function useSummaries(filters?: SummarySearchFilters) {
  const key = filters ? `/api/summaries?${JSON.stringify(filters)}` : null;
  return useSWR<SummaryListResponse>(key, () => api.listSummaries(filters), {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
  });
}

export function useTasks() {
  const [localTasks, setLocalTasks] = useState<BackgroundTask[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    const unsubTasks = taskStore.subscribe((updated) => setLocalTasks(updated));
    const unsubDismissed = taskStore.subscribeDismissed((dismissed) => setDismissedIds(dismissed));
    return () => {
      unsubTasks();
      unsubDismissed();
    };
  }, []);

  const { data: serverTasks = [], mutate: refreshServerTasks } = useSWR<BackgroundTask[]>(
    "/api/system-tasks-aggregate",
    async () => {
      const items: BackgroundTask[] = [];
      try {
        const [statsRes, recoveryRes, catchUpsRes, summariesRes, digestsRes] = await Promise.allSettled([
          api.summaryStats(),
          api.summaryRecovery(),
          api.listCatchUps(1, 10),
          api.listSummaries({ pageSize: 15 }),
          api.listDailyDigests(1, 5),
        ]);

        if (statsRes.status === "fulfilled" && statsRes.value.processingCount > 0) {
          try {
            const processing = await api.listSummaries({ status: "processing", pageSize: 10 });
            for (const item of processing.items) {
              items.push({
                id: `summary-proc-${item.id}`,
                kind: "summary",
                title: `每日摘要生成中 · ${item.topicTitle ? `[#${item.topicTitle}] ` : ""}${item.summaryDate}`,
                status: item.status === "pending" ? "pending" : "running",
                startedAt: item.generatedAt || new Date().toISOString(),
              });
            }
          } catch {}
        }

        if (recoveryRes.status === "fulfilled" && recoveryRes.value.length > 0) {
          for (const rec of recoveryRes.value) {
            items.push({
              id: `recovery-${rec.kind}-${rec.id}`,
              kind: rec.kind === "summary" ? "summary" : "digest",
              title: `${rec.kind === "summary" ? "单群摘要失败待恢复" : "每日总览失败待恢复"} · ${rec.date}`,
              status: "failed",
              errorMessage: rec.error,
              startedAt: rec.date,
            });
          }
        }

        if (catchUpsRes.status === "fulfilled" && catchUpsRes.value.items) {
          for (const cu of catchUpsRes.value.items) {
            items.push({
              id: `catchup-${cu.id}`,
              kind: "catchup",
              title: `快速回顾 · ${cu.fromDate} 至 ${cu.toDate} (${cu.chatCount} 个群)`,
              status: cu.status,
              errorMessage: cu.errorMessage,
              startedAt: cu.createdAt,
            });
          }
        }

        if (digestsRes.status === "fulfilled" && digestsRes.value.items) {
          for (const dd of digestsRes.value.items) {
            items.push({
              id: `digest-${dd.id}`,
              kind: "digest",
              title: `每日总览 · ${dd.summaryDate} (${dd.participantCount} 个群)`,
              status: dd.status,
              errorMessage: dd.errorMessage,
              startedAt: dd.createdAt,
            });
          }
        }

        if (summariesRes.status === "fulfilled" && summariesRes.value.items) {
          for (const s of summariesRes.value.items) {
            const sid = `summary-${s.id}`;
            if (!items.some((it) => it.id === sid || it.id === `summary-proc-${s.id}`)) {
              items.push({
                id: sid,
                kind: "summary",
                title: `${s.topicTitle ? `[#${s.topicTitle}] ` : ""}${s.summaryDate} 每日摘要`,
                status: s.status,
                errorMessage: s.errorMessage,
                startedAt: s.generatedAt,
              });
            }
          }
        }
      } catch {}
      return items;
    },
    {
      refreshInterval: 6000,
      revalidateOnFocus: true,
      dedupingInterval: 2500,
    }
  );

  useEffect(() => {
    const hasRunning = localTasks.some((t) => t.status === "running" || t.status === "pending");
    if (!hasRunning) return;
    const interval = setInterval(async () => {
      for (const t of taskStore.getTasks()) {
        if (t.kind === "backfill" && (t.status === "running" || t.status === "pending")) {
          try {
            const backfill = await api.getHistoryBackfill(t.id);
            taskStore.updateTask(t.id, {
              status: backfill.status,
              progress: { current: backfill.importedCount, total: backfill.importedCount },
              errorMessage: backfill.errorMessage,
            });
          } catch {}
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [localTasks]);

  const tasks = useMemo(() => {
    const dismissed = new Set(dismissedIds);
    const list = localTasks.filter((t) => !dismissed.has(t.id));
    for (const st of serverTasks) {
      if (!dismissed.has(st.id) && !list.some((lt) => lt.id === st.id)) {
        list.push(st);
      }
    }
    return list.sort((a, b) => {
      const score = (s: string) => (s === "running" ? 3 : s === "pending" ? 2 : s === "failed" ? 1 : 0);
      const diff = score(b.status) - score(a.status);
      if (diff !== 0) return diff;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });
  }, [localTasks, serverTasks, dismissedIds]);

  const runningCount = tasks.filter((t) => t.status === "running" || t.status === "pending").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;

  return {
    tasks,
    runningCount,
    failedCount,
    refreshTasks: refreshServerTasks,
    clearFinished: () => {
      const finishedIds = tasks
        .filter((t) => t.status === "succeeded" || t.status === "failed")
        .map((t) => t.id);
      taskStore.clearFinished(finishedIds);
    },
    removeTask: (id: string) => {
      taskStore.dismissTask(id);
    },
  };
}

export function mutateChats() {
  void mutate((key) => typeof key === "string" && key.startsWith("/api/chats"));
}

export function mutateSummaries() {
  void mutate((key) => typeof key === "string" && (key.startsWith("/api/summaries") || key === "/api/summaries/stats"));
}
