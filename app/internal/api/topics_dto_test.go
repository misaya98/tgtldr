package api

import (
	"encoding/json"
	"testing"

	"github.com/fr0der1c/tgtldr/app/internal/model"
)

// TestChatResponsePreservesChatFields 验证话题 DTO 不会丢失群组原有字段。
func TestChatResponsePreservesChatFields(t *testing.T) {
	modelOverride := "glm-5.3-flash"
	payload, err := json.Marshal(newChatResponses([]model.Chat{{
		ID: 10, Title: "ja-netfilter", ChatType: "supergroup", IsForum: true,
		Enabled: true, SummaryEnabled: true, ModelOverride: modelOverride,
		Topics: []model.ChatTopic{{
			ID: 42, Title: "Technical", ModelOverride: &modelOverride,
		}},
	}}))
	if err != nil {
		t.Fatal(err)
	}
	var decoded []map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 1 {
		t.Fatalf("expected one chat response: %s", payload)
	}
	chat := decoded[0]
	for _, key := range []string{"id", "title", "chatType", "enabled", "summaryEnabled", "topics"} {
		if _, ok := chat[key]; !ok {
			t.Fatalf("missing %q in %s", key, payload)
		}
	}
	topics, ok := chat["topics"].([]any)
	if !ok || len(topics) != 1 {
		t.Fatalf("topics not serialized: %s", payload)
	}
	topic := topics[0].(map[string]any)
	if topic["modelOverride"] != modelOverride {
		t.Fatalf("topic override missing: %s", payload)
	}
	if _, ok := topic["inherited"]; !ok {
		t.Fatalf("topic inheritance missing: %s", payload)
	}
}
