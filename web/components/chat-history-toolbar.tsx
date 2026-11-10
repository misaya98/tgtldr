"use client";

import { ChatMessageActivity, ChatTopic } from "@/lib/types";
import { ChatActivityStrip } from "@/components/chat-activity-strip";
import { ChatDatePicker } from "@/components/chat-date-picker";

type ChatHistoryToolbarProps = {
  activity: ChatMessageActivity[];
  busy: boolean;
  currentDate: string;
  nextDate?: string;
  previousDate?: string;
  total?: number;
  filtersApplied: boolean;
  hasMessageFilters: boolean;
  onDateChange: (date: string) => void;
  onFiltersChange: (enabled: boolean) => void;
  topics?: ChatTopic[];
  selectedTopicId?: number;
  onTopicChange?: (topicId: number) => void;
};

export function ChatHistoryToolbar(props: ChatHistoryToolbarProps) {
  const hasTopics = Boolean(props.topics && props.topics.length > 0);

  return (
    <div className="chat-history-toolbar">
      {hasTopics && (
        <div className="chat-topic-bar" role="tablist" aria-label="话题筛选">
          <button
            type="button"
            role="tab"
            aria-selected={!props.selectedTopicId || props.selectedTopicId === 0}
            className={`chat-topic-pill${!props.selectedTopicId || props.selectedTopicId === 0 ? " active" : ""}`}
            onClick={() => props.onTopicChange?.(0)}
            disabled={props.busy}
          >
            全部话题
          </button>
          {props.topics?.map((t) => {
            const isSelected = props.selectedTopicId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`chat-topic-pill${isSelected ? " active" : ""}${t.isClosed ? " closed" : ""}`}
                onClick={() => props.onTopicChange?.(t.id)}
                disabled={props.busy}
                title={t.title}
              >
                <span className="topic-hash">#</span>
                <span className="topic-pill-title">{t.title || `话题 ${t.telegramTopicId}`}</span>
                {t.isClosed && <span className="topic-pill-closed">已关闭</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="chat-history-date-row">
        <div className="chat-date-pager">
          <button
            aria-label="上一有消息日"
            className="chat-date-arrow"
            disabled={props.busy || !props.previousDate}
            onClick={() => props.previousDate && props.onDateChange(props.previousDate)}
            title="上一有消息日"
            type="button"
          >
            <ChevronIcon direction="left" />
          </button>
          <ChatDatePicker
            activity={props.activity}
            busy={props.busy}
            currentDate={props.currentDate}
            onDateChange={props.onDateChange}
            total={props.total}
          />
          <button
            aria-label="下一有消息日"
            className="chat-date-arrow"
            disabled={props.busy || !props.nextDate}
            onClick={() => props.nextDate && props.onDateChange(props.nextDate)}
            title="下一有消息日"
            type="button"
          >
            <ChevronIcon direction="right" />
          </button>
        </div>

        <div className="chat-history-activity">
          <div className="chat-history-activity-labels">
            <span>最近 30 天</span>
            <small>{activityRange(props.activity)}</small>
          </div>
          <ChatActivityStrip
            activity={props.activity}
            currentDate={props.currentDate}
            onSelectDate={props.onDateChange}
          />
        </div>

        <label
          className={`chat-filter-toggle${props.filtersApplied ? " active" : ""}`}
          title={props.hasMessageFilters ? "应用群组过滤规则" : "该群尚未配置消息过滤规则"}
        >
          <input
            checked={props.filtersApplied}
            disabled={props.busy || !props.hasMessageFilters}
            onChange={(event) => props.onFiltersChange(event.target.checked)}
            type="checkbox"
          />
          <span aria-hidden="true"><i /></span>
          <b>应用群组过滤规则</b>
        </label>
      </div>
    </div>
  );
}

function activityRange(activity: ChatMessageActivity[]) {
  if (activity.length === 0) return "";
  return `${activity[0].date.slice(5)} – ${activity[activity.length - 1].date.slice(5)}`;
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  const path = direction === "left" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6";
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d={path} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" /></svg>;
}
