package store

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/fr0der1c/tgtldr/app/internal/config"
	"github.com/fr0der1c/tgtldr/app/internal/model"
	. "github.com/smartystreets/goconvey/convey"
)

func TestChatTopicInherited(t *testing.T) {
	Convey("空的可继承字段标记为继承", t, func() {
		topic := model.ChatTopic{}
		inherited := topic.Inherited()
		So(inherited.SummaryTimeLocal, ShouldBeTrue)
		So(inherited.SummaryTimezone, ShouldBeTrue)
		So(inherited.ModelOverride, ShouldBeTrue)
		So(inherited.DeliveryMode, ShouldBeTrue)
		So(inherited.KeepBotMessages, ShouldBeTrue)
	})
}

func TestTopicRepositoryResolveAndUpdate(t *testing.T) {
	st := topicTestStore(t)
	ctx := t.Context()
	chatID := insertTopicTestChat(t, st)
	created, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 458347,
		TopMessageID:    458347,
		Title:           "Technical",
		Enabled:         true,
		SummaryEnabled:  true,
	})
	if err != nil {
		t.Fatal(err)
	}

	resolved, err := st.Topics.ResolveInternalID(ctx, chatID, 458347)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != created.ID {
		t.Fatalf("resolved %d, want %d", resolved, created.ID)
	}

	modelOverride := "glm-5.3-flash"
	keepBotMessages := false
	updated, err := st.Topics.UpdateSettings(ctx, model.ChatTopic{
		ID:               created.ID,
		ChatID:           chatID,
		Enabled:          false,
		SummaryEnabled:   false,
		SummaryContext:   "ctx",
		SummaryPrompt:    "prompt",
		ModelOverride:    &modelOverride,
		KeepBotMessages:  &keepBotMessages,
		FilteredSenders:  []string{"bot"},
		FilteredKeywords: []string{"spam"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Enabled || updated.SummaryEnabled {
		t.Fatal("topic switches were not updated")
	}
	if updated.Inherited().ModelOverride {
		t.Fatal("model override should not be inherited")
	}
	if !updated.Inherited().SummaryTimeLocal {
		t.Fatal("summary time should still be inherited")
	}
	if updated.ModelOverride == nil || *updated.ModelOverride != modelOverride {
		t.Fatal("model override was not stored")
	}
	if updated.KeepBotMessages == nil || *updated.KeepBotMessages {
		t.Fatal("keep bot messages override was not stored")
	}
}

func TestMessageRepositoryUpsertsTopicID(t *testing.T) {
	st := topicTestStore(t)
	ctx := t.Context()
	chatID := insertTopicTestChat(t, st)
	topic, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 458347,
		Title:           "Technical",
	})
	if err != nil {
		t.Fatal(err)
	}
	message := model.Message{
		ChatID: chatID, TelegramMessageID: 99, TopicID: topic.ID,
		TelegramTopicID: 458347, SenderName: "tester", TextContent: "hello",
		MessageTime: time.Now().UTC(), RawJSON: "{}",
	}
	if err := st.Messages.Upsert(ctx, message); err != nil {
		t.Fatal(err)
	}
	var storedTopicID int64
	if err := st.Pool.QueryRow(ctx, `select topic_id from messages where chat_id=$1 and telegram_message_id=$2`, chatID, 99).Scan(&storedTopicID); err != nil {
		t.Fatal(err)
	}
	if storedTopicID != topic.ID {
		t.Fatalf("stored topic id %d, want %d", storedTopicID, topic.ID)
	}
	message.TopicID = 0
	if err := st.Messages.Upsert(ctx, message); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `select topic_id from messages where chat_id=$1 and telegram_message_id=$2`, chatID, 99).Scan(&storedTopicID); err != nil {
		t.Fatal(err)
	}
	if storedTopicID != topic.ID {
		t.Fatalf("unresolved upsert cleared topic id: %d", storedTopicID)
	}
	otherTopic, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 458348,
		Title:           "General",
	})
	if err != nil {
		t.Fatal(err)
	}
	message.TopicID = otherTopic.ID
	if err := st.Messages.Upsert(ctx, message); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `select topic_id from messages where chat_id=$1 and telegram_message_id=$2`, chatID, 99).Scan(&storedTopicID); err != nil {
		t.Fatal(err)
	}
	if storedTopicID != otherTopic.ID {
		t.Fatalf("resolved topic id was not updated in place: %d", storedTopicID)
	}
}

func TestMessageQueriesFilterByTopic(t *testing.T) {
	st := topicTestStore(t)
	ctx := t.Context()
	chatID := insertTopicTestChat(t, st)
	technical, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 458347, Title: "Technical",
	})
	if err != nil {
		t.Fatal(err)
	}
	roleplay, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 7310786, Title: "Roleplay",
	})
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 10, 25, 4, 0, 0, 0, time.UTC)
	for index, topicID := range []int64{technical.ID, technical.ID, roleplay.ID} {
		if err := st.Messages.Upsert(ctx, model.Message{
			ChatID: chatID, TelegramMessageID: 100 + index, TopicID: topicID,
			SenderName: "tester", TextContent: "hello", MessageTime: base.Add(time.Duration(index) * time.Minute), RawJSON: "{}",
		}); err != nil {
			t.Fatal(err)
		}
	}
	messages, err := st.Messages.ListForRange(ctx, chatID, base.Add(-time.Hour), base.Add(time.Hour), technical.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 {
		t.Fatalf("technical messages = %d, want 2", len(messages))
	}
	all, err := st.Messages.ListForRange(ctx, chatID, base.Add(-time.Hour), base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("all messages = %d, want 3", len(all))
	}
	count, err := st.Messages.CountForRangeWithTopic(ctx, chatID, base.Add(-time.Hour), base.Add(time.Hour), roleplay.ID, MessageDisplayFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("roleplay count = %d, want 1", count)
	}
}

func TestLookupByTelegramIDsIncludesTopicID(t *testing.T) {
	st := topicTestStore(t)
	ctx := t.Context()
	chatID := insertTopicTestChat(t, st)
	topic, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 458347, Title: "Technical",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Messages.Upsert(ctx, model.Message{
		ChatID: chatID, TelegramMessageID: 500, TopicID: topic.ID,
		SenderName: "tester", TextContent: "hello", MessageTime: time.Now().UTC(), RawJSON: "{}",
	}); err != nil {
		t.Fatal(err)
	}
	lookup, err := st.Messages.LookupByTelegramIDs(ctx, chatID, []int{500})
	if err != nil {
		t.Fatal(err)
	}
	if lookup[500].TopicID != topic.ID {
		t.Fatalf("lookup topic id = %d, want %d", lookup[500].TopicID, topic.ID)
	}
}

func TestChatRepositoryPersistsIsForum(t *testing.T) {
	st := topicTestStore(t)
	ctx := t.Context()
	stored, err := st.Chats.EnsureExists(ctx, model.Chat{
		TelegramChatID: 1680975844,
		TelegramAccess: 123,
		Title:          "ja-netfilter",
		ChatType:       "supergroup",
		IsForum:        true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !stored.IsForum {
		t.Fatal("forum flag was not persisted")
	}
	stored.IsForum = false
	stored.Title = "renamed"
	stored2, err := st.Chats.EnsureExists(ctx, stored)
	if err != nil {
		t.Fatal(err)
	}
	if stored2.IsForum {
		t.Fatal("forum flag was not updated")
	}
}

func topicTestStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TGTLDR_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要专用 TGTLDR_TEST_DATABASE_URL")
	}
	ctx := t.Context()
	cfg := config.Config{DatabaseURL: dsn, MasterKey: make([]byte, 32)}
	admin, err := Open(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("topics_test_%d", time.Now().UnixNano())
	if _, err := admin.Pool.Exec(ctx, "create schema "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Pool.Exec(context.Background(), "drop schema "+schema+" cascade")
		admin.Close()
	})
	databaseURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := databaseURL.Query()
	query.Set("search_path", schema+",public")
	databaseURL.RawQuery = query.Encode()
	cfg.DatabaseURL = databaseURL.String()
	st, err := Open(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	if err := RunMigrations(ctx, st); err != nil {
		t.Fatal(err)
	}
	return st
}

func insertTopicTestChat(t *testing.T, st *Store) int64 {
	t.Helper()
	var chatID int64
	if err := st.Pool.QueryRow(t.Context(), `
		insert into chats (telegram_chat_id, title, chat_type, is_forum)
		values (1680975844, 'ja-netfilter', 'supergroup', true)
		returning id
	`).Scan(&chatID); err != nil {
		t.Fatal(err)
	}
	return chatID
}

func TestSummaryRepositoryScopesByTopic(t *testing.T) {
	st := topicTestStore(t)
	ctx := t.Context()
	chatID := insertTopicTestChat(t, st)
	technical, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 458347, Title: "Technical",
	})
	if err != nil {
		t.Fatal(err)
	}
	roleplay, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 7310786, Title: "Roleplay",
	})
	if err != nil {
		t.Fatal(err)
	}
	date := "2026-10-25"
	for _, topicID := range []int64{0, technical.ID, roleplay.ID} {
		if err := st.Summaries.UpsertPendingWithTopic(ctx, chatID, topicID, date, model.BotSummaryDeliveryModePerChat); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := st.Pool.QueryRow(ctx, `select count(*) from summaries where chat_id=$1 and summary_date=$2`, chatID, date).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("summary scopes = %d, want 3", count)
	}
	topicSummary, err := st.Summaries.GetByChatTopicAndDate(ctx, chatID, technical.ID, date)
	if err != nil {
		t.Fatal(err)
	}
	if topicSummary.TopicID != technical.ID || topicSummary.TopicTitle != "Technical" {
		t.Fatalf("unexpected topic summary: %+v", topicSummary)
	}
}
