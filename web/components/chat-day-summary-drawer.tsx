"use client";

import { useCallback, useEffect, useState } from "react";
import { SummaryDrawerPair } from "@/components/summary-drawer-pair";
import { api } from "@/lib/api";
import { Chat, Summary } from "@/lib/types";

export function ChatDaySummaryDrawer({
  chatId,
  chatTitle,
  date,
  topicId = 0,
  onClose,
  open,
}: {
  chatId: number;
  chatTitle: string;
  date: string;
  topicId?: number;
  onClose: () => void;
  open: boolean;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [botReady, setBotReady] = useState(false);
  const [summaryRetryLimit, setSummaryRetryLimit] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    const response = await api.listSummaries({
      chatId: String(chatId),
      topicId: topicId ? String(topicId) : undefined,
      dateFrom: date,
      dateTo: date,
      page: 1,
      pageSize: 1,
    });
    setSummary(response.items[0] || null);
  }, [chatId, date, topicId]);

  useEffect(() => {
    if (!open || !date) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSummary(null);
    void Promise.all([api.listChats(), api.settings(), loadSummary()]).then(([chats, settings]) => {
      if (cancelled) return;
      setChat(chats.find((item) => item.id === chatId) || null);
      setBotReady(
        settings.botEnabled
        && Boolean(settings.botToken?.trim())
        && Boolean(settings.botTargetChatId?.trim()),
      );
      setSummaryRetryLimit(settings.summaryRetryLimit ?? 4);
    }).catch((reason) => {
      if (!cancelled) setError(asMessage(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, date, loadSummary, open]);

  async function handleGenerateNow() {
    await api.runSummary(chatId, date, topicId || 0);
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await api.listSummaries({
          chatId: String(chatId),
          topicId: topicId ? String(topicId) : undefined,
          dateFrom: date,
          dateTo: date,
          page: 1,
          pageSize: 1,
        });
        if (res.items.length > 0) {
          setSummary(res.items[0]);
          if (res.items[0].status !== "pending" && res.items[0].status !== "running") {
            clearInterval(interval);
          }
        }
      } catch {
        // ignore
      }
      if (attempts >= 25) {
        clearInterval(interval);
      }
    }, 2000);
  }

  const emptyTitle = error ? "当天摘要加载失败" : "当天还没有摘要";
  const emptyDescription = error
    || "这个日期或当前话题尚未生成摘要，可直接在此处一键发起生成。";

  return (
    <SummaryDrawerPair
      botReady={botReady}
      chatTitle={summary ? chat?.title || chatTitle : chatTitle}
      emptyDescription={emptyDescription}
      emptyTitle={emptyTitle}
      loading={loading}
      onClose={onClose}
      onGenerateNow={handleGenerateNow}
      onRefresh={loadSummary}
      open={open}
      selectedChat={chat}
      selectedSummary={summary}
      summaryRetryLimit={summaryRetryLimit}
    />
  );
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : "服务器返回错误";
}
