package store

import (
	"context"
	"fmt"

	"github.com/fr0der1c/tgtldr/app/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TopicRepository struct {
	pool *pgxpool.Pool
}

const topicColumns = `
	id, chat_id, telegram_topic_id, top_message_id, title, icon_color, icon_emoji_id,
	is_closed, is_pinned, is_deleted, enabled, summary_enabled,
	summary_context, summary_prompt, summary_time_local, summary_timezone,
	model_override, delivery_mode, keep_bot_messages,
	filtered_senders, filtered_keywords, first_seen_at, last_seen_at,
	created_at, updated_at
`

func (r *TopicRepository) UpsertDiscovered(ctx context.Context, chatID int64, topic model.ChatTopic) (model.ChatTopic, error) {
	title := topic.Title
	if topic.TelegramTopicID == 1 && title == "" {
		title = "General"
	}
	var saved model.ChatTopic
	err := r.pool.QueryRow(ctx, `
		insert into chat_topics (
			chat_id, telegram_topic_id, top_message_id, title, icon_color, icon_emoji_id, is_closed, is_pinned
		) values ($1, $2, $3, $4, $5, $6, $7, $8)
		on conflict (chat_id, telegram_topic_id) do update
		set top_message_id = excluded.top_message_id,
		    title = excluded.title,
		    icon_color = excluded.icon_color,
		    icon_emoji_id = excluded.icon_emoji_id,
		    is_closed = excluded.is_closed,
		    is_pinned = excluded.is_pinned,
		    is_deleted = false,
		    last_seen_at = now(),
		    updated_at = now()
		returning `+topicColumns,
		chatID, topic.TelegramTopicID, topic.TopMessageID, title, topic.IconColor, topic.IconEmojiID,
		topic.IsClosed, topic.IsPinned,
	).Scan(topicScanDest(&saved)...)
	if err != nil {
		return model.ChatTopic{}, fmt.Errorf("upsert topic %d for chat %d: %w", topic.TelegramTopicID, chatID, err)
	}
	return saved, nil
}

func (r *TopicRepository) ListByChat(ctx context.Context, chatID int64) ([]model.ChatTopic, error) {
	rows, err := r.pool.Query(ctx, `
		select `+topicColumns+`
		from chat_topics
		where chat_id = $1
		order by is_deleted asc, is_pinned desc, telegram_topic_id asc
	`, chatID)
	if err != nil {
		return nil, fmt.Errorf("list topics for chat %d: %w", chatID, err)
	}
	defer rows.Close()
	topics := make([]model.ChatTopic, 0)
	for rows.Next() {
		var topic model.ChatTopic
		if err := rows.Scan(topicScanDest(&topic)...); err != nil {
			return nil, fmt.Errorf("scan topic for chat %d: %w", chatID, err)
		}
		topics = append(topics, topic)
	}
	return topics, rows.Err()
}

func (r *TopicRepository) GetByID(ctx context.Context, chatID, topicID int64) (model.ChatTopic, error) {
	var topic model.ChatTopic
	err := r.pool.QueryRow(ctx, `
		select `+topicColumns+`
		from chat_topics
		where chat_id = $1 and id = $2
	`, chatID, topicID).Scan(topicScanDest(&topic)...)
	if err != nil {
		return model.ChatTopic{}, fmt.Errorf("get topic %d for chat %d: %w", topicID, chatID, err)
	}
	return topic, nil
}

func (r *TopicRepository) UpdateSettings(ctx context.Context, topic model.ChatTopic) (model.ChatTopic, error) {
	var saved model.ChatTopic
	err := r.pool.QueryRow(ctx, `
		update chat_topics
		set enabled = $3,
		    summary_enabled = $4,
		    summary_context = $5,
		    summary_prompt = $6,
		    summary_time_local = $7,
		    summary_timezone = $8,
		    model_override = $9,
		    delivery_mode = $10,
		    keep_bot_messages = $11,
		    filtered_senders = $12,
		    filtered_keywords = $13,
		    updated_at = now()
		where chat_id = $1 and id = $2
		returning `+topicColumns,
		topic.ChatID, topic.ID, topic.Enabled, topic.SummaryEnabled,
		topic.SummaryContext, topic.SummaryPrompt, topic.SummaryTimeLocal,
		topic.SummaryTimezone, topic.ModelOverride, topic.DeliveryMode,
		topic.KeepBotMessages, topic.FilteredSenders, topic.FilteredKeywords,
	).Scan(topicScanDest(&saved)...)
	if err != nil {
		return model.ChatTopic{}, fmt.Errorf("update topic %d for chat %d: %w", topic.ID, topic.ChatID, err)
	}
	return saved, nil
}

func (r *TopicRepository) ResolveInternalID(ctx context.Context, chatID int64, telegramTopicID int64) (int64, error) {
	var topicID int64
	err := r.pool.QueryRow(ctx, `
		select id from chat_topics
		where chat_id = $1 and telegram_topic_id = $2 and not is_deleted
	`, chatID, telegramTopicID).Scan(&topicID)
	if err != nil {
		return 0, fmt.Errorf("resolve telegram topic %d for chat %d: %w", telegramTopicID, chatID, err)
	}
	return topicID, nil
}

func (r *TopicRepository) MarkStale(ctx context.Context, chatID int64, keepIDs []int64) error {
	_, err := r.pool.Exec(ctx, `
		update chat_topics
		set is_deleted = true, updated_at = now()
		where chat_id = $1
		  and is_deleted = false
		  and not (telegram_topic_id = any($2))
	`, chatID, keepIDs)
	if err != nil {
		return fmt.Errorf("mark stale topics for chat %d: %w", chatID, err)
	}
	return nil
}

func topicScanDest(topic *model.ChatTopic) []any {
	return []any{
		&topic.ID, &topic.ChatID, &topic.TelegramTopicID, &topic.TopMessageID, &topic.Title,
		&topic.IconColor, &topic.IconEmojiID, &topic.IsClosed, &topic.IsPinned,
		&topic.IsDeleted, &topic.Enabled, &topic.SummaryEnabled,
		&topic.SummaryContext, &topic.SummaryPrompt, &topic.SummaryTimeLocal,
		&topic.SummaryTimezone, &topic.ModelOverride, &topic.DeliveryMode,
		&topic.KeepBotMessages, &topic.FilteredSenders, &topic.FilteredKeywords,
		&topic.FirstSeenAt, &topic.LastSeenAt, &topic.CreatedAt, &topic.UpdatedAt,
	}
}

func (r *TopicRepository) ResolveOptional(ctx context.Context, chatID int64, telegramTopicID int64) (int64, error) {
	topicID, err := r.ResolveInternalID(ctx, chatID, telegramTopicID)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	return topicID, err
}

// AssignMessagesToTopic 只给尚未归属且确实存在于该群的 Telegram 消息打话题标记。
func (r *TopicRepository) AssignMessagesToTopic(ctx context.Context, chatID, topicID int64, telegramMessageIDs []int) (int64, error) {
	if topicID <= 0 || len(telegramMessageIDs) == 0 {
		return 0, nil
	}
	tag, err := r.pool.Exec(ctx, `
		update messages
		set topic_id = $2
		where chat_id = $1 and topic_id = 0 and telegram_message_id = any($3)
	`, chatID, topicID, telegramMessageIDs)
	if err != nil {
		return 0, fmt.Errorf("assign messages to topic %d: %w", topicID, err)
	}
	return tag.RowsAffected(), nil
}
