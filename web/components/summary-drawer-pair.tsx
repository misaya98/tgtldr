"use client";

import { SummaryDetailDrawer } from "@/components/summary-detail-drawer";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { Chat, Summary } from "@/lib/types";

export function SummaryDrawerPair({
  botReady,
  chatTitle,
  emptyDescription,
  emptyTitle,
  loading = false,
  onClose,
  onRefresh,
  onGenerateNow,
  open,
  selectedChat,
  selectedSummary,
  summaryRetryLimit,
}: {
  botReady: boolean;
  chatTitle: string;
  emptyDescription?: string;
  emptyTitle?: string;
  loading?: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onGenerateNow?: () => Promise<void>;
  open: boolean;
  selectedChat: Chat | null;
  selectedSummary: Summary | null;
  summaryRetryLimit: number;
}) {
  const toast = useToast();

  async function retryDelivery(summary: Summary) {
    try {
      await api.retrySummaryDelivery(summary.id);
      toast.showSuccess("已提交通过 Bot 发送。");
      await onRefresh();
    } catch (error) {
      toast.showError(asMessage(error));
    }
  }

  async function rerunSummary(summary: Summary) {
    try {
      await api.runSummary(summary.chatId, summary.summaryDate);
      toast.showSuccess("已提交重新生成。");
      await onRefresh();
    } catch (error) {
      toast.showError(asMessage(error));
    }
  }

  return (
    <SummaryDetailDrawer
      active={true}
      botReady={botReady}
      chatTitle={chatTitle}
      emptyDescription={emptyDescription}
      emptyTitle={emptyTitle}
      loading={loading}
      onClose={onClose}
      onGenerateNow={onGenerateNow}
      onRerunSummary={rerunSummary}
      onRetryDelivery={retryDelivery}
      open={open}
      selectedChat={selectedChat}
      selectedSummary={selectedSummary}
      summaryRetryLimit={summaryRetryLimit}
    />
  );
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
