"use client";

import { useState } from "react";
import { Drawer } from "@/components/drawer";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { AppSelect } from "@/components/app-select";
import { BotSummaryDeliveryMode, Chat, DeliveryMode } from "@/lib/types";

export function ChatConfigDrawer({
  chat,
  open,
  onClose,
  onSave,
  botSummaryDeliveryMode,
}: {
  chat: Chat | null;
  open: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Chat>) => Promise<void>;
  botSummaryDeliveryMode: BotSummaryDeliveryMode;
}) {
  if (!chat) return null;

  const [saving, setSaving] = useState(false);
  const [collectorAccountId, setCollectorAccountId] = useState(chat.collectorAccountId);
  const [enabled, setEnabled] = useState(chat.enabled);
  const [summaryEnabled, setSummaryEnabled] = useState(chat.summaryEnabled);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(chat.deliveryMode);
  const [summaryTimeLocal, setSummaryTimeLocal] = useState(chat.summaryTimeLocal);
  const [modelOverride, setModelOverride] = useState(chat.modelOverride || "");
  const [keepBotMessages, setKeepBotMessages] = useState(chat.keepBotMessages);
  const [filteredSenders, setFilteredSenders] = useState((chat.filteredSenders || []).join(", "));
  const [filteredKeywords, setFilteredKeywords] = useState((chat.filteredKeywords || []).join(", "));
  const [summaryContext, setSummaryContext] = useState(chat.summaryContext || "");
  const [summaryPrompt, setSummaryPrompt] = useState(chat.summaryPrompt || "");
  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        collectorAccountId,
        enabled,
        summaryEnabled,
        deliveryMode,
        summaryTimeLocal,
        modelOverride,
        keepBotMessages,
        filteredSenders: filteredSenders
          .split(/[\n,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        filteredKeywords: filteredKeywords
          .split(/[\n,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        summaryContext,
        summaryPrompt,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const collectorOptions = (chat.availableAccounts || []).map((acc) => ({
    value: String(acc.accountId),
    label: acc.accountName ? `${acc.accountName} (@${acc.accountHandle})` : `账号 #${acc.accountId}`,
  }));

  return (
    <Drawer
      onClose={onClose}
      open={open}
      title={`群组配置 · ${chat.title}`}
      actions={
        <div className="drawer-bottom-actions">
          <Button onClick={onClose} variant="ghost">
            取消
          </Button>
          <Button disabled={saving} onClick={() => void handleSave()} variant="primary">
            {saving ? "正在保存..." : "保存群组配置"}
          </Button>
        </div>
      }
    >
      <div className="chat-config-drawer-body">
        {collectorOptions.length > 1 && (
          <Field hint="指定通过哪一个 Telegram 登录会话拉取该群消息" label="采集账号">
            <AppSelect
              disabled={saving}
              onChange={(v) => setCollectorAccountId(Number(v))}
              options={collectorOptions}
              value={String(collectorAccountId)}
            />
          </Field>
        )}

        <div className="config-section-card">
          <h3>核心开关</h3>
          <div className="toggle-field-row">
            <div>
              <strong>消息保存</strong>
              <p className="muted">开启后，后台将持续监听并持久化该群的消息流</p>
            </div>
            <button
              aria-pressed={enabled}
              className={`status-toggle${enabled ? " on" : ""}`}
              onClick={() => setEnabled(!enabled)}
              type="button"
            >
              {enabled ? "已启用" : "未启用"}
            </button>
          </div>

          <div className="toggle-field-row">
            <div>
              <strong>AI 每日总结</strong>
              <p className="muted">开启后，系统每天定时为此群生成 AI 摘要简报</p>
            </div>
            <button
              aria-pressed={summaryEnabled}
              className={`status-toggle${summaryEnabled ? " on" : ""}`}
              onClick={() => setSummaryEnabled(!summaryEnabled)}
              type="button"
            >
              {summaryEnabled ? "已启用" : "未启用"}
            </button>
          </div>
        </div>
        <div className="config-section-card">
          <h3>摘要与投递规则</h3>
          <Field hint="每天触发 AI 总结的本地时间（HH:MM）" label="生成时间">
            <Input
              disabled={saving}
              onChange={(e) => setSummaryTimeLocal(e.target.value)}
              placeholder="08:00"
              value={summaryTimeLocal}
            />
          </Field>

          <Field
            hint={
              botSummaryDeliveryMode === "daily_digest"
                ? "当前全局设置为每日总览合并发送，单群投递设置仅在全局切换为单群发送时生效"
                : "选择摘要仅在后台查看，还是通过 Telegram Bot 自动推送"
            }
            label="推送模式"
          >
            <AppSelect
              disabled={saving}
              onChange={(v) => setDeliveryMode(v as DeliveryMode)}
              options={[
                { value: "dashboard", label: "仅后台查看 (不推送)" },
                { value: "bot", label: "后台查看并由 Bot 推送" },
              ]}
              value={deliveryMode}
            />
          </Field>

          <Field hint="留空则使用全局默认模型（如 gpt-4o-mini 或 deepseek）" label="模型覆盖 (Model Override)">
            <Input
              disabled={saving}
              onChange={(e) => setModelOverride(e.target.value)}
              placeholder="例如: gpt-4o, claude-3-5-sonnet"
              value={modelOverride}
            />
          </Field>

          <div className="toggle-field-row">
            <div>
              <strong>保留机器人消息</strong>
              <p className="muted">是否在摘要输入中包含群内其他 Bot 发送的消息</p>
            </div>
            <button
              aria-pressed={keepBotMessages}
              className={`status-toggle${keepBotMessages ? " on" : ""}`}
              onClick={() => setKeepBotMessages(!keepBotMessages)}
              type="button"
            >
              {keepBotMessages ? "保留" : "忽略"}
            </button>
          </div>
        </div>
        <div className="config-section-card">
          <h3>过滤与清洗规则</h3>
          <Field hint="多个发言人用逗号分隔，命中发言人的消息将不纳入摘要" label="过滤发言人 (Senders)">
            <Input
              disabled={saving}
              onChange={(e) => setFilteredSenders(e.target.value)}
              placeholder="例如: SpammerBot, 广告小助手"
              value={filteredSenders}
            />
          </Field>

          <Field hint="多个关键词用逗号分隔，命中关键词的消息将直接剔除" label="过滤关键词 (Keywords)">
            <Input
              disabled={saving}
              onChange={(e) => setFilteredKeywords(e.target.value)}
              placeholder="例如: 炒股, 兼职, 优惠券"
              value={filteredKeywords}
            />
          </Field>
        </div>

        <div className="config-section-card">
          <h3>Prompt 自定义与群聊背景</h3>
          <Field hint="帮助 AI 理解这个群的专业领域、缩写或主要讨论话题" label="群聊背景 (Context)">
            <Textarea
              disabled={saving}
              onChange={(e) => setSummaryContext(e.target.value)}
              placeholder="例如：这是一个围绕 Next.js 与 Web 性能优化的开发者技术交流群。"
              rows={3}
              value={summaryContext}
            />
          </Field>

          <Field hint="在标准摘要 Prompt 之后追加的额外指令" label="额外要求 (Prompt Extra)">
            <Textarea
              disabled={saving}
              onChange={(e) => setSummaryPrompt(e.target.value)}
              placeholder="例如：请重点关注大家讨论的高危漏洞与性能优化技巧。"
              rows={3}
              value={summaryPrompt}
            />
          </Field>
        </div>
      </div>
    </Drawer>
  );
}
