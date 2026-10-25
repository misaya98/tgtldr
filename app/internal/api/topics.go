package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/fr0der1c/tgtldr/app/internal/httpx"
	"github.com/fr0der1c/tgtldr/app/internal/model"
	"github.com/jackc/pgx/v5"
)

type chatTopicResponse struct {
	model.ChatTopic
	SummaryTimeLocal *string                `json:"summaryTimeLocal"`
	SummaryTimezone  *string                `json:"summaryTimezone"`
	ModelOverride    *string                `json:"modelOverride"`
	DeliveryMode     *string                `json:"deliveryMode"`
	KeepBotMessages  *bool                  `json:"keepBotMessages"`
	Inherited        model.TopicInheritance `json:"inherited"`
}

func newChatTopicResponse(topic model.ChatTopic) chatTopicResponse {
	return chatTopicResponse{
		ChatTopic:        topic,
		SummaryTimeLocal: topic.SummaryTimeLocal,
		SummaryTimezone:  topic.SummaryTimezone,
		ModelOverride:    topic.ModelOverride,
		DeliveryMode:     topic.DeliveryMode,
		KeepBotMessages:  topic.KeepBotMessages,
		Inherited:        topic.Inherited(),
	}
}

func newChatTopicResponses(topics []model.ChatTopic) []chatTopicResponse {
	result := make([]chatTopicResponse, 0, len(topics))
	for _, topic := range topics {
		result = append(result, newChatTopicResponse(topic))
	}
	return result
}

// handleSyncChatTopics 刷新单个论坛超级群的话题元数据。
func (r *Router) handleSyncChatTopics(w http.ResponseWriter, req *http.Request) {
	chatID, ok := parseTopicPathID(w, req.PathValue("chatID"), "chat id")
	if !ok {
		return
	}
	chat, err := r.store.Chats.GetByID(req.Context(), chatID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, pgx.ErrNoRows) {
			status = http.StatusNotFound
		}
		httpx.Error(w, status, err.Error())
		return
	}
	if !chat.IsForum {
		httpx.Error(w, http.StatusBadRequest, r.localized(req.Context(), "这个群组不是 Telegram 论坛超级群。", "This chat is not a Telegram forum supergroup."))
		return
	}
	topics, err := r.telegram.SyncChatTopics(req.Context(), chat)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, newChatTopicResponses(topics))
}

// handleSaveChatTopic 只更新指定话题的用户设置，不允许跨群修改。
func (r *Router) handleSaveChatTopic(w http.ResponseWriter, req *http.Request) {
	chatID, ok := parseTopicPathID(w, req.PathValue("chatID"), "chat id")
	if !ok {
		return
	}
	topicID, ok := parseTopicPathID(w, req.PathValue("topicID"), "topic id")
	if !ok {
		return
	}
	existing, err := r.store.Topics.GetByID(req.Context(), chatID, topicID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, pgx.ErrNoRows) {
			status = http.StatusNotFound
		}
		httpx.Error(w, status, err.Error())
		return
	}
	var payload struct {
		Enabled          *bool    `json:"enabled"`
		SummaryEnabled   *bool    `json:"summaryEnabled"`
		SummaryContext   *string  `json:"summaryContext"`
		SummaryPrompt    *string  `json:"summaryPrompt"`
		ModelOverride    *string  `json:"modelOverride"`
		FilteredSenders  []string `json:"filteredSenders"`
		FilteredKeywords []string `json:"filteredKeywords"`
	}
	if err := httpx.DecodeJSON(req, &payload); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if payload.Enabled != nil {
		existing.Enabled = *payload.Enabled
	}
	if payload.SummaryEnabled != nil {
		existing.SummaryEnabled = *payload.SummaryEnabled
	}
	if payload.SummaryContext != nil {
		existing.SummaryContext = *payload.SummaryContext
	}
	if payload.SummaryPrompt != nil {
		existing.SummaryPrompt = *payload.SummaryPrompt
	}
	if payload.ModelOverride != nil {
		existing.ModelOverride = nullableString(*payload.ModelOverride)
	}
	if payload.FilteredSenders != nil {
		existing.FilteredSenders = payload.FilteredSenders
	}
	if payload.FilteredKeywords != nil {
		existing.FilteredKeywords = payload.FilteredKeywords
	}
	saved, err := r.store.Topics.UpdateSettings(req.Context(), existing)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, newChatTopicResponse(saved))
}

func parseTopicPathID(w http.ResponseWriter, value string, name string) (int64, bool) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		httpx.Error(w, http.StatusBadRequest, "invalid "+name)
		return 0, false
	}
	return id, true
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (r *Router) attachChatTopics(req *http.Request, chats []model.Chat) error {
	topicsByChat := make(map[int64][]model.ChatTopic)
	for index := range chats {
		if !chats[index].IsForum {
			continue
		}
		topics, err := r.store.Topics.ListByChat(req.Context(), chats[index].ID)
		if err != nil {
			return err
		}
		topicsByChat[chats[index].ID] = topics
	}
	for index := range chats {
		chats[index].Topics = topicsByChat[chats[index].ID]
	}
	return nil
}

type topicBackfillResponse struct {
	TopicID          int64 `json:"topicId"`
	Scanned          int   `json:"scanned"`
	TouchedLocalRows int64 `json:"touchedLocalRows"`
}

// handleBackfillChatTopic 按 Telegram 话题回复链确认消息归属，只更新本地 topic_id。
func (r *Router) handleBackfillChatTopic(w http.ResponseWriter, req *http.Request) {
	chatID, ok := parseTopicPathID(w, req.PathValue("chatID"), "chat id")
	if !ok {
		return
	}
	topicID, ok := parseTopicPathID(w, req.PathValue("topicID"), "topic id")
	if !ok {
		return
	}
	chat, err := r.store.Chats.GetByID(req.Context(), chatID)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	topic, err := r.store.Topics.GetByID(req.Context(), chatID, topicID)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	result, err := r.telegram.BackfillTopicMessages(req.Context(), chat, topic)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, topicBackfillResponse{
		TopicID: topicID, Scanned: result.Scanned, TouchedLocalRows: result.TouchedLocalRows,
	})
}

type chatResponse struct {
	model.Chat
	Topics []chatTopicResponse `json:"topics,omitempty"`
}

func newChatResponses(chats []model.Chat) []chatResponse {
	result := make([]chatResponse, 0, len(chats))
	for _, chat := range chats {
		result = append(result, chatResponse{
			Chat:   chat,
			Topics: newChatTopicResponses(chat.Topics),
		})
	}
	return result
}
